# ReelLess Store and README Assets

The set is captured from the real v2.3.1 extension, loaded unpacked into a temporary Chrome for Testing profile. Frames that need an account are skipped unless an explicit capture profile is supplied; the generator never signs in or reads a personal browser profile by default.

- `01-popup.png` — the actual popup, scaled to fill the frame, with seeded local-only counters
- `02-youtube-before-after.png` — live YouTube search results before and after the guard runs, both captured from the same scroll offset so the frames differ only by what ReelLess removed
- `04-advanced-settings.png` — the actual Settings page with Advanced open, scrolled to the optional sites
- `05-focus-count.png` — legacy filename for the full-width TikTok focus screen, captured from the live signed-out site when reachable or from the privacy-safe TikTok Chrome test surface otherwise
- `06-supported-sites.png` — the actual Settings DOM compacted with capture-only CSS to show all four core and seven optional sites; used in the public README
- `07-section-controls.png` — the actual YouTube and Instagram per-section controls with deliberate demo choices stored only in the temporary capture profile; used in the public README
- `08-youtube-tabs-before-after.png` — a live signed-out YouTube before → after comparison proving that protected Home and Shorts navigation collapses while Subscriptions remains
- `09-youtube-focus-screen.png` — a direct visit to a live YouTube Short showing the real focus dialog, allowed-page links, pause action, and Settings action
- `promo-440x280.png` — small promotional tile, rendered from the brand palette and icon
- `marquee-1400x560.png` — optional Chrome Web Store marquee tile, same palette and message as the product UI
- `reelless-icon-master.png` — transparent master that `scripts/generate-icons.ps1` renders the release icons from

All eight screenshots are 1280×800; `npm run validate` checks those dimensions, plus the 440×280 promo and 1400×560 marquee sizes. `screenshot-1280x800.png` mirrors the popup asset for compatibility with older release notes.

The images embedded in the public README (`01`, `02`, and `05` through `09`) contain no private account details. Popup counts and section choices are seeded demo values. Both YouTube comparisons and the YouTube focus screen use the real public signed-out site.

Regenerate the set with:

```powershell
npm run screenshots
```

The script (`scripts/capture-store-assets.mjs`) launches Chromium from `playwright-core` with a temporary profile. `REELLESS_CHROME_PATH` overrides the browser executable and `REELLESS_HEADLESS=1` runs without a window. YouTube frames are generated only when the live signed-out site is reachable. If TikTok is unreachable, `05-focus-count.png` uses the polished privacy-safe TikTok test surface and asserts that the production focus screen and actions rendered correctly.
