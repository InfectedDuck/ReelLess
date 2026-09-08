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

// Captures a live page rather than a served fixture. Returns the scroll offset it settled on, so
// the matching "after" capture can be taken from exactly the same position and the two frames
// differ only by what ReelLess removed.
async function capturePage(url, destination, { viewport = { width: 1280, height: 800 }, scrollTo = null, settle = 5000 } = {}) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(settle);
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

const skipped = [];

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
  if (await reachableSignedOut(YT_SEARCH, "ytd-video-renderer")) {
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

  // 3. Instagram and Facebook show a login wall to a signed-out browser, so this frame can only be
  //    captured from a profile that is already signed in. It is skipped rather than faked.
  const ig = path.join(scratch, "instagram.png");
  const fb = path.join(scratch, "facebook.png");
  const igReady = await reachableSignedOut("https://www.instagram.com/", "article, [role='article']");
  const fbReady = await reachableSignedOut("https://www.facebook.com/", "[role='feed'], [role='article']");
  if (igReady && fbReady) {
    await setState(worker, true);
    await capturePage("https://www.instagram.com/", ig, { viewport: { width: 640, height: 720 } });
    await capturePage("https://www.facebook.com/", fb, { viewport: { width: 640, height: 720 } });
    await compose(path.join(output, "03-instagram-facebook.png"), "Reels links disappear; useful sections remain", [{ label: "Instagram", path: ig }, { label: "Facebook", path: fb }]);
    console.log("03-instagram-facebook.png captured from the live sites.");
  } else {
    skipped.push("03-instagram-facebook.png (Instagram and Facebook require a signed-in profile; see REELLESS_PROFILE below)");
  }

  // 4. Actual Advanced settings with optional access language visible.
  const advanced = await context.newPage();
  await advanced.setViewportSize({ width: 1280, height: 800 });
  await advanced.goto(`chrome-extension://${id}/options.html`);
  await advanced.locator("details.advanced > summary").click();
  await advanced.locator("#moreSitesTitle").scrollIntoViewIfNeeded();
  await advanced.addStyleTag({ content: "::-webkit-scrollbar{display:none}" });
  await advanced.screenshot({ path: path.join(output, "04-advanced-settings.png") });
  await advanced.close();

  // 5. Actual focus screen beside the actual counted-attempt popup.
  const focus = path.join(scratch, "focus.png");
  const tiktokLive = await reachableSignedOut("https://www.tiktok.com/", "a[href*='/video/'], [data-e2e]");
  if (tiktokLive) {
    await capturePage("https://www.tiktok.com/", focus, { viewport: { width: 820, height: 720 } });
  } else {
    skipped.push("05-focus-count.png used a fixture because TikTok was not reachable");
    await screenshotUrl("https://www.tiktok.com/", "https://www.tiktok.com/**", `<style>${fixtureStyle}</style><main><h1>TikTok</h1></main>`, focus, { width: 820, height: 720 });
  }
  const miniPopup = path.join(scratch, "popup.png");
  const countPage = await context.newPage();
  await countPage.setViewportSize({ width: 460, height: 720 });
  await countPage.goto(`chrome-extension://${id}/popup.html`);
  await countPage.waitForSelector(".shell");
  await countPage.addStyleTag({ content: "html,body{width:460px!important;height:720px!important;overflow:hidden!important}body{display:grid;place-items:center;background:#1f2421}.shell{width:370px}" });
  await countPage.screenshot({ path: miniPopup });
  await countPage.close();
  await compose(path.join(output, "05-focus-count.png"), "A blocked page and local counts", [{ label: "TikTok focus screen", path: focus }, { label: "Local counts", path: miniPopup }], ["1.55fr", ".85fr"]);

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
    console.log("To capture the signed-in frames, point REELLESS_PROFILE at a Chrome profile directory");
    console.log("that is already logged in to Instagram and Facebook, then run this script again.");
  }
} finally {
  if (context) await context.close();
  if (profile.startsWith(os.tmpdir())) fs.rmSync(profile, { recursive: true, force: true });
  if (scratch.startsWith(os.tmpdir())) fs.rmSync(scratch, { recursive: true, force: true });
}
