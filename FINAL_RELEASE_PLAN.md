# ReelLess final release review and plan

Reviewed September 24, 2026, against the current working tree, including the existing uncommitted changes.

**Verdict: feature-rich, but not ready to upload yet.** The remaining work is mostly correctness, browser compatibility, truthful product copy, and release verification. Adding more platforms now would increase maintenance before the current promise is dependable.

## 1. What the review established

The project already has onboarding, a popup, detailed settings, schedules, temporary pauses, optional platform permissions, custom boundaries, local counters, an opt-in lock, privacy/support pages, packaging, and substantial automated coverage. These do not need to be rebuilt.

| Check | Result |
| --- | --- |
| `npm.cmd test` | Passed all seven suites. Firefox coverage here tests transforms and mocks, not an installed Firefox add-on. |
| `npm.cmd run validate` | Passed. This checks syntax, manifest constraints, assets, and selected source patterns. |
| `npm.cmd run test:instagram-browser` | Passed the offline Chromium CSS/fallback, scrolling, recycling, navigation, and conversation fixtures. |
| `npm.cmd run smoke` | Failed at `scripts/smoke-extension.mjs:139`: it waits for the removed `#detailedCorePlatforms` UI. Later checks did not run. |
| `npm.cmd run test:x-browser` | Failed at line 84: expects six checkboxes; the current UI has eight. Later checks did not run. |
| `npm.cmd audit --audit-level=high` | Passed with zero reported vulnerabilities after retrying with network access. This is a dependency audit, not a security certification. |
| Existing release ZIPs | Both contain outdated runtime files. Six files differ in the Chrome/Edge ZIP and eight in the Firefox ZIP. Do not upload these artifacts. |
| Live authenticated sites, actual Edge/Firefox installs, store dashboards | Not verified in this review. Public privacy/source URLs could not be verified through the browsing tool; their availability remains a release gate. |

Additional focused reproductions confirmed:

- **Blocked media still plays:** in a real Chromium extension fixture on a YouTube `/shorts/` page, a video kept playing and its time advanced while the focus screen was visible. The overlay alone does not stop playback.
- **Broken settings action:** clicking the focus screen's Open settings button produced `chrome.runtime.openOptionsPage is not a function` (`site_guard.js:440`).
- **Incorrect status:** turning off the master protection switch made the popup say “Outside your schedule,” rather than “Protection is off” (`popup.js:24`).
- **Lost preferences:** a popup fixture changed YouTube from Block all to Off to On and restored Short-form only. A stale popup also overwrote an unrelated Instagram change made elsewhere (`popup.js:42–53`).
- **Custom matching disagrees with permissions:** `www.example.com/Private` becomes `example.com/private`. The in-page matcher accepts the www URL, but the permission, registration, and network rule target the bare host. The path is silently lowercased too (`shared.js:369, 603–682`).

Source inspection also found that custom guards are registered only on the blocked path. They therefore cannot catch a single-page app entering that path from an initially allowed page without a document request. Network-blocked direct visits cannot display an in-page focus screen, despite the current promise. Review links always point to Chrome, and focus dialogs lack initial focus management and containment.

## 2. Required fixes before submission

### A. Make blocking and recovery dependable

- Add media suppression for genuinely blocked full pages: pause existing audio/video, catch newly inserted media and resumed playback, and keep them stopped while the page remains blocked. Cover YouTube, TikTok, and Block all/selected-page modes. Preserve allowed watch pages and conversations; a refused link on an otherwise allowed page must not stop unrelated media.
- Replace the content script's direct settings API call with an internal `openOptions` message handled in the background. Keep sender validation and report failures visibly. Chrome explicitly limits content-script API access and recommends messaging for other APIs: [content-script capabilities](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).
- Make the focus screen keyboard accessible: move focus into it, contain Tab navigation, prevent interaction with the covered page, and restore previous focus when dismissed. Escape may dismiss only the existing “Stay here” case on an allowed page; it must not bypass a blocked page.
- Preserve existing Instagram/Facebook scrolling and conversation behavior with regressions. Do not replace the site guards wholesale during release hardening.

### B. Preserve settings and report actual state

- Route popup and Settings mutations through one serialized background settings writer. Read the latest state and apply only the requested fields; stop saving stale complete snapshots from UI pages. Reject protected-setting changes while Ultimate Lock is active, including messages from a previously opened popup.
- Remember the last enabled mode when a site is switched off. Switching it back on restores that mode, its section choices, and its appearance choices. Use the site's existing default only when no previous enabled mode exists.
- Distinguish protection off, paused, outside schedule, no effective selections, missing access, active protection, and application errors. Show Ultimate Lock as a separate state indicator, not proof that any particular site is protected.
- Refresh an open popup when settings, counters, permissions, or time boundaries change. Show a recoverable error if storage or background rule application fails; do not report successful protection after swallowing an error.
- After granting optional access, explain that already-open site tabs need refreshing. Provide the same instruction after installation/update, avoiding unsolicited reloads of people's pages.

### C. Repair custom boundaries

- Use one normalized representation for validation, permissions, content-script registration, URL matching, and network rules. Lowercase the hostname only; preserve path case. Treat `www.example.com` and `example.com` as distinct, explicitly displayed hosts. Do not silently request sibling hosts or subdomains.
- Accept a hostname/path or an HTTPS URL. Reject explicit HTTP URLs, credentials, ports, queries, fragments, and wildcards with clear messages. Keep the 50-entry limit, but check it before requesting access; show duplicate and capacity errors instead of silently dropping entries.
- Keep existing saved entries as their stored host/path when migrating; their original discarded spelling cannot be recovered. Explain exact-host matching in the UI so users can add a separate www entry if needed.
- Register one guard across each granted custom host, using the granted host-wide permission, so allowed pages can hide/refuse blocked links and detect SPA navigation. Update existing registrations when definitions change and remove obsolete registrations.
- Retain network blocking for direct document requests. State the actual behavior: direct requests can show the browser's blocked-page error; guarded in-page navigation uses ReelLess's focus screen. Do not promise a custom screen or a counted attempt for every network-blocked visit.
- Apply only currently granted boundaries, including in already-running guards. Revoking access must remove the matching rules and stop that boundary's in-page enforcement. Removing one entry must retain access if another entry still uses that exact host.

### D. Finish the three-browser product

- Keep a shared runtime and generated Firefox manifest. Add a shared distribution configuration mapping actual listing IDs to Chrome, Edge, and Firefox review URLs. Until a listing URL is known, hide its review action and keep support available; never construct a Chrome review URL from a Firefox ID.
- Replace general “Chrome” wording with “browser.” Provide browser-specific pinning, permissions, installation, and troubleshooting instructions. Keep review requests neutral, permanently dismissible, and delayed until seven active days.
- Exclude Firefox for Android from this release by omitting the `gecko_android` opt-in from the generated manifest and testing its absence, following [Mozilla's manifest documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings). Keep the Android support code dormant for a later separately tested release. Safari and Opera are also deferred.
- Preserve the current required permission set. Arbitrary custom domains justify the broad optional declaration, while actual grants remain exact HTTPS hosts. Maintain Firefox's truthful no-data-transmission declaration. Check submission disclosures against [Chrome's policies](https://developer.chrome.com/docs/webstore/program-policies/policies), [Mozilla's policies](https://extensionworkshop.com/documentation/publish/add-on-policies/), and [Firefox data-consent documentation](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

### Internal interfaces and migration

Use the existing message router, adding `openOptions`, `patchSettings`, `setPlatformEnabled`, `enableUltimate`, `releaseUltimate`, and `resetStats`. Restrict settings/lock/reset operations to the extension's own UI pages; content scripts retain only their required state, pause, counting, and settings-opening operations. Responses distinguish a saved preference from successfully applied protection and include actionable errors.

Extend `getState` with local permission/application status for diagnostics. Add a normalized `lastEnabledMode` per platform and migrate settings schema 10 to 11, including lock snapshots. Preserve schedules, custom entries, section/surface choices, counters, and review dismissal. Keep the existing storage keys and introduce no account, server, telemetry, or browsing-history storage.

## 3. Sections to add, simplify, or defer

**Add before launch:**

- **Help and diagnostics:** extension version, browser, effective protection state, per-site access status, refresh instructions, known limitations, and a persistent Report a problem link. A user-initiated Copy diagnostics action copies only these non-browsing details, excluding URLs, custom entries, page content, and lock reflections. It never submits a report automatically.
- **Coverage and limitations:** a compact website/support table showing the four default sites, seven optional sites, preserved utility pages, desktop browser support, and custom-domain behavior. State that this affects supported browser pages, not native social apps or every possible embedded player.
- **Local data controls:** explain stored settings/counters and how browser uninstall/clear-data works. Add Reset counters with confirmation; leave settings, lock, and review-prompt state untouched. Label the cumulative number “Total blocked attempts” so it remains accurate after reset.
- **Public installation:** replace the website's main developer-mode instructions with actual store buttons as listings become available. Keep local development installation under contributor documentation.

**Simplify before launch:**

- Move Ultimate Lock into a collapsed Advanced subsection. Preserve its current phrase, private reflection, timed check-ins, and focus-reset behavior, as requested. Keep its active status and removal route easy to find; retain the explanation that the browser can still disable/uninstall the extension.
- Keep Facebook's current default protection, but label it **Reels and videos** wherever the mode is presented. Explicitly explain that ordinary feed videos and Live are included; keep their opt-out discoverable.
- Keep the popup to status, four switches, pause/resume, counters, Settings, and Help. Leave the seven extra sites under Advanced.
- Explain the difference between blocking the YouTube Home page and hiding Home recommendations. Collapse optional visual controls under “Hide page elements” within the YouTube card to reduce initial clutter.
- Remove orphaned detailed-core UI branches and stale test assumptions after their behavior is covered in the current cards. Move any unique assertions from the temporary Reddit verification script into the maintained suite, then remove that scratch script. Do not remove migration or browser fallback code without evidence it is unused.
- Consolidate repeated submission instructions into one authoritative checklist; keep separate privacy, security, manual-testing, and marketing documents for their distinct purposes. Generate versions/package names from the manifest instead of hardcoding `2.3.0` across scripts.

**Retention roadmap after the reliability release, in priority order:**

1. Local settings export/import for moving between browsers, with preview, validation, fresh permission requests, and no silent unlocking.
2. Weekday-specific schedules, retaining the existing simple Always on default.
3. Small opt-in Work/Study presets that preview their changes before applying them.
4. Localization based on actual support demand, after live-layout testing in each supported language.

The strongest reason to keep this extension installed is trustworthy, quiet protection that preserves useful pages. Keep the local progress counters, but do not claim estimated “hours saved.” Defer accounts, cloud sync, AI coaching, more platforms, leaderboards, streak pressure, notifications, and a large analytics dashboard. None is necessary for this launch.

## 4. Verification and release sequence

1. **Fix the defects and tests together.** Repair smoke selectors and outdated X counts using the intended current controls, not by deleting assertions. Add regression coverage for playing/resumed media, settings opening, keyboard containment, stale UI writes, remembered modes, real status, permission denial/revocation, and failed saves.
2. **Cover custom-boundary cases.** Test bare/www/subdomains independently, case-sensitive paths, path segment boundaries, two entries sharing one host, the 50-entry limit, removal, direct network blocks, SPA transitions from allowed pages, and upgrades with previously registered guards. Verify denial never reports successful activation.
3. **Add release automation.** CI must run the existing unit, smoke, Instagram, and X suites; build both packages; run a pinned AMO linter; and record actual Firefox extension integration results. Firefox manifest/mock tests alone are insufficient. Test Edge as an installed extension too; Microsoft explicitly requires sideload testing when porting: [Edge porting guidance](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/port-chrome-extension).
4. **Run the live release matrix.** In current desktop Chrome, Edge, and Firefox, test all four core sites signed in/out and every optional control advertised. Include ordinary media/messages/search, direct and in-app links, history, keyboard activation, long scrolling, multiple tabs, pause expiry, overnight schedules, browser restart/update, denied/revoked access, both lock profiles, and successful lock removal. Test light/dark themes and 200% zoom. Record browser version, date, result, and sanitized evidence. Exercise the declared minimum browser versions with offline fixtures as well.
5. **Check performance.** Compare extension enabled/disabled on long Instagram/Facebook feeds and with ten supported tabs over ten minutes. Investigate repeatable scroll stalls, extension-caused long tasks, growing observers/DOM nodes, or unnecessary hidden-tab work. Retain polling only where it closes a tested navigation or schedule gap; do not remove fallbacks solely to shorten the code.
6. **Refresh release materials.** Regenerate screenshots from the final build, replacing the acknowledged old Instagram/Facebook composite. Fail release asset generation when required live captures are unavailable instead of silently retaining old images. Align listing, privacy, security review, manual matrix, schema references, permission counts, and behavior claims. Verify public privacy/support URLs in a signed-out browser and enable private vulnerability reporting.
7. **Build a fresh candidate.** Target release `2.3.1` across all three stores. Build from a reviewed commit containing the intended current changes. Record the commit and SHA-256 of each ZIP; verify runtime contents match that commit. Keep Chrome/Edge on the shared package and generate the Firefox package from it. Include both artifacts and clearly labeled per-store instructions in the submission kit. Do not upload the existing `dist` ZIPs.
8. **Pilot, then publish.** Use 10–20 testers across the three browsers for at least seven days after the fixes. Require no unresolved core blocking, useful-page breakage, settings-loss, permission, or lock-recovery defects. Submit the same version to the three stores, release only approved/tested packages, and publish each real store link when available. Store approval timing need not match.
9. **Maintain the release.** Check support reports and store-provided installs/uninstalls/reviews weekly, without adding telemetry. Keep known issues current. For regressions, prepare a fixed higher-version package; do not assume stores will accept a version downgrade. Re-test reported platform layout changes before publishing updates.

**Upload gate:** all automated checks pass; fresh packages match the reviewed commit; live browser results are recorded; real screenshots and public policy/support pages are ready; publisher access and recovery are secured; and the identified blocking, settings, and compatibility defects are closed. Passing the current unit suite alone does not satisfy this gate.

## 5. Fixed scope and assumptions

- Launch targets: Chrome Web Store, Microsoft Edge Add-ons, and Firefox desktop AMO.
- Product priority: reliability first; existing seven optional sites remain opt-in, with no platform expansion.
- Ultimate Lock stays, moves to Advanced, and retains its current removal ritual.
- Facebook keeps broad video protection with accurate labeling.
- The product remains free, local, account-free, ad-free, and telemetry-free.
- This document is an implementation plan and evidence record. Runtime fixes, new release packages, authenticated live testing, and store submissions were not performed during this review.
