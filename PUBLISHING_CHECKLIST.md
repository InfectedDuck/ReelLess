# ReelLess v2.3.1 Publishing Checklist

This is the authoritative release checklist. `SUBMISSION_README.md` points here; privacy, security, manual-testing, and marketing documents keep their distinct purposes.

## Packages

- `npm run build` validates the extension and writes `dist/reels-blocker.zip` with `manifest.json` at the ZIP root. This one ZIP is the upload for both the Chrome Web Store and Microsoft Edge Add-ons.
- `npm run submission` reads the version from `manifest.json` and copies the build into `release/ReelLess-v<version>/` as `UPLOAD-THIS-reels-blocker-v<version>.zip`, next to the listing images and reference documents. It refuses to overwrite an existing folder, so remove that folder first when you need a fresh kit.
- `npm run build:firefox` generates the Firefox manifest from `manifest.json`, stages the same runtime files in `dist/firefox/`, and writes `dist/reelless-firefox.zip` for addons.mozilla.org. The add-on id is `reelless@infectedduck.github.io`, the minimum version is Firefox 140.0, and there is no Firefox-for-Android opt-in for this release (desktop only; Android support code stays dormant). AMO caps the manifest name at 45 characters, so the Firefox manifest ships as `ReelLess: Block Shorts, Reels and TikTok`; every other store uses the name in `manifest.json`. Both packages are written by `scripts/zip.mjs`, which stores entries with forward slashes; Windows PowerShell's `Compress-Archive` writes backslashes, which AMO rejects. Run `npx addons-linter dist/reelless-firefox.zip` before uploading and expect zero errors.
- Never upload the existing `dist` ZIPs from an earlier review; always build fresh from the reviewed commit and record the commit plus SHA-256 of each ZIP.

## Upload

- Chrome Web Store: upload only the `UPLOAD-THIS-*.zip` from the submission folder. It is byte-for-byte `dist/reels-blocker.zip`.
- Microsoft Edge Add-ons: upload the same `dist/reels-blocker.zip` (test sideloaded in Edge first).
- Firefox: upload `dist/reelless-firefox.zip`. The gecko id is fixed for the life of the listing; changing it later would create a separate add-on instead of an update.
- Do not ZIP or upload the submission folder itself; the documents and Store images are dashboard materials, not extension runtime files.
- Confirm each dashboard reads the manifest version after upload.

## Store listing

- The listing name is `Block Shorts & Reels: YouTube, Instagram, TikTok, Facebook — ReelLess` and the summary is the manifest `description`. Both are read from `manifest.json`; `npm run validate` fails if the name exceeds 75 characters or the summary exceeds 132. ReelLess stays the in-product name in the popup, icon, and toolbar tooltip.
- Copy the detailed description, single purpose, permission explanations, data-use disclosure, support URL, and non-affiliation notice from `STORE_LISTING.md` (`documents/STORE_LISTING.md` inside the submission kit).
- Upload the five numbered 1280×800 screenshots from `store-assets/` in order, regenerated from the final build. Fail asset generation when required live captures are unavailable instead of retaining old images.
- Upload the 440×280 promo tile. The 1400×560 marquee tile is optional.
- Select the most accurate productivity category and English as the initial language.
- Avoid claims about guaranteed productivity, rankings, user counts, or platform endorsement. Do not claim estimated "hours saved."

## Privacy

- Use the public GitHub Pages privacy-policy URL (`docs/privacy.html`) once it is live (verify signed-out).
- Declare the extension's single purpose exactly as written in `STORE_LISTING.md`.
- Disclose local processing of supported-site URLs/page elements and local storage of settings, prompt state, and aggregate counters.
- State that ReelLess does not sell or transmit user data and does not use data for advertising, credit, or unrelated purposes.
- Explain every requested permission using the supplied permission copy: `storage`, `alarms`, `scripting`, `declarativeNetRequestWithHostAccess`, bundled access to YouTube, Instagram, Facebook, and TikTok, and optional HTTPS access for Advanced sites and custom domains.

## Distribution and review

- Choose Public only after completing `MANUAL_TESTING.md` (`documents/MANUAL_TESTING.md` in the kit); use trusted testers first if any live layout is uncertain.
- No account or test credentials are required for the extension itself.
- Use deferred publishing if you want to coordinate the Store listing, the GitHub release, and the public website.
- After submission, monitor the developer email for reviewer questions.

## Final release gate

- `npm test`, `npm run validate`, `npm run smoke`, `npm run test:x-browser`, `npm run test:instagram-browser`, `npm audit --audit-level=high`, `npm run build`, and `npm run build:firefox` pass.
- Fresh packages match the reviewed commit; runtime contents verified.
- Live desktop Chrome, Edge, and Firefox results are recorded (four core sites signed in/out, optional controls, direct and in-app links, keyboard, pause/schedules, denied/revoked access, both lock profiles, light/dark, 200% zoom).
- Real screenshots and public policy/support pages are ready; publisher access and recovery are secured.
- YouTube, Instagram, Facebook, and TikTok pass logged-in and logged-out manual checks.
- Optional permission denial fails safely (never reports successful activation).
- The extension card and service-worker console contain no errors.
- Privacy and Store copy match current behavior: hidden or visible-but-unopenable entry points, opt-in surfaces, neutral review prompt after seven active days, settings schema v11, exact-host custom boundaries, and desktop-only Firefox.
