# ReelLess v2.3.0 Publishing Checklist

## Packages

- `npm run build` validates the extension and writes `dist/reels-blocker.zip` with `manifest.json` at the ZIP root. This one ZIP is the upload for both the Chrome Web Store and Microsoft Edge Add-ons.
- `npm run submission` runs the same build and copies it into `release/ReelLess-v2.3.0/` as `UPLOAD-THIS-reels-blocker-v2.3.0.zip`, next to the listing images and reference documents. It refuses to overwrite an existing `release/ReelLess-v2.3.0` folder, so remove that folder first when you need a fresh kit.
- `npm run build:firefox` generates the Firefox manifest from `manifest.json`, stages the same runtime files in `dist/firefox/`, and writes `dist/reelless-firefox.zip` for addons.mozilla.org. The add-on id is `reelless@infectedduck.github.io`, the minimum version is Firefox 128.0, and the package opts in to Firefox for Android.

## Upload

- Chrome Web Store: upload only `UPLOAD-THIS-reels-blocker-v2.3.0.zip` from the submission folder. It is byte-for-byte `dist/reels-blocker.zip`.
- Microsoft Edge Add-ons: upload the same `dist/reels-blocker.zip`.
- Firefox: upload `dist/reelless-firefox.zip`. The gecko id is fixed for the life of the listing; changing it later would create a separate add-on instead of an update.
- Do not ZIP or upload the submission folder itself; the documents and Store images are dashboard materials, not extension runtime files.
- Confirm each dashboard reads version `2.3.0` after upload.

## Store listing

- The listing name is `Block Shorts & Reels: YouTube, Instagram, TikTok, Facebook — ReelLess` and the summary is the manifest `description`. Both are read from `manifest.json`; `npm run validate` fails if the name exceeds 75 characters or the summary exceeds 132. ReelLess stays the in-product name in the popup, icon, and toolbar tooltip.
- Copy the detailed description, single purpose, permission explanations, data-use disclosure, support URL, and non-affiliation notice from `STORE_LISTING.md` (`documents/STORE_LISTING.md` inside the submission kit).
- Upload the five numbered 1280×800 screenshots from `store-assets/` in order. `02` and `05` are captured from the live YouTube and TikTok sites. `03` is regenerated only from a signed-in profile (`REELLESS_PROFILE`); until that is done the checked-in file is the earlier fixture-based composite, so regenerate it before publishing.
- Upload the 440×280 promo tile. The 1400×560 marquee tile is optional.
- Select the most accurate productivity category and English as the initial language.
- Avoid claims about guaranteed productivity, rankings, user counts, or platform endorsement.

## Privacy

- Use the public GitHub Pages privacy-policy URL (`docs/privacy.html`) once it is live.
- Declare the extension's single purpose exactly as written in `STORE_LISTING.md`.
- Disclose local processing of supported-site URLs/page elements and local storage of settings, prompt state, and aggregate counters.
- State that ReelLess does not sell or transmit user data and does not use data for advertising, credit, or unrelated purposes.
- Explain every requested permission using the supplied permission copy: `storage`, `alarms`, `scripting`, `declarativeNetRequestWithHostAccess`, bundled access to YouTube, Instagram, Facebook, and TikTok, and optional HTTPS access for Advanced sites and custom domains.

## Distribution and review

- Choose Public only after completing `MANUAL_TESTING.md` (`documents/MANUAL_TESTING.md` in the kit); use trusted testers first if any live layout is uncertain.
- No account or test credentials are required for the extension itself.
- Use deferred publishing if you want to coordinate the Store listing, the GitHub `v2.3.0` release, and the public website.
- After submission, monitor the developer email for reviewer questions.

## Final release gate

- `npm test`, `npm run validate`, `npm run smoke`, `npm audit --audit-level=high`, `npm run build`, and `npm run build:firefox` pass.
- YouTube, Instagram, Facebook, and TikTok pass logged-in and logged-out manual checks, including a long Instagram feed scroll and a Reel shared in a Direct conversation, both fixed in 2.3.0.
- Optional permission denial fails safely.
- The extension card and service-worker console contain no errors.
- Privacy and Store copy match version `2.3.0` behavior: hidden or visible-but-unopenable entry points, the opt-in YouTube surface controls, the review prompt after seven active days, and settings schema v7.
