# ReelLess Store Assets

The listing set is generated from the real v2.2.1 extension UI with a temporary Chrome for Testing profile.

- `01-popup.png` — popup, four core switches, pauses, and local counts
- `02-youtube-before-after.png` — YouTube fixture before and after the real guard runs
- `03-instagram-facebook.png` — real guard behavior on Instagram/Facebook desktop fixtures
- `04-advanced-settings.png` — schedules and optional-access settings
- `05-focus-count.png` — TikTok focus screen and local blocked-attempt counts
- `promo-440x280.png` — small promotional tile
- `marquee-1400x560.png` — optional Chrome Web Store marquee tile
- `reelless-icon-master.png` — transparent ImageGen master used for release icons

All five screenshots are 1280×800. `screenshot-1280x800.png` mirrors the popup asset for compatibility with older release notes.

Regenerate the set with:

```powershell
npm run screenshots
```

The social pages are controlled local fixtures so captures are repeatable and contain no account data. The extension UI and guard behavior are the real unpacked build.
