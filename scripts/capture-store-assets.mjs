import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"));
const output = path.join(root, "store-assets");
// A signed-in profile can be supplied for the frames that need an account. Without it the script
// captures every signed-out surface and skips the rest rather than substituting a mock-up.
const profile = process.env.REELLESS_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(), "reelless-assets-"));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "reelless-captures-"));
const executablePath = process.env.REELLESS_CHROME_PATH || chromium.executablePath();
let context;

const fixtureStyle = `
  *{box-sizing:border-box}body{margin:0;background:#f6f7f9;color:#18212a;font-family:Inter,Arial,sans-serif}
  .bar{height:72px;display:flex;align-items:center;justify-content:space-between;padding:0 34px;background:white;border-bottom:1px solid #e4e7eb}
  .brand{font-size:21px;font-weight:850}.search{width:260px;padding:12px 18px;border-radius:99px;background:#eef1f4;color:#7a8792}
  main{padding:32px}.layout{display:grid;grid-template-columns:190px 1fr;gap:28px}.nav{display:grid;align-content:start;gap:9px}.nav a{padding:13px 15px;border-radius:12px;color:inherit;text-decoration:none}.nav a:first-child{background:#e8ecef;font-weight:800}
  .feed{max-width:760px}.feed h1{margin:0 0 18px;font-size:24px}.card{margin-bottom:14px;padding:18px;border:1px solid #e1e5e9;border-radius:16px;background:white}.thumb{height:170px;border-radius:12px;background:#d6dfd9}.card strong{display:block;margin-top:11px}
  .shorts-row{display:grid;grid-template-columns:repeat(3,1fr);gap:11px}.short{height:240px;border-radius:15px;background:#456b59;color:white;padding:15px;display:flex;align-items:end;font-weight:800}.reelless-note{padding:25px;border:2px dashed #66bdaa;border-radius:16px;background:#e9faf6;color:#176454;font-weight:800;text-align:center}
`;

// Privacy-safe browser surfaces used when a live signed-out page is unavailable or when a
// deterministic before/after comparison is needed. The real unpacked extension still runs on
// the real platform URL inside Chromium; only the account/feed markup is locally supplied.
const tiktokTestPage = `<!doctype html><style>
  *{box-sizing:border-box}html,body{width:100%;height:100%;overflow:hidden}body{margin:0;background:#090b0c;color:#f5f5f5;font:14px Inter,"Segoe UI",Arial,sans-serif}
  .app{display:grid;grid-template-columns:210px 1fr;height:100%}.rail{padding:26px 18px;border-right:1px solid #272a2c;background:#111315}.logo{display:flex;align-items:center;gap:10px;margin:0 10px 30px;font-size:22px;font-weight:850}.logo i{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#25f4ee,#fe2c55);font-style:normal;color:#050505}
  nav{display:grid;gap:7px}nav a{display:flex;align-items:center;gap:13px;padding:13px 14px;border-radius:9px;color:#f4f4f4;text-decoration:none;font-weight:700}nav a:first-child{background:#24272a}nav span{display:grid;place-items:center;width:24px;height:24px;border:1px solid #555;border-radius:7px;color:#b9c0c4;font-size:11px}
  .stage{min-width:0}.top{height:72px;display:flex;align-items:center;justify-content:space-between;padding:0 34px;border-bottom:1px solid #222629;background:#101214}.search{width:390px;padding:13px 18px;border-radius:999px;background:#25282b;color:#959da2}.actions{display:flex;gap:10px}.actions b{padding:10px 16px;border-radius:7px;background:#fe2c55}.actions span{padding:10px 16px;border:1px solid #3b4044;border-radius:7px}
  main{height:calc(100% - 72px);display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 60% 20%,#1d2525,#0c0e0f 48%)}.viewer{display:grid;grid-template-columns:390px 54px;gap:18px;align-items:end}.video{position:relative;height:610px;overflow:hidden;border-radius:18px;background:linear-gradient(160deg,#264d48 0%,#172b38 44%,#43283e 100%);box-shadow:0 24px 70px #000}.video:before{content:"";position:absolute;inset:70px 65px 165px;border-radius:50% 45% 55% 40%;background:linear-gradient(145deg,#a8d8c1,#4a8b85 55%,#274c68);filter:blur(1px)}.video:after{content:"FOCUS MODE";position:absolute;top:28px;left:26px;padding:8px 11px;border:1px solid rgba(255,255,255,.25);border-radius:999px;font-size:11px;font-weight:800;letter-spacing:.12em}.caption{position:absolute;right:22px;bottom:22px;left:22px}.caption strong{display:block;margin-bottom:8px}.caption p{margin:0;color:#d5d9da;line-height:1.45}.side-actions{display:grid;gap:18px;padding-bottom:22px;text-align:center}.side-actions div{display:grid;gap:6px;justify-items:center;color:#aeb5b8;font-size:11px}.side-actions i{display:grid;place-items:center;width:46px;height:46px;border-radius:50%;background:#23272a;color:#fff;font-style:normal;font-size:18px}
</style><div class="app"><aside class="rail"><div class="logo"><i>♪</i><b>TikTok</b></div><nav><a href="/"><span>⌂</span>For You</a><a href="/explore"><span>◇</span>Explore</a><a href="/following"><span>＋</span>Following</a><a href="/messages"><span>✉</span>Messages</a><a href="/upload"><span>↑</span>Upload</a></nav></aside><section class="stage"><header class="top"><div class="search">Search</div><div class="actions"><span>Upload</span><b>Log in</b></div></header><main><div class="viewer"><article class="video"><div class="caption"><strong>@focus_demo</strong><p>A quiet study session — no account or personal feed is used in this test.</p></div></article><aside class="side-actions"><div><i>♡</i>Like</div><div><i>◌</i>Comment</div><div><i>↗</i>Share</div></aside></div></main></section></div>`;

async function setState(worker, enabled = true) {
  await worker.evaluate(async ({ enabled }) => {
    const stored = await chrome.storage.local.get("settingsV2");
    const settings = ReelLess.normalizeSettings(stored.settingsV2 || ReelLess.getDefaultSettings());
    settings.protectionEnabled = enabled;
    settings.pausedUntil = null;
    settings.schedulePreset = "always";
    settings.platforms.youtube.mode = "shortform";
    settings.platforms.instagram.mode = "shortform";
    settings.platforms.facebook.mode = "shortform";
    settings.platforms.tiktok.mode = "all";
    await chrome.storage.local.set({
      settingsV2: settings,
      statsV1: { localDay: new Date().toLocaleDateString("en-CA"), todayCount: 12, totalCount: 146 }
    });
  }, { enabled });
  await new Promise((resolve) => setTimeout(resolve, 180));
}

async function screenshotUrl(url, routePattern, body, destination, viewport = { width: 640, height: 720 }) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.route(routePattern, (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body }));
  await page.goto(url);
  await page.waitForTimeout(300);
  await page.screenshot({ path: destination });
  await page.close();
}

// A signed-in social feed greets a fresh browser with a dialog: Instagram asks to turn on
// notifications, Facebook to save the login. Either one sits over the feed and turns the frame into
// a screenshot of the dialog. Decline them the way a person would, then give the feed a moment.
async function dismissPrompts(page) {
  for (const label of ["Not Now", "Not now", "Cancel", "Close"]) {
    const button = page.getByRole("button", { name: label, exact: true }).first();
    if (await button.count() && await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(700);
    }
  }
}

// Captures a live page rather than a served fixture. Returns the scroll offset it settled on, so
// the matching "after" capture can be taken from exactly the same position and the two frames
// differ only by what ReelLess removed.
async function capturePage(url, destination, { viewport = { width: 1280, height: 800 }, scrollTo = null, settle = 5000 } = {}) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(settle);
  await dismissPrompts(page);
  let offset = 0;
  if (scrollTo === null) {
    // Bring a real short-form block in the results body into view. The persistent sidebar also
    // links to /shorts, and scrolling to that would leave the frame at the top of the page showing
    // nothing the extension visibly changes.
    const anchor = page.locator(
      "ytd-reel-shelf-renderer, ytd-rich-shelf-renderer[is-shorts], #contents a[href*='/shorts/'], main a[href*='/reel/'], main a[href*='/reels/']"
    ).first();
    if (await anchor.count()) {
      await anchor.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(800);
      // Lift the shelf off the very top edge so the frame reads as a page, not a crop.
      await page.evaluate(() => window.scrollBy(0, -120));
      await page.waitForTimeout(300);
    }
    offset = await page.evaluate(() => window.scrollY);
  } else {
    offset = scrollTo;
    await page.evaluate((y) => window.scrollTo(0, y), scrollTo);
    await page.waitForTimeout(600);
  }
  await page.addStyleTag({ content: "::-webkit-scrollbar{display:none}" }).catch(() => {});
  await page.screenshot({ path: destination });
  await page.close();
  return offset;
}

// True when a live capture is usable. A login wall is not a screenshot of this product working.
async function reachableSignedOut(url, marker) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);
    return await page.locator(marker).count() > 0;
  } catch (_error) {
    return false;
  } finally {
    await page.close();
  }
}

async function compose(destination, title, panels, widths) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  const images = panels.map((panel) => `data:image/png;base64,${fs.readFileSync(panel.path).toString("base64")}`);
  const columns = widths || panels.map(() => "1fr");
  await page.setContent(`<!doctype html><style>*{box-sizing:border-box}html,body{width:1280px;height:800px;overflow:hidden}body{margin:0;padding:28px 32px 32px;background:#1f2421;color:#edf0ed;font-family:"Segoe UI",Arial,sans-serif}header{height:56px;display:flex;align-items:flex-start;justify-content:space-between}h1{margin:0;font-size:27px;font-weight:650;letter-spacing:-.03em}header span{color:#aeb9b2;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase}.panels{height:684px;display:grid;grid-template-columns:${columns.join(" ")};gap:14px}.panel{position:relative;overflow:hidden;border:1px solid #3c4540;border-radius:8px;background:#282e2a}.panel b{position:absolute;bottom:14px;left:14px;z-index:2;padding:7px 10px;border:1px solid #4d5751;border-radius:5px;background:#282e2a;color:#edf0ed;font-size:11px}.panel img{width:100%;height:100%;object-fit:cover;object-position:left top}</style><header><h1>${title}</h1><span>Real ReelLess UI</span></header><div class="panels">${panels.map((panel, index) => `<div class="panel"><b>${panel.label}</b><img src="${images[index]}"></div>`).join("")}</div>`);
  await page.screenshot({ path: destination });
  await page.close();
}

async function composeArrowComparison(destination, title, beforePath, afterPath, beforeLabel, afterLabel) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  const before = `data:image/png;base64,${fs.readFileSync(beforePath).toString("base64")}`;
  const after = `data:image/png;base64,${fs.readFileSync(afterPath).toString("base64")}`;
  await page.setContent(`<!doctype html><style>*{box-sizing:border-box}html,body{width:1280px;height:800px;overflow:hidden}body{margin:0;padding:28px 32px 32px;background:#1f2421;color:#edf0ed;font-family:"Segoe UI",Arial,sans-serif}header{height:62px;display:flex;align-items:flex-start;justify-content:space-between}h1{margin:0;font-size:27px;font-weight:650;letter-spacing:-.03em}header span{color:#aeb9b2;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase}.comparison{height:678px;display:grid;grid-template-columns:1fr 66px 1fr;align-items:center}.panel{position:relative;height:678px;overflow:hidden;border:1px solid #3c4540;border-radius:9px;background:#fff}.panel img{width:100%;height:100%;object-fit:cover;object-position:left top}.label{position:absolute;right:14px;bottom:14px;left:14px;z-index:2;padding:10px 12px;border:1px solid #4d5751;border-radius:7px;background:#282e2a;color:#edf0ed;font-size:12px;font-weight:750;text-align:center}.arrow{display:grid;place-items:center;width:48px;height:48px;margin:auto;border:1px solid #4f6859;border-radius:50%;background:#2d493b;color:#bce0c9;font-size:30px;line-height:1}</style><header><h1>${title}</h1><span>Captured from the live site in Chrome</span></header><div class="comparison"><div class="panel"><img src="${before}"><div class="label">${beforeLabel}</div></div><div class="arrow" aria-hidden="true">→</div><div class="panel"><img src="${after}"><div class="label">${afterLabel}</div></div></div>`);
  await page.screenshot({ path: destination });
  await page.close();
}

const skipped = [];
const notes = [];

try {
  fs.mkdirSync(output, { recursive: true });
  context = await chromium.launchPersistentContext(profile, {
    executablePath,
    headless: process.env.REELLESS_HEADLESS === "1",
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, "--no-first-run", "--no-default-browser-check"]
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const id = new URL(worker.url()).host;
  await setState(worker, true);

  // 1. Actual popup with seeded local-only counters.
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 1280, height: 800 });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  // Scaled to occupy the frame. At 1.24 the popup sat on roughly a third of the canvas, so most of
  // the thumbnail a shopper sees was empty background.
  await popup.addStyleTag({ content: "html,body{width:1280px!important;height:800px!important;overflow:hidden!important}body{display:grid;place-items:center;background:#1f2421}.shell{width:370px;transform:scale(1.92);box-shadow:0 14px 40px rgba(0,0,0,.3);border:1px solid #3c4540;border-radius:9px;background:#1f2421}" });
  await popup.screenshot({ path: path.join(output, "01-popup.png") });
  await popup.close();

  // 2. Real YouTube, before and after. Search results are used rather than the home feed, because a
  //    signed-out home page carries no recommendations at all and so has no Shorts to remove.
  const YT_SEARCH = "https://www.youtube.com/results?search_query=lofi+study";
  const ytBefore = path.join(scratch, "yt-before.png");
  const ytAfter = path.join(scratch, "yt-after.png");
  const ytLiveReady = await reachableSignedOut(YT_SEARCH, "ytd-video-renderer");
  if (ytLiveReady) {
    const ytViewport = { width: 860, height: 900 };
    await setState(worker, false);
    const offset = await capturePage(YT_SEARCH, ytBefore, { viewport: ytViewport });
    await setState(worker, true);
    await capturePage(YT_SEARCH, ytAfter, { viewport: ytViewport, scrollTo: offset });
    await compose(path.join(output, "02-youtube-before-after.png"), "Real YouTube results, without the Shorts", [{ label: "Before", path: ytBefore }, { label: "With ReelLess", path: ytAfter }]);
    console.log("02-youtube-before-after.png captured from the live site.");
  } else {
    skipped.push("02-youtube-before-after.png (YouTube search was not reachable)");
  }

  // 3. Actual Advanced settings with optional access language visible.
  const advanced = await context.newPage();
  await advanced.setViewportSize({ width: 1280, height: 800 });
  await advanced.goto(`chrome-extension://${id}/options.html`);
  await advanced.locator("details.advanced > summary").click();
  await advanced.locator("#moreSitesTitle").scrollIntoViewIfNeeded();
  await advanced.addStyleTag({ content: "::-webkit-scrollbar{display:none}" });
  await advanced.screenshot({ path: path.join(output, "04-advanced-settings.png") });
  await advanced.close();

  // 4. The real focus screen running in Chromium over either the live signed-out TikTok page or a
  //    privacy-safe TikTok test surface when the live site cannot be reached from CI.
  const focus = path.join(scratch, "focus.png");
  const tiktokLive = await reachableSignedOut("https://www.tiktok.com/", "a[href*='/video/'], [data-e2e]");
  if (tiktokLive) {
    await capturePage("https://www.tiktok.com/", focus, { viewport: { width: 1180, height: 720 } });
  } else {
    const tiktok = await context.newPage();
    await tiktok.setViewportSize({ width: 1180, height: 720 });
    await tiktok.route("https://www.tiktok.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: tiktokTestPage }));
    await tiktok.goto("https://www.tiktok.com/");
    await tiktok.waitForSelector("#reelless-focus-screen");
    const title = await tiktok.locator("#reelless-focus-title").textContent();
    if (!/TikTok is outside your focus plan/i.test(title || "")) throw new Error("TikTok focus screen did not render in Chromium");
    if (!await tiktok.locator('[data-action="pause"]').isVisible() || !await tiktok.locator('[data-action="settings"]').isVisible()) {
      throw new Error("TikTok focus-screen actions were not visible in Chromium");
    }
    await tiktok.screenshot({ path: focus });
    await tiktok.close();
    notes.push("05-focus-count.png used the privacy-safe TikTok Chrome test surface because the live signed-out site was unreachable");
  }
  await compose(path.join(output, "05-focus-count.png"), "TikTok stops before the feed starts", [{ label: "Blocked by ReelLess in Chrome", path: focus }]);

  // 5. Privacy-safe README overview. This is the real Settings DOM in a temporary profile,
  //    compacted with capture-only CSS so all eleven supported sites fit in one frame.
  const supportedSites = await context.newPage();
  await supportedSites.setViewportSize({ width: 1280, height: 800 });
  await supportedSites.goto(`chrome-extension://${id}/options.html`);
  await supportedSites.waitForSelector("[data-platform-card='youtube']");
  await supportedSites.evaluate(() => { document.querySelector("details.advanced").open = true; });
  await supportedSites.addStyleTag({ content: `
    html,body{width:1280px!important;height:800px!important;overflow:hidden!important}
    body{background:#1f2421!important}
    .site-header,.hero,.appearance,.advanced>summary,.advanced-intro,.routine-section,
    #customSection,#ultimateDetails,.coverage,.local-data,.help,.privacy{display:none!important}
    main{width:100%!important;max-width:none!important;margin:0!important;padding:28px 32px!important}
    .core-section{margin:0!important;padding:24px!important}
    .core-section .section-title{margin-bottom:18px!important}
    .core-section .section-title p,.core-footnote{display:none!important}
    #corePlatforms{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:12px!important}
    .platform-card{min-height:0!important;padding:15px!important}
    .platform-card>:not(.platform-head){display:none!important}
    .platform-head{align-items:center!important;gap:9px!important}
    .platform-titles small{white-space:normal!important}
    .core-toggle{margin-left:auto!important}
    details.advanced{display:block!important;margin:16px 0 0!important;padding:0!important;border:0!important;background:transparent!important}
    .advanced-body{display:block!important;padding:0!important}
    #moreSitesSection{display:grid!important;grid-template-columns:260px 1fr!important;gap:18px!important;margin:0!important;padding:22px 24px!important;border:1px solid #39473f!important;border-radius:12px!important;background:#242c27!important}
    #moreSitesSection>div:first-child p{margin:7px 0 0!important}
    #advancedPlatforms{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:9px!important}
    .advanced-platform{margin:0!important}
    .advanced-platform>summary{min-height:48px!important;padding:11px 14px!important}
    .advanced-platform-body{display:none!important}
    ::-webkit-scrollbar{display:none!important}
  ` });
  await supportedSites.screenshot({ path: path.join(output, "06-supported-sites.png") });
  await supportedSites.close();

  // 6. The real per-section controls with deliberate demo choices. Settings are written only to
  //    the temporary capture profile and contain no account or browsing data.
  await worker.evaluate(async () => {
    const stored = await chrome.storage.local.get("settingsV2");
    const settings = ReelLess.normalizeSettings(stored.settingsV2 || ReelLess.getDefaultSettings());
    settings.platforms.youtube.mode = "selected";
    settings.platforms.youtube.sections = { shorts: true, home: true, trending: true, subscriptions: false, gaming: false };
    settings.platforms.youtube.surfaces.homeFeed = true;
    settings.platforms.instagram.mode = "selected";
    settings.platforms.instagram.sections = { reels: true, home: false, explore: true, stories: true };
    await chrome.storage.local.set({ settingsV2: settings });
  });
  const sectionControls = await context.newPage();
  await sectionControls.setViewportSize({ width: 1280, height: 800 });
  await sectionControls.goto(`chrome-extension://${id}/options.html`);
  await sectionControls.waitForSelector("[data-section-choices='youtube']:not([hidden])");
  await sectionControls.addStyleTag({ content: `
    html,body{width:1280px!important;height:800px!important;overflow:hidden!important}
    body{background:#1f2421!important}
    .site-header,.hero,.appearance,.advanced,.coverage,.local-data,.help,.privacy{display:none!important}
    main{width:100%!important;max-width:none!important;margin:0!important;padding:28px 32px!important}
    .core-section{margin:0!important;padding:24px!important}
    .core-section .section-title{margin-bottom:18px!important}
    .core-section .section-title p,.core-footnote{display:none!important}
    #corePlatforms{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:16px!important}
    [data-platform-card='facebook'],[data-platform-card='tiktok']{display:none!important}
    .platform-card{min-height:0!important;padding:18px!important}
    .mode-group{margin-top:14px!important}
    .mode-summary{margin:11px 0!important}
    .section-picker{padding:14px!important}
    .section-list{gap:7px!important}
    .section-option{padding:9px 10px!important}
    .section-option small,.surface-subgroup{display:none!important}
    .entry-choice{margin-top:12px!important}
    ::-webkit-scrollbar{display:none!important}
  ` });
  await sectionControls.screenshot({ path: path.join(output, "07-section-controls.png") });
  await sectionControls.close();

  // 7–8. Live YouTube navigation and direct-link behavior. These frames are generated only from
  //      the real signed-out site; an unavailable network leaves the previous verified files alone.
  if (ytLiveReady) {
    const setYouTubeNavigationState = async (enabled, blockHome) => {
      await worker.evaluate(async ({ enabled, blockHome }) => {
        const stored = await chrome.storage.local.get("settingsV2");
        const settings = ReelLess.normalizeSettings(stored.settingsV2 || ReelLess.getDefaultSettings());
        settings.protectionEnabled = enabled;
        settings.pausedUntil = null;
        settings.schedulePreset = "always";
        settings.platforms.youtube.mode = "selected";
        settings.platforms.youtube.entryPoints = "hide";
        settings.platforms.youtube.sections = { shorts: true, home: blockHome, trending: true, subscriptions: false, gaming: false };
        await chrome.storage.local.set({ settingsV2: settings });
      }, { enabled, blockHome });
      await new Promise((resolve) => setTimeout(resolve, 250));
    };
    const navVisibility = (page) => page.evaluate(() => {
      const visible = (selector) => Array.from(document.querySelectorAll(selector)).some((node) => node.getClientRects().length > 0);
      return {
        home: visible('ytd-guide-entry-renderer a[href="/"], ytd-mini-guide-entry-renderer a[href="/"]'),
        shorts: visible('ytd-guide-entry-renderer a[href*="/shorts"], ytd-mini-guide-entry-renderer a[href*="/shorts"], a[title="Shorts"]'),
        subscriptions: visible('ytd-guide-entry-renderer a[href^="/feed/subscriptions"], ytd-mini-guide-entry-renderer a[href^="/feed/subscriptions"]')
      };
    });
    const youtube = await context.newPage();
    await youtube.setViewportSize({ width: 1280, height: 800 });
    await setYouTubeNavigationState(false, true);
    await youtube.goto(YT_SEARCH, { waitUntil: "domcontentloaded", timeout: 45000 });
    await youtube.waitForSelector("ytd-video-renderer", { timeout: 20000 });
    await youtube.waitForTimeout(4000);
    const beforeVisibility = await navVisibility(youtube);
    if (!beforeVisibility.home || !beforeVisibility.shorts || !beforeVisibility.subscriptions) {
      throw new Error(`Live YouTube before-state navigation was incomplete: ${JSON.stringify(beforeVisibility)}`);
    }
    const shortHref = await youtube.locator('a[href*="/shorts/"]').first().getAttribute("href");
    if (!shortHref) throw new Error("Live YouTube results did not expose a Short URL");
    const youtubeBefore = path.join(scratch, "youtube-tabs-before.png");
    const youtubeAfter = path.join(scratch, "youtube-tabs-after.png");
    await youtube.screenshot({ path: youtubeBefore, clip: { x: 0, y: 0, width: 360, height: 800 } });
    await setYouTubeNavigationState(true, true);
    await youtube.waitForFunction(() => document.documentElement.dataset.reellessMode === "hide");
    await youtube.waitForTimeout(1200);
    const afterVisibility = await navVisibility(youtube);
    if (afterVisibility.home || afterVisibility.shorts || !afterVisibility.subscriptions) {
      throw new Error(`Live YouTube hidden-navigation assertion failed: ${JSON.stringify(afterVisibility)}`);
    }
    await youtube.screenshot({ path: youtubeAfter, clip: { x: 0, y: 0, width: 360, height: 800 } });
    await composeArrowComparison(
      path.join(output, "08-youtube-tabs-before-after.png"),
      "Live YouTube: protected navigation disappears",
      youtubeBefore,
      youtubeAfter,
      "Before — Home and Shorts are visible",
      "After — Home and Shorts are fully hidden"
    );

    await setYouTubeNavigationState(true, false);
    await youtube.goto(new URL(shortHref, "https://www.youtube.com/").href, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    await youtube.waitForSelector("#reelless-focus-screen", { timeout: 15000 });
    const focusResult = await youtube.evaluate(() => ({
      title: document.getElementById("reelless-focus-title")?.textContent || "",
      links: Array.from(document.querySelectorAll("#reelless-focus-screen .reelless-links a"), (link) => link.textContent)
    }));
    if (!/outside your focus plan/i.test(focusResult.title) || !focusResult.links.includes("Home") || !focusResult.links.includes("Subscriptions")) {
      throw new Error(`Live YouTube focus-screen assertion failed: ${JSON.stringify(focusResult)}`);
    }
    await youtube.addStyleTag({ content: "body{filter:blur(12px)!important}" });
    const youtubeFocus = path.join(scratch, "youtube-focus.png");
    await youtube.screenshot({ path: youtubeFocus });
    await youtube.close();
    await compose(path.join(output, "09-youtube-focus-screen.png"), "A YouTube link cannot bypass your focus plan", [{ label: "Choose an allowed page, pause, or open settings", path: youtubeFocus }]);
    console.log("08-youtube-tabs-before-after.png and 09-youtube-focus-screen.png captured from live YouTube.");
  } else {
    skipped.push("08-youtube-tabs-before-after.png and 09-youtube-focus-screen.png (YouTube was not reachable)");
  }

  // Small promotional tile, rendered from the same brand/UI palette.
  const promo = await context.newPage();
  await promo.setViewportSize({ width: 440, height: 280 });
  await promo.setContent(`<!doctype html><style>*{box-sizing:border-box}body{margin:0;padding:28px;background:#1b211d;color:#edf1ed;font-family:"Segoe UI",Arial,sans-serif}.top{display:flex;align-items:center;gap:12px}.top img{width:48px;height:48px;border-radius:8px}.top strong{font-size:21px}h1{max-width:350px;margin:29px 0 12px;font-size:31px;font-weight:680;line-height:1;letter-spacing:-.045em}p{margin:0;color:#b7c2ba;font-size:13px}.pill{position:absolute;right:24px;bottom:22px;padding:7px 10px;border:1px solid #486a57;border-radius:999px;color:#aad0b8;font-size:10px;font-weight:800;letter-spacing:.06em}</style><div class="top"><img src="data:image/png;base64,${fs.readFileSync(path.join(root, "icons", "icon-128.png")).toString("base64")}"><strong>ReelLess</strong></div><h1>Keep the useful parts.</h1><p>Shorts & Reels blocker for Chrome</p><span class="pill">LOCAL ONLY</span>`);
  await promo.screenshot({ path: path.join(output, "promo-440x280.png") });
  await promo.close();

  // Optional Store marquee using the same palette and message as the product UI.
  const marquee = await context.newPage();
  await marquee.setViewportSize({ width: 1400, height: 560 });
  await marquee.setContent(`<!doctype html><style>*{box-sizing:border-box}body{display:grid;grid-template-columns:1.1fr .9fr;gap:60px;align-items:center;width:1400px;height:560px;margin:0;padding:68px 96px;background:#1b211d;color:#edf1ed;font-family:"Segoe UI",Arial,sans-serif}.brand{display:flex;align-items:center;gap:13px;font-size:22px;font-weight:750}.brand img{width:52px;height:52px;border-radius:10px}h1{max-width:620px;margin:30px 0 16px;font-size:58px;font-weight:680;line-height:.97;letter-spacing:-.06em}p{max-width:520px;margin:0;color:#b7c2ba;font-size:18px;line-height:1.5}.card{padding:24px;border:1px solid #405148;border-radius:14px;background:#242c27}.status{display:flex;align-items:center;gap:9px;padding-bottom:18px;border-bottom:1px solid #3b4941;font-size:14px;font-weight:700}.dot{width:9px;height:9px;border-radius:50%;background:#4c9a77}.counts{display:grid;grid-template-columns:1fr 1fr;margin:18px 0;border-bottom:1px solid #3b4941}.counts div{padding:0 0 17px}.counts div+div{padding-left:18px;border-left:1px solid #3b4941}.counts strong,.counts span{display:block}.counts strong{font-size:29px}.counts span{margin-top:5px;color:#afbbb2;font-size:11px}.sites{display:grid;gap:8px}.site{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #35433b;font-size:12px}.site b{color:#aad4ba}</style><div><div class="brand"><img src="data:image/png;base64,${fs.readFileSync(path.join(root, "icons", "icon-128.png")).toString("base64")}"><span>ReelLess</span></div><h1>Keep the useful parts. Lose the endless video.</h1><p>Short-form protection for YouTube, Instagram, Facebook, and TikTok.</p></div><div class="card"><div class="status"><span class="dot"></span><span>Protection is active</span></div><div class="counts"><div><strong>12</strong><span>blocked today</span></div><div><strong>146</strong><span>since install</span></div></div><div class="sites"><div class="site"><span>YouTube Shorts</span><b>On</b></div><div class="site"><span>Instagram Reels</span><b>On</b></div><div class="site"><span>Facebook Reels</span><b>On</b></div><div class="site"><span>TikTok feeds</span><b>On</b></div></div></div>`);
  await marquee.screenshot({ path: path.join(output, "marquee-1400x560.png") });
  await marquee.close();

  fs.copyFileSync(path.join(output, "01-popup.png"), path.join(output, "screenshot-1280x800.png"));
  console.log("Wrote the 1280×800 listing screenshots, the 440×280 promo tile, and the 1400×560 marquee tile.");
  if (skipped.length) {
    console.log("");
    console.log("NOT regenerated, previous files left in place:");
    for (const item of skipped) console.log(`  - ${item}`);
    console.log("");
  }
  if (notes.length) {
    console.log("");
    console.log("Capture notes:");
    for (const item of notes) console.log(`  - ${item}`);
  }
} finally {
  if (context) await context.close();
  if (profile.startsWith(os.tmpdir())) fs.rmSync(profile, { recursive: true, force: true });
  if (scratch.startsWith(os.tmpdir())) fs.rmSync(scratch, { recursive: true, force: true });
}
