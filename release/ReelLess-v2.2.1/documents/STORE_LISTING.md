# Chrome Web Store Listing — ReelLess v2.2.1

## Name

ReelLess — Shorts & Reels Blocker

## Summary

Remove YouTube Shorts, Instagram and Facebook Reels, and TikTok distractions while keeping useful pages available.

## Detailed description

ReelLess helps students and knowledge workers avoid short-form feeds without giving up the useful parts of social platforms.

Four calm defaults work immediately:

- YouTube: hide Shorts navigation, shelves, cards, results, and channel tabs; open a direct Short as a regular video.
- Instagram: hide Reels entry points and return direct Reel visits to the feed.
- Facebook: hide Reels entry points and return direct Reel visits to the feed.
- TikTok: replace feed and video surfaces with a quiet focus screen.

The popup shows protection status, local today/all-time blocked-attempt counts, four platform switches, and quick pauses for 5, 15, or 30 minutes or until tomorrow. Choose Dark, Light, or Use Chrome setting from Settings.

Advanced controls progressively reveal schedules, selected/full-site modes for seven additional platforms, TikTok utility-section exceptions, and custom blocked domains. Additional site access is requested only when the user enables that site.

For extra self-control, an optional Ultimate Lock can force protection on and remove ReelLess's own pause/settings controls. Its removal requires a clear choice, a typed phrase, a private unsaved reflection, three active check-ins, and at least one focused minute. Leaving or defocusing Settings resets the release. It does not claim to prevent Chrome or a device administrator from disabling, uninstalling, or clearing the extension.

ReelLess is free, open source, account-free, ad-free, and telemetry-free. It makes no external requests and stores no blocked URL, title, or platform history.

## Single purpose

Remove or interrupt user-selected short-form video and distracting social-platform sections while preserving useful pages.

## Permission explanations

- `storage`: saves blocking choices, schedules, pause expiry, appearance preference, optional Ultimate Lock state, custom entries, prompt state, and two local counters.
- `alarms`: refreshes schedule and pause state at local time boundaries.
- `scripting`: dynamically registers a site-specific guard after the user grants access to an Advanced platform.
- `declarativeNetRequestWithHostAccess`: applies block-only rules to custom domains that the user added and explicitly granted.
- Core site access: YouTube, Instagram, Facebook, and TikTok guards inspect the current URL and specific local links/elements needed to find short-form entry points.
- Optional site access: Advanced platforms and arbitrary custom domains request exact HTTPS origins only from an explicit user action and remove access when disabled.

## Data-use disclosure

No user data is collected or transmitted. Processing and storage remain local. The counter schema is only `{localDay, todayCount, totalCount}`.

## Support and privacy

- Privacy: publish `docs/privacy.html` with GitHub Pages.
- Support: https://github.com/InfectedDuck/Google-Chrome-Safe-Short-Video-content-blocker/issues
- Source: https://github.com/InfectedDuck/Google-Chrome-Safe-Short-Video-content-blocker

## Trademark notice

ReelLess is an independent extension and is not affiliated with, endorsed by, or sponsored by YouTube, Google, Instagram, Facebook, Meta, TikTok, ByteDance, or any other supported platform. Names and trademarks belong to their respective owners.

## Release assets

Use the five 1280×800 PNG files in `store-assets/`, the 440×280 promo tile, and optional 1400×560 marquee tile. Screenshots must show the real extension UI and must not imply platform affiliation.
