import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const extensionPath = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"));
const candidates = [
  process.env.REELLESS_CHROME_PATH,
  chromium.executablePath(),
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable"
].filter(Boolean);
const executablePath = candidates.find((candidate) => fs.existsSync(candidate));
if (!executablePath) throw new Error("Chrome for Testing was not found. Run: npx playwright-core install chromium");

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "reelless-smoke-"));
const browserErrors = [];
let context;

function observePage(page) {
  page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });
}

try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath,
    // Chrome does not load unpacked extensions reliably in its regular headless mode.
    // Set REELLESS_HEADLESS=1 only on a runner whose Chrome build supports extensions there.
    headless: process.env.REELLESS_HEADLESS === "1",
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });
  context.on("page", observePage);
  context.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`context console: ${message.text()}`);
  });
  context.on("weberror", (error) => browserErrors.push(`web error: ${error.error().message}`));
  context.pages().forEach(observePage);

  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  assert.ok(extensionId, "extension service worker should have an id");

  const popup = await context.newPage();
  observePage(popup);
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForSelector("text=Protected sites");
  assert.equal(await popup.locator(".platform-row").count(), 4);
  assert.equal(await popup.locator("#statusText").textContent(), "Protection is active");

  const settings = await context.newPage();
  observePage(settings);
  await settings.goto(`chrome-extension://${extensionId}/options.html`);
  await settings.waitForSelector("text=Core protection");
  assert.equal(await settings.locator("#corePlatforms .platform-card").count(), 4);
  assert.equal(await settings.locator("#advancedPlatforms .advanced-platform").count(), 7);
  // The Android gate sets the hidden attribute. Check the attribute rather than visibility, which
  // would also be false simply because the Advanced workspace starts collapsed.
  assert.equal(await settings.locator("#moreSitesSection").getAttribute("hidden"), null, "optional sites stay available on desktop");
  assert.equal(await settings.locator("#customSection").getAttribute("hidden"), null, "custom pages stay available on desktop");
  assert.notEqual(await settings.locator("#mobileNotice").getAttribute("hidden"), null, "the Android notice must stay hidden on desktop");
  assert.equal(await settings.locator("details.advanced").getAttribute("open"), null, "Advanced controls should start collapsed");
  assert.equal(await settings.locator(".advanced-summary-action").count(), 1, "Advanced controls should have a visible disclosure affordance");
  assert.equal(await settings.locator(".advanced-chevron").count(), 1, "Advanced controls should show a state chevron");
  assert.equal(await settings.locator("input[data-direct-toggle]").count(), 0, "Retired Direct-video controls must not appear in Settings");
  await settings.locator("details.advanced > summary").click();
  assert.equal(await settings.locator("details.advanced").getAttribute("open"), "", "Advanced controls should open for Ultimate Lock checks");
  await settings.locator("#ultimateDetails > summary").click();
  assert.equal(await settings.locator("#ultimateSetup").isVisible(), true, "Ultimate Lock setup should be visible before enabling it");
  assert.equal(await settings.locator("#ultimateRelease").isHidden(), true, "Ultimate Lock removal controls must stay hidden before enabling it");
  await settings.locator("#ultimateDetails > summary").click();
  await settings.locator("details.advanced > summary").click();
  assert.equal(await settings.locator("#appearance").inputValue(), "dark", "dark should be the default appearance");
  await settings.selectOption("#appearance", "light");
  await settings.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await settings.selectOption("#appearance", "dark");
  await settings.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await settings.waitForTimeout(300);
  await settings.locator("details.advanced > summary").click();
  assert.equal(await settings.locator("details.advanced").getAttribute("open"), "", "Advanced controls should open from the full disclosure row");
  await settings.selectOption("#schedulePreset", "custom");
  await settings.fill("#customStart", "22:00");
  await settings.fill("#customEnd", "07:00");
  await settings.waitForTimeout(300);
  await settings.selectOption("#schedulePreset", "always");
  await settings.waitForTimeout(300);

  const youtube = await context.newPage();
  observePage(youtube);
  await youtube.route("https://www.youtube.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<main id="main"><ytd-reel-shelf-renderer id="shorts"><a href="/shorts/abc">Shorts</a></ytd-reel-shelf-renderer><a id="lesson" href="/watch?v=lesson">Lesson</a></main>`
  }));
  await youtube.goto("https://www.youtube.com/watch?v=fixture");
  // Assert the outcome, not the mechanism: on a browser with :has() the stylesheet hides this
  // before it is ever painted and no attribute is written at all.
  await youtube.waitForFunction(() => {
    const shelf = document.querySelector("#shorts");
    return shelf && shelf.getClientRects().length === 0;
  });
  assert.equal(await youtube.locator("#lesson").isVisible(), true, "ordinary videos must stay");
  assert.equal(await youtube.locator("#main").getAttribute("data-reelless-hidden"), null);
  assert.equal(
    await youtube.evaluate(() => document.documentElement.dataset.reellessMode),
    "hide",
    "the stylesheet gate should be in hide mode"
  );
  assert.equal(
    await youtube.evaluate(() => document.querySelectorAll("[data-reelless-hidden]").length),
    0,
    "with :has() available the script should not be marking elements at all"
  );
  // A direct Short visit is blocked in place with the focus screen. It used to convert to
  // the /watch URL, but YouTube plays Shorts videos on /watch pages too, so the Short stayed
  // fully watchable.
  await youtube.goto("https://www.youtube.com/shorts/directfixture");
  await youtube.waitForSelector("#reelless-focus-screen");
  assert.equal(
    await youtube.evaluate(() => window.location.pathname),
    "/shorts/directfixture",
    "a Short must not convert to a watchable /watch URL"
  );

  // Keep mode leaves the Shorts shelf visible but still stops an attempt to open a Short.
  await settings.bringToFront();
  assert.equal(await settings.locator("#corePlatforms select[data-entry-points]").count(), 4, "each core card offers the entry-point choice");
  assert.equal(await settings.locator('#corePlatforms [data-entry-choice="tiktok"]').isHidden(), false, "shortform TikTok still configures feed entry points on allowed utility pages");
  assert.equal(await settings.locator('#corePlatforms select[data-entry-points="youtube"]').inputValue(), "hide", "hiding is the default");
  await settings.selectOption('#corePlatforms select[data-entry-points="youtube"]', "keep");
  await settings.waitForTimeout(300);
  assert.equal(await settings.locator('#corePlatforms select[data-entry-points="youtube"]').inputValue(), "keep", "the core card keeps its entry-point choice");

  // Optional page surfaces: present, off by default, and offered only where a platform declares them.
  // Core cards are the single place for core choices now (no detailed-core duplicate).
  const surfaceBoxes = settings.locator('#corePlatforms input[data-surface][data-platform="youtube"]');
  assert.equal(await surfaceBoxes.count(), 5, "YouTube should offer its five optional surfaces");
  for (let i = 0; i < 5; i += 1) {
    assert.equal(await surfaceBoxes.nth(i).isChecked(), false, "every surface must start off");
  }
  assert.equal(await settings.locator('#corePlatforms input[data-surface][data-platform="instagram"]').count(), 0, "platforms without surfaces show no surface controls");
  await surfaceBoxes.first().check();
  await settings.waitForTimeout(400);
  assert.equal(
    await settings.evaluate(async () => (await chrome.storage.local.get("settingsV2")).settingsV2.platforms.youtube.surfaces.homeFeed),
    true,
    "toggling a surface should persist"
  );
  await surfaceBoxes.first().uncheck();
  await settings.waitForTimeout(400);
  await youtube.goto("https://www.youtube.com/watch?v=fixture");
  await youtube.waitForTimeout(300);
  assert.equal(await youtube.locator("#shorts").isVisible(), true, "keep mode shows the Shorts shelf");
  assert.equal(
    await youtube.evaluate(() => document.documentElement.dataset.reellessMode),
    "keep",
    "the stylesheet gate should be released in keep mode"
  );
  await youtube.locator("#shorts a").click();
  await youtube.waitForSelector("#reelless-focus-screen");
  assert.equal(
    await youtube.evaluate(() => window.location.pathname),
    "/watch",
    "a blocked Short click must not navigate away from the page"
  );
  await settings.selectOption('#corePlatforms select[data-entry-points="youtube"]', "hide");
  await settings.waitForTimeout(300);
  await youtube.goto("https://www.youtube.com/watch?v=fixture");
  await youtube.waitForFunction(() => {
    const shelf = document.querySelector("#shorts");
    return shelf && shelf.getClientRects().length === 0;
  });

  // Instagram and Facebook are hidden by the stylesheet too. jsdom cannot evaluate :has(), so this
  // is where the rules themselves are held to their contract: the innermost card around a Reel
  // link goes, a wrapper holding another post stays, nothing containing <main> is touched, and the
  // nav-rail entry and profile tab (which sit outside any card) go on their own. Outcomes are
  // asserted through layout, not markers, since no marker is written on this path.
  const hiddenIds = (page) => page.evaluate(() => Array.from(document.querySelectorAll("[id]"))
    .filter((node) => node.getClientRects().length === 0 && node.id !== "reelless-focus-screen")
    .map((node) => node.id).sort());
  const instagramFeed = `<main role="main" id="main">
    <nav id="rail"><a id="rail-home" href="/">Home</a><a id="rail-reels" href="/reels/">Reels</a><a id="rail-explore" href="/explore/">Explore</a></nav>
    <div id="feed">
      <article id="post"><a href="/alice/">alice</a><a href="/p/AAA/">post</a></article>
      <article id="reel"><a href="/bob/">bob</a><a href="/reel/XYZ/">reel</a></article>
      <div role="listitem" id="reel-item"><a href="/reel/ABC/">reel</a></div>
      <article id="wrapper"><article id="inner-post"><a href="/p/BBB/">post</a></article><article id="inner-reel"><a href="/reel/DEF/">reel</a></article></article>
    </div>
    <div id="tabs"><a id="tab-posts" href="/nasa/">Posts</a><a id="tab-reels" href="/nasa/reels/">Reels</a><a id="tab-tagged" href="/nasa/tagged/">Tagged</a></div>
  </main>`;
  const instagram = await context.newPage();
  observePage(instagram);
  await instagram.route("https://www.instagram.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: instagramFeed }));
  await instagram.goto("https://www.instagram.com/");
  await instagram.waitForFunction(() => document.documentElement.dataset.reellessMode === "hide");
  assert.deepEqual(await hiddenIds(instagram), ["rail-reels", "tab-reels"], "Instagram: the nav-rail entry and the profile tab collapse outright");
  // On Home the feed keeps its geometry: Reel cards collapse to a compact placeholder
  // instead of disappearing, so the loader never retriggers mid-scroll.
  for (const id of ["reel", "reel-item", "inner-reel"]) {
    const box = await instagram.evaluate((elId) => {
      const node = document.getElementById(elId);
      const rect = node.getBoundingClientRect();
      return { height: rect.height, visibility: getComputedStyle(node).visibility };
    }, id);
    assert.equal(box.height, 56, `Instagram: ${id} keeps a compact placeholder`);
    assert.equal(box.visibility, "visible", `Instagram: ${id} placeholder stays laid out`);
  }
  assert.equal(await instagram.locator("#post").evaluate((node) => node.getBoundingClientRect().height === 56), false, "ordinary posts keep their natural height");
  assert.equal(await instagram.evaluate(() => document.querySelectorAll("[data-reelless-hidden]").length), 0, "with :has() the script must not mark anything on Instagram");

  // A page whose only card wraps the main region must never lose that region.
  await instagram.route("https://www.instagram.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<div role="listitem" id="holds-main"><main id="main"><h1 id="heading">Profile</h1><a id="tile" href="/reel/TILE/">tile</a></main></div>`
  }));
  await instagram.goto("https://www.instagram.com/nasa/");
  await instagram.waitForFunction(() => document.documentElement.dataset.reellessMode === "hide");
  assert.deepEqual(await hiddenIds(instagram), ["tile"], "a card containing <main> stays; only the bare Reel tile goes");

  // Selected sections with Reels deliberately unchecked releases the gate: the Reels they kept stay.
  const savedSettings = await worker.evaluate(async () => (await chrome.storage.local.get("settingsV2")).settingsV2);
  await worker.evaluate(async (current) => {
    const next = JSON.parse(JSON.stringify(current));
    next.platforms.instagram.mode = "selected";
    next.platforms.instagram.sections = { reels: false, explore: false };
    await chrome.storage.local.set({ settingsV2: next });
  }, savedSettings);
  await instagram.route("https://www.instagram.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: instagramFeed }));
  await instagram.goto("https://www.instagram.com/");
  await instagram.waitForFunction(() => document.documentElement.dataset.reellessMode === "keep");
  assert.deepEqual(await hiddenIds(instagram), [], "Reels unchecked in Selected sections must hide nothing");
  await worker.evaluate(async (saved) => { await chrome.storage.local.set({ settingsV2: saved }); }, savedSettings);
  await instagram.goto("https://www.instagram.com/reel/directfixture");
  await instagram.waitForURL("https://www.instagram.com/");

  // A Direct thread is never modified, even when it carries a Reel link; opening it is still refused.
  const instagramDirect = await context.newPage();
  observePage(instagramDirect);
  await instagramDirect.route("https://www.instagram.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: route.request().url().includes("/direct/")
      ? "<main id=conversation><p>Friend message</p><button id=playVideo aria-label='Play video'>Play</button><video id=friendVideo controls></video><article id=sharedCard><a id=sharedReel href='/reel/fromfriend/'>Watch this</a></article></main>"
      : instagramFeed
  }));
  await instagramDirect.goto("https://www.instagram.com/direct/t/friend");
  await instagramDirect.waitForTimeout(250);
  assert.equal(await instagramDirect.evaluate(() => document.documentElement.dataset.reellessMode), "off", "a Direct thread releases the stylesheet gate");
  assert.equal(await instagramDirect.locator("#friendVideo").getAttribute("data-reelless-direct-video"), null, "Direct-message videos must remain outside ReelLess protection");
  assert.equal(await instagramDirect.locator("#conversation").getAttribute("data-reelless-hidden"), null, "direct conversation layout must remain");
  assert.equal(await instagramDirect.locator("#reelless-direct-blocked-notice").count(), 0);
  assert.deepEqual(await hiddenIds(instagramDirect), [], "nothing in a Direct thread is hidden, Reel link included");
  await instagramDirect.locator("#sharedReel").click();
  await instagramDirect.waitForTimeout(400);
  assert.equal(await instagramDirect.evaluate(() => window.location.pathname), "/direct/t/friend", "a Reel opened from a conversation is refused in place and returns to the thread");
  assert.equal(await instagramDirect.locator("#reelless-focus-screen").count(), 0, "a refused conversation open raises no screen");

  // A profile's Reels tab returns to that profile rather than the generic feed.
  await instagram.goto("https://www.instagram.com/nasa/reels/");
  await instagram.waitForURL("https://www.instagram.com/nasa/");

  const facebookFeed = `<main id="main">
    <div role="feed" id="feed">
      <div role="article" id="fb-post"><a href="/friend">Friend</a><a href="/photo/?fbid=1">photo</a></div>
      <div role="article" id="fb-reels-unit"><h3 id="fb-reels-heading">Reels and short videos</h3><a href="/reel/111/">R1</a><a href="/reel/222/">R2</a></div>
      <div role="article" id="fb-shared"><a id="fb-shared-link" href="/reel/333/">Shared reel</a><div role="article" id="fb-comment"><a href="/friend2">Friend2</a></div></div>
    </div>
    <ul id="nav"><li id="nav-reels"><a href="/reel/?s=ifu">Reels</a></li><li id="nav-friends"><a href="/friends/">Friends</a></li></ul>
  </main>`;
  const facebook = await context.newPage();
  observePage(facebook);
  await facebook.route("https://www.facebook.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: route.request().url().includes("/messages/")
      ? "<main id=conversation><p>Friend message</p><a id=sharedReel href='/reel/999/'>Reel</a></main>"
      : facebookFeed
  }));
  await facebook.goto("https://www.facebook.com/");
  await facebook.waitForFunction(() => document.documentElement.dataset.reellessMode === "hide");
  // Feed posts keep their geometry as placeholders; navigation chrome outside the feed
  // collapses outright rather than showing a notice.
  assert.deepEqual(await hiddenIds(facebook), ["nav-reels"], "Facebook: only nav chrome collapses; feed posts keep placeholders");
  // The Reels shelf keeps a compact placeholder with its heading; a post holding a comment
  // thread keeps its place while its Reel link goes invisible.
  const fbUnit = await facebook.evaluate(() => {
    const node = document.getElementById("fb-reels-unit");
    const rect = node.getBoundingClientRect();
    return { height: rect.height, visibility: getComputedStyle(node).visibility };
  });
  assert.equal(fbUnit.height, 56, "Facebook: the Reels shelf keeps a compact placeholder");
  assert.equal(fbUnit.visibility, "visible", "Facebook: the Reels placeholder stays laid out");
  assert.equal(
    await facebook.evaluate(() => getComputedStyle(document.getElementById("fb-shared-link")).visibility),
    "hidden",
    "Facebook: the comment-thread post keeps its place while its Reel link goes invisible"
  );
  assert.equal(await facebook.locator("#fb-post").evaluate((node) => node.getBoundingClientRect().height === 56), false, "ordinary Facebook posts keep their natural height");
  // Watch is part of the default protection and needs the script (pausing, dialog blocking),
  // so the script stays on for Facebook even where :has() exists; Reels hiding is still asserted
  // through layout above. The default must also arm the video-post rule.
  assert.ok((await facebook.evaluate(() => document.documentElement.dataset.reellessSurfaces || "")).includes("videoPosts"), "default protection must arm the Facebook video-post rule");
  await facebook.goto("https://www.facebook.com/messages/t/12345/");
  await facebook.waitForTimeout(250);
  assert.equal(await facebook.evaluate(() => document.documentElement.dataset.reellessMode), "off", "Messenger releases the stylesheet gate");
  assert.deepEqual(await hiddenIds(facebook), [], "nothing in a Messenger thread is hidden, Reel link included");
  await facebook.locator("#sharedReel").click();
  await facebook.waitForTimeout(400);
  assert.equal(await facebook.evaluate(() => window.location.pathname), "/messages/t/12345/", "a Reel opened from Messenger is refused in place and returns to the thread");
  assert.equal(await facebook.locator("#reelless-focus-screen").count(), 0, "a refused conversation open raises no screen");
  await facebook.goto("https://www.facebook.com/reel/directfixture");
  await facebook.waitForURL("https://www.facebook.com/");

  const messenger = await context.newPage();
  observePage(messenger);
  await messenger.route("https://www.messenger.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<main id=conversation><p>Friend message</p><video id=friendVideo controls></video></main>"
  }));
  await messenger.goto("https://www.messenger.com/t/friend");
  await messenger.waitForTimeout(250);
  assert.equal(await messenger.locator("#friendVideo").getAttribute("data-reelless-direct-video"), null, "Messenger videos must remain outside ReelLess protection");
  assert.equal(await messenger.locator("#conversation").getAttribute("data-reelless-hidden"), null, "Messenger conversation layout must remain");

  const tiktok = await context.newPage();
  observePage(tiktok);
  await tiktok.route("https://www.tiktok.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<main><h1>TikTok fixture</h1></main>"
  }));
  await tiktok.goto("https://www.tiktok.com/");
  await tiktok.waitForSelector("#reelless-focus-screen");
  assert.match(await tiktok.locator("#reelless-focus-title").textContent(), /TikTok is outside your focus plan/i);

  await settings.bringToFront();
  await settings.locator("#ultimateDetails > summary").click();
  await settings.selectOption("#ultimateProfile", "keep_current");
  await settings.fill("#ultimateConfirmPhrase", "I ACCEPT THE LOCK");
  await settings.locator("#enableUltimate").click();
  await settings.waitForSelector("#ultimateRelease:not([hidden])");
  assert.equal(await settings.locator("#ultimateSetup").isHidden(), true, "Ultimate setup must be hidden while the lock is active");
  assert.equal(await settings.locator("#ultimateRelease").isVisible(), true, "Ultimate removal controls should appear only while the lock is active");
  assert.equal(await settings.locator("#protectionEnabled").isDisabled(), true, "Ultimate Lock disables normal protection controls");
  assert.equal(await settings.locator("#confirmUnlock").isDisabled(), true, "Ultimate removal begins with a disabled confirmation");
  await popup.reload();
  await popup.waitForSelector("#ultimateNotice:not([hidden])");
  assert.match(await popup.locator("#statusText").textContent(), /Ultimate Lock (is )?active/);
  assert.equal(await popup.locator("#pauseButton").isDisabled(), true, "Ultimate Lock disables popup pauses");

  await tiktok.reload();
  await tiktok.waitForSelector("#reelless-focus-screen");
  assert.equal(await tiktok.locator('[data-action="pause"]').count(), 0, "Ultimate Lock removes the focus-screen pause action");

  await settings.bringToFront();
  if (await settings.locator("#ultimateRelease").isHidden()) {
    await settings.locator("#ultimateDetails > summary").click();
  }
  await settings.locator("#unlockAction").waitFor({ state: "visible" });
  await settings.selectOption("#unlockAction", "remove_ultimate");
  await settings.fill("#unlockPhrase", "REMOVE ULTIMATE");
  const privateReason = "I need to change my protection choices today.";
  await settings.fill("#unlockReason", privateReason);
  await settings.locator("#startUnlock").click();
  assert.equal(await settings.locator("#unlockRitual").isVisible(), true, "Ultimate removal should start the focused release ritual");
  assert.equal(await settings.locator("#unlockReason").isDisabled(), true, "The private reflection should be fixed during the ritual");
  await settings.waitForSelector("#unlockCheckpoint:not([hidden])", { timeout: 20000 });
  assert.match(await settings.locator("#unlockCheckpoint").textContent(), /Checkpoint 1 of 3/);
  await settings.locator("#unlockCheckpoint").click();
  assert.match(await settings.locator("#unlockTimer").textContent(), /2 check-ins left/);
  const storedDuringUnlock = await worker.evaluate(async () => chrome.storage.local.get());
  assert.equal(JSON.stringify(storedDuringUnlock).includes(privateReason), false, "The unlock reflection must never be saved");
  await settings.evaluate(() => window.dispatchEvent(new Event("blur")));
  assert.equal(await settings.locator("#unlockRitual").isHidden(), true, "Losing focus must reset and hide the release ritual");
  assert.equal(await settings.locator("#startUnlock").isEnabled(), true, "A reset should require the release ritual to be started again");
  assert.equal(await settings.locator("#confirmUnlock").isDisabled(), true, "Losing focus must keep Ultimate Lock active");

  const runtimeState = await worker.evaluate(async () => {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    const scripts = await chrome.scripting.getRegisteredContentScripts();
    return { rules, scripts };
  });
  assert.equal(runtimeState.rules.length, 0, "no ungranted custom DNR rules should exist");
  assert.equal(runtimeState.scripts.length, 0, "no ungranted Advanced guards should exist");

  assert.deepEqual(browserErrors, [], browserErrors.join("\n"));
  console.log(`Chrome extension smoke tests passed (${extensionId}).`);
} finally {
  if (context) await context.close();
  if (profile.startsWith(os.tmpdir())) fs.rmSync(profile, { recursive: true, force: true });
}
