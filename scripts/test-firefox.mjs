import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { toFirefoxManifest, GECKO_ID, FIREFOX_MIN_VERSION, SHARED_FILES } from "./firefox-manifest.mjs";

const chromeManifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const sharedSource = fs.readFileSync(new URL("../shared.js", import.meta.url), "utf8");
const workerSource = fs.readFileSync(new URL("../service_worker.js", import.meta.url), "utf8");
const firefox = toFirefoxManifest(chromeManifest);

// --- The namespace alias is the whole port. Without it every await in the extension resolves
// undefined on Firefox, silently, and the guard runs on default settings forever. ---

// Firefox: both namespaces exist, chrome.* is callback-only, browser.* returns promises.
const geckoBrowser = { runtime: { id: "reelless@test" }, storage: { local: {} } };
const geckoCallbackChrome = { runtime: { id: "reelless@test" }, storage: { local: {} } };
const gecko = vm.createContext({ browser: geckoBrowser, chrome: geckoCallbackChrome });
vm.runInContext(sharedSource, gecko);
assert.equal(gecko.chrome, geckoBrowser, "on Firefox, chrome must be aliased to the promise-based browser namespace");
assert.equal(typeof gecko.ReelLess.shouldBlockUrl, "function", "the shared module must still export its API");

// Chrome: there is no browser global, so nothing is reassigned.
const blinkChrome = { runtime: { id: "reelless@test" }, storage: { local: {} } };
const blink = vm.createContext({ chrome: blinkChrome });
vm.runInContext(sharedSource, blink);
assert.equal(blink.chrome, blinkChrome, "on Chrome the namespace must be left exactly as the browser provided it");

// A page with a browser global that is not an extension namespace must not hijack chrome.
const impostor = vm.createContext({ browser: { name: "not an extension api" }, chrome: blinkChrome });
vm.runInContext(sharedSource, impostor);
assert.equal(impostor.chrome, blinkChrome, "a non-extension browser global must be ignored");

// The alias has to run before anything reads chrome, so it belongs above the first use.
assert.ok(
  sharedSource.indexOf("root.chrome = browser") < sharedSource.indexOf("const SETTINGS_KEY"),
  "the namespace alias must run before any other statement in shared.js"
);

// --- Background entry point ---
assert.match(workerSource, /if \(typeof importScripts === "function"\) importScripts\("shared\.js"\)/,
  "the worker must guard importScripts, which does not exist on a Firefox event page");

// --- Manifest transform ---
assert.deepEqual(firefox.background, { scripts: ["shared.js", "service_worker.js"] },
  "Firefox rejects background.service_worker and needs an event page");
assert.equal(firefox.background.service_worker, undefined);
assert.deepEqual(firefox.options_ui, { page: "options.html", open_in_tab: true },
  "Firefox exposes the options page through options_ui");
assert.equal(firefox.options_page, undefined, "the Chrome-only options_page key must not ship to AMO");
assert.equal(firefox.minimum_chrome_version, undefined, "the Chrome version hint must not ship to AMO");
assert.equal(firefox.browser_specific_settings.gecko.id, GECKO_ID);
assert.equal(firefox.browser_specific_settings.gecko.strict_min_version, FIREFOX_MIN_VERSION);
assert.ok(firefox.browser_specific_settings.gecko_android, "the package must opt in to Firefox for Android");

// Everything that defines the product must survive the transform untouched.
assert.equal(firefox.name, chromeManifest.name);
assert.equal(firefox.version, chromeManifest.version);
assert.equal(firefox.description, chromeManifest.description);
assert.deepEqual(firefox.permissions, chromeManifest.permissions);
assert.deepEqual(firefox.optional_host_permissions, chromeManifest.optional_host_permissions);
assert.deepEqual(firefox.content_scripts, chromeManifest.content_scripts);
assert.equal(firefox.manifest_version, 3);

// The mobile hostnames the Android build depends on are already in the bundled match list.
const coreMatches = chromeManifest.content_scripts[0].matches;
for (const host of ["https://m.youtube.com/*", "https://m.instagram.com/*", "https://m.facebook.com/*", "https://m.tiktok.com/*"]) {
  assert.ok(coreMatches.includes(host), `${host} must stay bundled for Firefox for Android`);
}

// The transform must not mutate its input, or a build that packages both targets would corrupt one.
assert.ok(chromeManifest.background.service_worker, "the Chrome manifest must be left intact");
assert.equal(chromeManifest.browser_specific_settings, undefined);

// Every file the Chrome package ships must exist for the Firefox package too.
for (const file of SHARED_FILES) {
  assert.ok(fs.existsSync(new URL(`../${file}`, import.meta.url)), `missing packaged file: ${file}`);
}

// --- Firefox for Android: the flows that cannot work there must be gated off, and only there. ---
const optionsHtml = fs.readFileSync(new URL("../options.html", import.meta.url), "utf8");
const optionsJs = fs.readFileSync(new URL("../options.js", import.meta.url), "utf8");
for (const id of ["moreSitesSection", "customSection", "mobileNotice"]) {
  assert.ok(optionsHtml.includes(`id="${id}"`), `options.html needs #${id} for the Android gate`);
  assert.ok(optionsJs.includes(id), `options.js must address #${id}`);
}
assert.match(optionsJs, /getPlatformInfo/, "the gate must key off the platform, not the user agent string");
assert.match(optionsJs, /platform\.os !== "android"/, "only Android should be gated");
assert.match(optionsHtml, /id="mobileNotice"[^>]*hidden/, "the Android notice must start hidden so desktop never shows it");

console.log("Firefox namespace alias, background entry point, manifest transform, and Android gate tests passed.");
