import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import R from "../shared.js";

const root = path.resolve(import.meta.dirname, "..");
const executablePath = [process.env.REELLESS_CHROME_PATH, chromium.executablePath(),
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].filter(Boolean).find((p) => fs.existsSync(p));
assert.ok(executablePath, "Set REELLESS_CHROME_PATH to a Chrome/Chromium executable");
const browser = await chromium.launch({ executablePath, headless: true });
const errors = [];
const settings = R.normalizeSettings({ platforms: { x: { mode: "selected", sections: { home: true }, surfaces: { xExplore: true, xSidebar: true } } } });
const output = path.join(root, "dist", "x-focus-qa");
fs.mkdirSync(output, { recursive: true });
try {
  const context = await browser.newContext();
  await context.addInitScript((initial) => {
    globalThis.__settings = initial;
    const listeners = [];
    globalThis.__changeSettings = (value) => {
      globalThis.__settings = value;
      listeners.forEach((fn) => fn({ settingsV2: { newValue: value } }, "local"));
    };
    const applyPatch = (patch) => {
      const next = JSON.parse(JSON.stringify(globalThis.__settings));
      if (patch.protectionEnabled !== undefined) next.protectionEnabled = patch.protectionEnabled;
      if (patch.pausedUntil !== undefined) next.pausedUntil = patch.pausedUntil;
      if (patch.schedulePreset !== undefined) next.schedulePreset = patch.schedulePreset;
      if (patch.customStart !== undefined) next.customStart = patch.customStart;
      if (patch.customEnd !== undefined) next.customEnd = patch.customEnd;
      if (patch.appearance !== undefined) next.appearance = patch.appearance;
      if (patch.platforms) {
        for (const [id, change] of Object.entries(patch.platforms)) {
          if (!next.platforms[id]) continue;
          if (change.mode !== undefined) {
            if (change.mode === "off") {
              if (next.platforms[id].mode !== "off") next.platforms[id].lastEnabledMode = next.platforms[id].mode;
              next.platforms[id].mode = "off";
            } else {
              const wasOff = next.platforms[id].mode === "off";
              next.platforms[id].mode = change.mode;
              if (wasOff) next.platforms[id].lastEnabledMode = change.mode;
            }
          }
          if (change.sections) Object.assign(next.platforms[id].sections, change.sections);
          if (change.surfaces) Object.assign(next.platforms[id].surfaces, change.surfaces);
          if (change.entryPoints !== undefined) next.platforms[id].entryPoints = change.entryPoints;
        }
      }
      if (Array.isArray(patch.customEntries)) next.customEntries = patch.customEntries;
      return next;
    };
    globalThis.chrome = {
      storage: { local: { get: async () => ({ settingsV2: globalThis.__settings }), set: async (data) => { if (data.settingsV2) { globalThis.__settings = data.settingsV2; listeners.forEach((fn) => fn({ settingsV2: { newValue: data.settingsV2 } }, "local")); } } }, onChanged: { addListener: (fn) => listeners.push(fn) } },
      runtime: {
        sendMessage: async (message) => {
          if (!message || typeof message !== "object") return { ok: false };
          if (message.type === "getState") return { ok: true, settings: globalThis.__settings, stats: { localDay: "2026-09-23", todayCount: 0, totalCount: 0 }, meta: {}, status: "active", platforms: [] };
          if (message.type === "patchSettings") {
            const next = applyPatch(message.patch || {});
            globalThis.__settings = next;
            listeners.forEach((fn) => fn({ settingsV2: { newValue: next } }, "local"));
            return { ok: true, settings: next, saved: true, applied: true };
          }
          if (message.type === "setPlatformEnabled") {
            const next = JSON.parse(JSON.stringify(globalThis.__settings));
            if (message.enabled) {
              const restore = next.platforms[message.platform].lastEnabledMode || "selected";
              next.platforms[message.platform].mode = restore === "off" ? "selected" : restore;
            } else {
              if (next.platforms[message.platform].mode !== "off") next.platforms[message.platform].lastEnabledMode = next.platforms[message.platform].mode;
              next.platforms[message.platform].mode = "off";
            }
            globalThis.__settings = next;
            listeners.forEach((fn) => fn({ settingsV2: { newValue: next } }, "local"));
            return { ok: true, settings: next, saved: true, applied: true };
          }
          if (message.type === "setSection") {
            const next = JSON.parse(JSON.stringify(globalThis.__settings));
            next.platforms[message.platform].sections[message.section] = Boolean(message.blocked);
            globalThis.__settings = next;
            listeners.forEach((fn) => fn({ settingsV2: { newValue: next } }, "local"));
            return { ok: true, settings: next, saved: true, applied: true };
          }
          if (message.type === "openOptions") return { ok: true };
          if (message.type === "resetStats") return { ok: true, stats: { todayCount: 0, totalCount: 0 } };
          return { ok: true, settings: globalThis.__settings };
        },
        openOptionsPage() {},
        getPlatformInfo: async () => ({ os: "win" }),
        getManifest: () => ({ version: "2.3.1" })
      },
      permissions: { contains: async () => true, request: async () => true, remove: async () => true }
    };
  }, settings);
  context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  await context.route("https://x.com/**", async (route) => route.fulfill({ contentType: "text/html", body: fs.readFileSync(path.join(root, "scripts/fixtures/x.html"), "utf8") }));
  await context.route("https://fixture.test/**", async (route) => {
    const file = new URL(route.request().url()).pathname.slice(1);
    if (!["options.html", "options.js", "options.css", "shared.js"].includes(file)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ contentType: file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html", body: fs.readFileSync(path.join(root, file)) });
  });
  const page = await context.newPage();
  const mount = async (url) => {
    await page.goto(url);
    await page.addStyleTag({ path: path.join(root, "site_guard.css") });
    await page.addScriptTag({ path: path.join(root, "shared.js") });
    await page.addScriptTag({ path: path.join(root, "site_guard.js") });
    await page.waitForFunction(() => document.documentElement.dataset.reellessMode !== undefined);
  };
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await mount("https://x.com/explore");
    await page.waitForFunction(() => document.querySelector("#timeline").dataset.reellessXHidden === "xExplore");
    for (const id of ["timeline", "tabs", "news", "trends", "follow"]) assert.equal(await page.locator(`#${id}`).isVisible(), false, `${id} hidden at ${width}`);
    for (const id of ["search", "suggestions", "navigation", "chat", "mixed-region"]) assert.equal(await page.locator(`#${id}`).isVisible(), true, `${id} preserved at ${width}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, `explore-${width}.png`) });
    await page.locator("#search").fill("work");
    await page.locator("#search").press("Enter");
    await page.waitForURL("https://x.com/search?q=work");
    await page.addStyleTag({ path: path.join(root, "site_guard.css") });
    await page.addScriptTag({ path: path.join(root, "shared.js") });
    await page.addScriptTag({ path: path.join(root, "site_guard.js") });
    assert.equal(await page.locator("#timeline").isVisible(), true, "search results remain visible");
    await page.goBack();
    await page.reload();
    await page.addStyleTag({ path: path.join(root, "site_guard.css") });
    await page.addScriptTag({ path: path.join(root, "shared.js") });
    await page.addScriptTag({ path: path.join(root, "site_guard.js") });
    await page.waitForFunction(() => document.querySelector("#timeline").dataset.reellessXHidden === "xExplore");
    await mount("https://x.com/home");
    await page.waitForSelector("#reelless-focus-screen");
    const search = page.getByRole("link", { name: "Search", exact: true });
    assert.equal(await search.getAttribute("href"), "https://x.com/explore");
    await page.screenshot({ path: path.join(output, `home-${width}.png`) });
    await search.click();
    await page.waitForURL("https://x.com/explore");
  }
  const options = await context.newPage();
  await options.goto("https://fixture.test/options.html");
  const xMode = options.locator('select.mode-select[data-platform="x"]');
  await xMode.waitFor({ state: "attached" });
  await options.locator("details.advanced > summary").click();
  const xRow = options.locator("details.optional-site").filter({ has: xMode });
  await xRow.locator("summary").click();
  assert.deepEqual(await xMode.locator("option").evaluateAll((nodes) => nodes.map((node) => node.value)), ["selected", "all", "off"]);
  assert.equal(await xRow.locator('input[type="checkbox"]').count(), 8, "X offers six sections plus two surfaces");
  assert.equal(await xRow.getByText("Blocked page links", { exact: false }).count(), 1);
  for (const width of [1280, 390]) {
    await options.setViewportSize({ width, height: 900 });
    await xRow.scrollIntoViewIfNeeded();
    assert.equal(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
      JSON.stringify(await options.evaluate(() => [...document.querySelectorAll("body *")].filter((node) => node.getBoundingClientRect().right > innerWidth).slice(0, 8).map((node) => [node.tagName, node.className, node.getBoundingClientRect().right]))));
    await xRow.screenshot({ path: path.join(output, `settings-${width}.png`) });
  }
  await xRow.locator('input[data-surface="xExplore"]').uncheck();
  await options.waitForFunction(() => globalThis.__settings.platforms.x.surfaces.xExplore === false);
  await xMode.selectOption("off");
  assert.equal(await xRow.locator(".focus-choices").isVisible(), false);
  await xMode.selectOption("selected");
  assert.equal(await xRow.locator(".focus-choices").isVisible(), true);
  // Enabling the Explore page block must not collapse the row: the section checkbox has
  // to stay tickable in the same flow. Saves echo back through storage, and re-rendering
  // on the echo collapses every <details>, stranding the checkboxes out of reach.
  await options.waitForTimeout(400);
  assert.equal(await xRow.evaluate((node) => node.open), true, "X row must stay open across its own mode save");
  const xExploreSection = xRow.locator('input[data-section="explore"]');
  assert.equal(await xExploreSection.isVisible(), true, "Explore section checkbox must stay reachable");
  await xExploreSection.check();
  await options.waitForFunction(() => globalThis.__settings.platforms.x.sections.explore === true);
  await options.waitForTimeout(400);
  assert.equal(await xRow.evaluate((node) => node.open), true, "X row must stay open across its own section save");
  assert.equal(await xExploreSection.isChecked(), true, "ticked Explore block must survive the save");
  // The persisted choice must actually stop the Explore page.
  const persisted = JSON.parse(await options.evaluate(() => JSON.stringify(globalThis.__settings)));
  assert.equal(persisted.platforms.x.sections.explore, true);
  await context.addInitScript((seed) => { globalThis.__settings = seed; }, persisted);
  const explorePage = await context.newPage();
  await explorePage.goto("https://x.com/explore");
  await explorePage.addStyleTag({ path: path.join(root, "site_guard.css") });
  await explorePage.addScriptTag({ path: path.join(root, "shared.js") });
  await explorePage.addScriptTag({ path: path.join(root, "site_guard.js") });
  await explorePage.waitForSelector("#reelless-focus-screen");
  await explorePage.close();

  const redditMode = options.locator('select.mode-select[data-platform="reddit"]');
  const redditRow = options.locator("details.optional-site").filter({ has: redditMode });
  await redditRow.locator("summary").click();
  assert.deepEqual(await redditMode.locator("option").evaluateAll((nodes) => nodes.map((node) => node.value)), ["selected", "all", "off"]);
  await redditMode.selectOption("selected");
  assert.equal(await redditRow.locator('input[type="checkbox"]').count(), 6);
  assert.equal(await redditRow.locator("label").filter({ hasText: "Block Home feed" }).count(), 1);
  assert.equal(await redditRow.locator("label").filter({ hasText: "Block Popular, News, and Explore" }).count(), 1);
  assert.equal(await redditRow.locator("label").filter({ hasText: "Block Chat" }).count(), 1);
  assert.equal(await redditRow.locator("label").filter({ hasText: "Block Message inbox" }).count(), 1);
  assert.equal(await redditRow.locator("label").filter({ hasText: "Block Notifications" }).count(), 1);
  assert.equal(await redditRow.locator("label").filter({ hasText: "Hide sidebar distractions" }).count(), 1);
  assert.equal(await redditRow.getByText("Short video communities", { exact: true }).count(), 0);
  for (const width of [1280, 390]) {
    await options.setViewportSize({ width, height: 900 });
    await redditRow.scrollIntoViewIfNeeded();
    assert.equal(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await redditRow.screenshot({ path: path.join(output, `reddit-settings-${width}.png`) });
  }
  const optionalAudits = [
    { id: "snapchat", options: ["shortform", "selected", "all", "off"], labels: ["Block Spotlight", "Block Stories"], removed: [] },
    { id: "twitch", options: ["shortform", "selected", "all", "off"], labels: ["Block recommended Home", "Block Browse", "Block Clips", "Block Videos (VODs)", "Block Drops"], removed: ["Videos"] },
    { id: "pinterest", options: ["selected", "all", "off"], labels: ["Block Home feed", "Block Explore", "Block Search"], removed: ["Watch", "Pins"] },
    { id: "linkedin", options: ["selected", "all", "off"], labels: ["Block Feed", "Block Videos", "Block Notifications", "Block Messaging", "Block My Network"], removed: ["Video", "Jobs"] },
    { id: "threads", options: ["selected", "all", "off"], labels: ["Block Home feed", "Block Activity"], removed: ["Search", "Media"] }
  ];
  for (const audit of optionalAudits) {
    const mode = options.locator(`select.mode-select[data-platform="${audit.id}"]`);
    const row = options.locator("details.optional-site").filter({ has: mode });
    await row.locator("summary").click();
    assert.deepEqual(await mode.locator("option").evaluateAll((nodes) => nodes.map((node) => node.value)), audit.options, `${audit.id} modes`);
    await mode.selectOption("selected");
    assert.equal(await row.locator('input[type="checkbox"]').count(), audit.labels.length, `${audit.id} choice count`);
    for (const label of audit.labels) assert.equal(await row.locator("label").filter({ hasText: label }).count(), 1, `${audit.id}: ${label}`);
    for (const label of audit.removed) assert.equal(await row.getByText(label, { exact: true }).count(), 0, `${audit.id}: ${label} was retired`);
    await options.setViewportSize({ width: 390, height: 900 });
    await row.scrollIntoViewIfNeeded();
    assert.equal(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${audit.id} must not overflow`);
    await row.screenshot({ path: path.join(output, `${audit.id}-settings-390.png`) });
  }
  assert.deepEqual(errors, []);
  console.log(`Optional-site settings layouts and X navigation browser checks passed. Screenshots: ${output}`);
} finally {
  await browser.close();
}
