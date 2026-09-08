// Derives the Firefox manifest from the Chrome one, so the two never drift by hand-editing.
// Kept free of file I/O so the transform can be asserted directly in tests.

// Floor chosen by the newest manifest key this package uses: data_collection_permissions is read
// from Firefox 140 (desktop) and 142 (Android), and AMO's validator warns when the minimum is
// older. Every API the code relies on is older still: declarativeNetRequest dynamic-rule limits
// were aligned with Chrome in 128, scripting.registerContentScripts arrived in 101.
export const FIREFOX_MIN_VERSION = "140.0";
export const FIREFOX_ANDROID_MIN_VERSION = "142.0";

// AMO caps the manifest name at 45 characters, well under the Chrome Web Store's 75, so the
// search-led Chrome name cannot ship to Firefox as it is. The brand stays first.
export const FIREFOX_NAME = "ReelLess: Block Shorts, Reels and TikTok";
export const FIREFOX_NAME_LIMIT = 45;

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

  manifest.name = FIREFOX_NAME;

  manifest.browser_specific_settings = {
    gecko: {
      id: GECKO_ID,
      strict_min_version: FIREFOX_MIN_VERSION,
      // Required of every new AMO submission since 2025-11-03. "none" is the truthful answer:
      // nothing leaves the browser, and the consent prompt is skipped entirely.
      data_collection_permissions: { required: ["none"] }
    },
    // Opts the same package in to Firefox for Android, where the four core hosts already match.
    gecko_android: { strict_min_version: FIREFOX_ANDROID_MIN_VERSION }
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
