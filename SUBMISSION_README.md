# ReelLess Submission Kit (see PUBLISHING_CHECKLIST.md)

Upload the `UPLOAD-THIS-*.zip` from the versioned `release/` folder to the Chrome Web Store Developer Dashboard. It is the verified `dist/reels-blocker.zip` produced by `npm run build`, packaged with `manifest.json` at the ZIP root. The same ZIP is the upload for Microsoft Edge Add-ons.

Do not upload or ZIP this whole folder. The other folders contain separate Store listing images and reference documents used while completing the dashboard.

- `listing-assets`: the five numbered 1280×800 screenshots, `promo-440x280.png`, the optional `marquee-1400x560.png`, and `icon-128.png`, to upload in the Store Listing tab.
- `documents`: `STORE_LISTING.md` (listing copy), `PRIVACY.md`, `SECURITY_REVIEW.md`, `MANUAL_TESTING.md`, and `PUBLISHING_CHECKLIST.md`.

The Firefox package is not part of this kit. `npm run build:firefox` writes `dist/reelless-firefox.zip` for addons.mozilla.org (desktop only), with its manifest generated from the same `manifest.json`.

This kit is created by `npm run submission` (version read from `manifest.json`). The public privacy and support pages are maintained in the repository's `docs` folder and should be published with GitHub Pages before the Store listing goes live. Follow `PUBLISHING_CHECKLIST.md` as the authoritative checklist.
