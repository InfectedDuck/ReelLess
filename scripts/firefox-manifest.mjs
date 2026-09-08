// Derives the Firefox manifest from the Chrome one, so the two never drift by hand-editing.
// Kept free of file I/O so the transform can be asserted directly in tests.

// Floor chosen by the newest API this extension relies on: declarativeNetRequest dynamic-rule
// limits were aligned with Chrome in Firefox 128. scripting.registerContentScripts (101) and
// declarativeNetRequest itself (113) are both older than that.
export const FIREFOX_MIN_VERSION = "128.0";

// AMO identifies an add-on by this string for the life of the listing. It must be settled before
// the first submission, because changing it later creates a separate add-on rather than an update.
export const GECKO_ID = "reelless@infectedduck.github.io";

export function toFirefoxManifest(chromeManifest) {
  const manifest = JSON.parse(JSON.stringify(chromeManifest));

  // Firefox rejects background.service_worker outright and runs an event page instead. The
  // scripts array loads in order, which is why service_worker.js guards its importScripts call.
  manifest.background = { scripts: ["shared.js", "service_worker.js"] };

  // Firefox implements the options page through options_ui; the bare options_page key is Chrome's.
  if (manifest.options_page) {
    manifest.options_ui = { page: manifest.options_page, open_in_tab: true };
    delete manifest.options_page;
  }

  // Chrome-only hint that Firefox would flag during review.
  delete manifest.minimum_chrome_version;

  manifest.browser_specific_settings = {
    gecko: { id: GECKO_ID, strict_min_version: FIREFOX_MIN_VERSION },
    // Opts the same package in to Firefox for Android, where the four core hosts already match.
    gecko_android: { strict_min_version: FIREFOX_MIN_VERSION }
  };

  return manifest;
}

// Anything the Chrome package ships that the Firefox package must ship identically.
export const SHARED_FILES = [
  "onboarding.html", "onboarding.css", "onboarding.js",
  "options.html", "options.css", "options.js",
  "popup.html", "popup.css", "popup.js",
  "privacy.html",
  "service_worker.js", "shared.js", "site_guard.js", "site_guard.css"
];
