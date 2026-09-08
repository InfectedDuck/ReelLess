# ReelLess v2.3.0 Security Review

Review date: September 8, 2026

## Result

No known high-severity or release-blocking security issue remains after the checks below. This is a focused source and packaging review of the 2.3.0 code, not a formal third-party penetration test.

## Checks completed

### Dependencies and packaging

- `npm audit --audit-level=high`, run on September 8, 2026: found 0 vulnerabilities. The only dependencies are the development tools `jsdom` and `playwright-core`; neither ships in a package.
- Manifest V3 is used and all executable code is bundled locally. `npm run validate` rejects any `<script>` or `<link>` in `popup.html`, `options.html`, `onboarding.html`, or `privacy.html` that points at an `http(s)://` resource.
- No environment files, private keys, credentials, API keys, or client secrets are tracked in the repository.
- `scripts/build-package.ps1` builds `dist/reels-blocker.zip` from an explicit allowlist (`manifest.json`, the popup, options, onboarding, and privacy pages, `service_worker.js`, `shared.js`, `site_guard.js`, `site_guard.css`, and `icons/`), then reopens the archive to confirm `manifest.json` is at the ZIP root, there is no wrapping directory, and nothing from `node_modules`, `scripts`, `store-assets`, or `docs` leaked in.
- `scripts/build-firefox.mjs` stages exactly the same runtime files plus a generated manifest in `dist/firefox/` and writes `dist/reelless-firefox.zip`, with the same root-level manifest check.

### Runtime code

- `shared.js`, `service_worker.js`, `site_guard.js`, `popup.js`, `options.js`, and `onboarding.js` contain no `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `eval`, or `new Function` call. `npm run validate` greps every one of these files for those patterns and runs `node --check` on each.
- Messages from the guard to the service worker carry only a type and a random event id (`recordBlockAttempt`, `markActiveDay`). No URL, title, or page content is sent anywhere, including to the extension's own background.
- `service_worker.js` rejects any message whose sender id is not `chrome.runtime.id`, rejects non-object messages, answers unknown types with `{ ok: false }`, accepts only the pause durations `5`, `15`, `30`, and `tomorrow`, truncates event ids to 100 characters, and drops a repeated id for five seconds.
- `site_guard.js` reads `location.href`, anchor `href` attributes, and element geometry. It never calls `history.back()`: a site's own address rewrite is undone with `history.replaceState` followed by a synthetic `popstate` event, and a blocked page is left with `location.replace` or `location.assign` to a same-site destination. Its Navigation API listener cancels only same-origin, same-document navigations that were not user-driven. The focus screen is a fixed template with no page or user data interpolated; its title and body are assigned with `textContent`.
- Custom-domain entries are rendered with `textContent` (`renderCustom` in `options.js`); `scripts/test-docs.mjs` fails if `item.innerHTML =` reappears in the runtime sources.
- The Ultimate Lock reflection (`#unlockReason`) is read only to check its length. It is never part of the settings object that `chrome.storage.local.set` writes, so it exists in page memory only and is discarded when Settings closes or reloads.

### Permissions and site access

- Required API permissions are exactly `storage`, `alarms`, `scripting`, and `declarativeNetRequestWithHostAccess`. `npm run validate` fails on any other permission, on install-time `host_permissions`, on a `declarative_net_request` static ruleset, or on `externally_connectable`.
- The bundled content script runs only on twelve HTTPS match patterns: the `www`, `m`, and bare hosts of youtube.com, instagram.com, facebook.com, and tiktok.com. It loads `shared.js` then `site_guard.js`, with `site_guard.css`, at `document_start`.
- The seven Advanced sites request their configured HTTPS origins with `chrome.permissions.request` only from a user action in Settings. The service worker registers a `reelless-advanced-<site>` guard only while the site is enabled and its origins are granted, unregisters guards that no longer qualify, and Settings removes the origins when a site is turned off.
- Arbitrary custom domains use the required `https://*/*` optional declaration, but ReelLess requests and retains only `https://<host>/*` for the host the user typed. `validateEntry` rejects whitespace, wildcards, queries, and fragments, and the list is capped at 50 entries.
- Custom-domain rules are block-only `declarativeNetRequest` dynamic rules for `main_frame` and `sub_frame` requests, anchored to `^https://` with the host and path regex-escaped, and are built only for entries whose origin is currently granted. Every dynamic rule is cleared and re-created on each sync, so stale rules from older builds cannot persist.
- Local storage holds three keys: `settingsV2` (schema v7), `statsV1` as `{localDay, todayCount, totalCount}`, and `metaV1` as `{installedAt, activeDayCount, lastActiveDay, reviewDismissed, reviewShown}`. The legacy `settings` key is read only to migrate it.

### Firefox build

- `scripts/firefox-manifest.mjs` derives the Firefox manifest from `manifest.json`, so permissions, optional host permissions, and content-script matches cannot drift between the two packages; `scripts/test-firefox.mjs` asserts that they are identical.
- The transform replaces `background.service_worker` with an event page that loads `shared.js` then `service_worker.js`, moves `options_page` to `options_ui`, drops `minimum_chrome_version`, shortens the name to AMO's 45-character limit, and sets `browser_specific_settings.gecko` to id `reelless@infectedduck.github.io` with `strict_min_version` `140.0` and `data_collection_permissions` `{ required: ["none"] }`, plus a `gecko_android` opt-in at `142.0`. The declaration is truthful: nothing is collected or transmitted, so Firefox shows no consent prompt.
- `shared.js` aliases `chrome` to the promise-based `browser` namespace only when `browser.runtime.id` exists, so a page-defined `browser` global cannot hijack the alias. `service_worker.js` guards its `importScripts` call, which does not exist on an event page.
- On Firefox for Android, Settings hides the optional-sites and custom-pages controls, keyed on `runtime.getPlatformInfo` rather than the user-agent string, because Android offers no way to grant that access.

## Security boundaries

- ReelLess inspects supported-site URLs and selected local page elements because that is required to identify short-form entry points. On YouTube, hiding is done by `site_guard.css` where `:has()` is supported, so the script does not watch the DOM there.
- ReelLess makes no extension-originated external network requests and includes no analytics, advertising, accounts, or remote code.
- The synthetic `popstate` dispatched after restoring an address is the only event ReelLess emits into a page, and it carries the page's own existing history state.
- Chrome and Firefox always retain control: a user or device administrator can disable, uninstall, or clear the extension, including Ultimate Lock.
- Social-platform markup changes can affect blocking reliability. Complete the live manual test matrix in `MANUAL_TESTING.md` before every public release.

## Maintainer actions

- Enable two-factor authentication on the Google publisher, Mozilla add-on developer, and GitHub accounts.
- Protect recovery codes and limit publisher roles to trusted people.
- Re-run `npm test`, `npm audit --audit-level=high`, `npm run validate`, `npm run smoke`, `npm run build`, and `npm run build:firefox` before every upload.
- Use GitHub private security advisories for vulnerability reports.
