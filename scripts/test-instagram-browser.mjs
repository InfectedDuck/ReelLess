import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import R from "../shared.js";

const root = path.resolve(import.meta.dirname, "..");
const executablePath = [process.env.REELLESS_CHROME_PATH, chromium.executablePath(),
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].filter(Boolean).find(fs.existsSync);
assert.ok(executablePath, "Set REELLESS_CHROME_PATH to a Chrome/Chromium executable");
const browser = await chromium.launch({ executablePath, headless: true });
try {
  for (const fallback of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    const errors = [];
    let documentRequests = 0;
    page.on("request", (request) => { if (request.isNavigationRequest()) documentRequests += 1; });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://www.instagram.com/**", (route) => route.fulfill({
      contentType: "text/html",
      body: `<style>article { display: flex; flex-direction: column } .media { height: 420px; display: block } nav { height: 40px } #sentinel { height: 10px }</style>
        <nav><a id="nav-reels" href="/reels/">Reels</a><a href="/">Home</a></nav>
        <main><article id="photo"><a class="media" href="/p/photo/">Photo</a></article>
        ${Array.from({ length: 12 }, (_, i) => `<article id="reel-${i}"><a href="/author/">Author</a><a class="media" href="/reel/${i}/">Reel</a></article>`).join("")}
        ${Array.from({ length: 8 }, (_, i) => `<article id="tail-${i}"><a class="media" href="/p/tail-${i}/">Photo</a></article>`).join("")}
        <div id="sentinel">Load more</div></main>`
    }));
    await page.goto("https://www.instagram.com/");
    await page.evaluate(({ settings, fallback }) => {
      if (fallback) globalThis.CSS.supports = () => false;
      const listeners = [];
      globalThis.changeSettings = (next) => listeners.forEach((fn) => fn({ settingsV2: { newValue: next } }, "local"));
      globalThis.chrome = {
        storage: { local: { get: async () => ({ settingsV2: settings }) }, onChanged: { addListener: (fn) => listeners.push(fn) } },
        runtime: { sendMessage: async () => ({ ok: true }) }
      };
    }, { settings: R.getDefaultSettings(), fallback });
    const geometry = () => page.evaluate(() => ({
      height: document.querySelector("#reel-0").getBoundingClientRect().height,
      sentinel: document.querySelector("#sentinel").getBoundingClientRect().top + scrollY,
      display: getComputedStyle(document.querySelector("#reel-0")).display
    }));
    const before = await geometry();
    await page.addStyleTag({ path: path.join(root, "site_guard.css") });
    await page.addScriptTag({ path: path.join(root, "shared.js") });
    await page.addScriptTag({ path: path.join(root, "site_guard.js") });
    await page.waitForFunction(() => document.documentElement.dataset.reellessMode === "hide");
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#reel-0"), "::after").content.includes("Reel hidden"));
    const compact = await geometry();
    assert.equal(compact.height, 56, "a hidden Reel must become a short placeholder");
    assert.equal(compact.sentinel < before.sentinel, true, "compact placeholders must remove most of the empty feed space");
    assert.equal(await page.locator("#photo").isVisible(), true);
    assert.equal(await page.locator("#nav-reels").isVisible(), false);
    await page.evaluate(() => {
      scrollTo(0, 1500);
      document.querySelector('#reel-0 .media').setAttribute("href", "/p/recycled/");
    });
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#reel-0"), "::after").content === "none");
    assert.equal((await geometry()).height, before.height, "a recycled photo must restore its normal card height");
    const keep = R.getDefaultSettings();
    keep.platforms.instagram.entryPoints = "keep";
    await page.evaluate((settings) => changeSettings(settings), keep);
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#reel-1")).visibility === "visible");
    assert.equal(await page.locator("#nav-reels").isVisible(), true);
    // A real click used to call location.assign(Home), reloading this same URL.
    // Checking the address alone misses that regression: track document requests too.
    await page.locator("#reel-4 .media").scrollIntoViewIfNeeded();
    const scrollBeforeClick = await page.evaluate(() => scrollY);
    const requestsBeforeClick = documentRequests;
    await page.evaluate(() => {
      globalThis.reelOpened = false;
      document.querySelector("#reel-4 .media").addEventListener("click", () => { globalThis.reelOpened = true; });
    });
    for (const activation of ["mouse", "keyboard"]) {
      if (activation === "mouse") await page.locator("#reel-4 .media").click();
      else await page.locator("#reel-4 .media").press("Enter");
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(documentRequests, requestsBeforeClick, `${activation}: blocked Reel must not reload the document`);
      assert.equal(page.url(), "https://www.instagram.com/");
      assert.equal(await page.evaluate(() => scrollY), scrollBeforeClick, `${activation}: scroll stays unchanged`);
      assert.equal(await page.evaluate(() => globalThis.reelOpened), false, "the site's viewer handler must not run");
      assert.equal(await page.locator("#reelless-focus-screen").count(), 0, "a blocked Reel click should simply stay in the feed");
    }
    await page.evaluate((settings) => changeSettings(settings), R.getDefaultSettings());
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#reel-1"), "::after").content.includes("Reel hidden"));
    await page.evaluate(() => { history.pushState({}, "", "/direct/inbox/"); dispatchEvent(new PopStateEvent("popstate")); });
    await page.waitForFunction(() => document.documentElement.dataset.reellessMode === "off");
    assert.equal(await page.locator("#reel-1").isVisible(), true);
    assert.equal(await page.locator("#nav-reels").isVisible(), true);
    await page.evaluate(() => { history.pushState({}, "", "/author/"); dispatchEvent(new PopStateEvent("popstate")); });
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#reel-1")).display === "none");
    assert.equal(await page.locator("#photo").isVisible(), true);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("Instagram browser checks passed (CSS and fallback): compact Reel placeholders, recycling, click/keyboard blocking without reload, settings, Direct, profile.");
} finally {
  await browser.close();
}
