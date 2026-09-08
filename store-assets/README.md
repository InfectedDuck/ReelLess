# ReelLess Store Assets

The listing set is captured from the real v2.3.0 extension, loaded unpacked into a Chrome for Testing profile, against the live sites. Nothing new is mocked up: a frame that needs a signed-in account is skipped with instructions rather than faked, and the previous file is left in place.

- `01-popup.png` — the actual popup, scaled to fill the frame, with seeded local-only counters
- `02-youtube-before-after.png` — live YouTube search results before and after the guard runs, both captured from the same scroll offset so the frames differ only by what ReelLess removed
- `03-instagram-facebook.png` — Instagram and Facebook with Reels entry points removed. The live capture needs a signed-in profile (see below); the file currently checked in is the earlier fixture-based composite carried forward from v2.2.0, and should be regenerated from a signed-in profile before it is uploaded
- `04-advanced-settings.png` — the actual Settings page with Advanced open, scrolled to the optional sites
- `05-focus-count.png` — the focus screen on live TikTok beside the popup's local counts
- `promo-440x280.png` — small promotional tile, rendered from the brand palette and icon
- `marquee-1400x560.png` — optional Chrome Web Store marquee tile, same palette and message as the product UI
- `reelless-icon-master.png` — transparent master that `scripts/generate-icons.ps1` renders the release icons from

All five screenshots are 1280×800; `npm run validate` checks those dimensions, plus the 440×280 promo and 1400×560 marquee sizes. `screenshot-1280x800.png` mirrors the popup asset for compatibility with older release notes.

Regenerate the set with:

```powershell
npm run screenshots
```

The script (`scripts/capture-store-assets.mjs`) launches Chromium from `playwright-core` with a temporary profile. Instagram and Facebook show a login wall to a signed-out browser, so `03-instagram-facebook.png` is only regenerated when `REELLESS_PROFILE` points at a Chrome profile directory that is already signed in to both; otherwise the previous file is left in place and the script says so. `REELLESS_CHROME_PATH` overrides the browser executable and `REELLESS_HEADLESS=1` runs without a window. If TikTok is unreachable, `05-focus-count.png` falls back to a minimal fixture and the script reports it.
