# Chrome Web Store Listing — ReelLess v2.3.1

Copy each block below into the matching field of the Chrome Web Store dashboard. The Store shows the description as plain text: line breaks are kept, Markdown is not rendered, so the description uses capitals and • bullets instead of formatting.

## Name

Block Shorts & Reels: YouTube, Instagram, TikTok, Facebook — ReelLess

## Summary

Read from `manifest.json` (`npm run validate` fails above 132 characters).

```text
Block YouTube Shorts, Instagram & Facebook Reels, and TikTok, and keep the useful parts. Free, private, no account needed.
```

## Detailed description

```text
Short videos are built to keep you scrolling. ReelLess removes them from the sites you still need, so you can open YouTube for a tutorial, Instagram for a message, or Facebook for your group, and leave again without being pulled into an endless feed.

It works the moment you install it. No account, no setup, and nothing ever leaves your browser.

WHAT IT BLOCKS
• YouTube: Shorts disappear from the sidebar, home page, search results, channel tabs, and recommendation shelves. Opening a Shorts link shows a calm focus screen instead of playing it. Regular videos play as usual.
• Instagram: Reels links and the Reels tab are hidden, and opening a Reel takes you back to your feed.
• Facebook: the Reels and Watch tabs are hidden, Reel links take you back to your feed, and Watch, video, and Live pages are stopped with a focus screen.
• TikTok: the For You feed and video pages are replaced with a focus screen. Messages, Upload, and Settings stay available.

WHAT STAYS
• Your messages. Instagram Direct and Messenger conversations are never changed.
• Everything you came for: YouTube videos, subscriptions, and search; Instagram profiles and posts; Facebook posts, Groups, and Marketplace.
• No reloads, no jumping pages. Blocked items are removed in place, so you keep your scroll position.

MAKE IT YOURS (all optional)
• Pause for 5, 15, or 30 minutes, or until tomorrow. Protection turns itself back on.
• Schedules: Work hours, School / study, Sleep time, Evening focus, or your own times.
• Block whole sections: YouTube Home, Trending, or Gaming; Instagram Home, Explore, or Stories; Facebook Home feed, Groups, Stories, Marketplace, or Events; TikTok LIVE.
• Quiet YouTube even more: hide home recommendations, the Up next sidebar, comments, or end-screen suggestions.
• Hidden or visible: blocked links can disappear completely or stay visible but refuse to open.
• Seven more sites when you want them: X / Twitter, Reddit, Snapchat, Twitch, Pinterest, LinkedIn, and Threads. Each one asks for permission only when you switch it on.
• Block any other website or page by adding it yourself.
• Ultimate Lock, for days you don't trust yourself: it keeps protection on and hides the pause and settings controls until you go through a deliberate, multi-step release.
• Dark, Light, or match your Chrome theme.
• A small counter shows how many distractions you skipped today and in total.

PRIVATE BY DESIGN
• No account, ads, analytics, or tracking.
• No network requests. Your settings and counters stay in your browser.
• No history. ReelLess never records which videos or pages you opened.
• Free and open source: https://github.com/InfectedDuck/ReelLess

GOOD TO KNOW
• On Facebook, ReelLess blocks pages and tabs. It does not hide individual videos inside the Home feed.
• Tabs that were already open when you installed ReelLess need one refresh.
• Ultimate Lock makes giving in harder, but anyone can still turn off or remove the extension from Chrome's settings.

Questions or ideas? Open an issue: https://github.com/InfectedDuck/ReelLess/issues

ReelLess is an independent extension and is not affiliated with, endorsed by, or sponsored by YouTube, Google, Instagram, Facebook, Meta, TikTok, ByteDance, or any other supported platform. Names and trademarks belong to their respective owners.
```

## Category and language

- Category: Productivity (subcategory Workflow & Planning if asked)
- Language: English

## Single purpose

```text
Remove or interrupt user-selected short-form video and distracting social-platform sections while preserving useful pages.
```

## Permission explanations

- `storage`: saves blocking choices, schedules, pause expiry, appearance preference, optional Ultimate Lock state, custom entries, prompt state, and two local counters.
- `alarms`: refreshes schedule and pause state at local time boundaries.
- `scripting`: dynamically registers a site-specific guard after the user grants access to an Advanced platform.
- `declarativeNetRequestWithHostAccess`: applies block-only rules to custom domains that the user added and explicitly granted.
- Core site access: YouTube, Instagram, Facebook, and TikTok guards inspect the current URL and specific local links/elements needed to find short-form entry points.
- Optional site access: Advanced platforms and arbitrary custom domains request exact HTTPS origins only from an explicit user action and remove access when disabled.

The dashboard's host-permission box covers both of the last two lines; paste them together.

## Data-use disclosure

No user data is collected or transmitted. Processing and storage remain local. The counter schema is only `{localDay, todayCount, totalCount}`.

In the Privacy tab: remote code "No", tick none of the data types, and tick all three certifications.

## Support and privacy

- Privacy policy: https://infectedduck.github.io/ReelLess/privacy.html
- Homepage: https://infectedduck.github.io/ReelLess/
- Support: https://github.com/InfectedDuck/ReelLess/issues
- Source: https://github.com/InfectedDuck/ReelLess

## Trademark notice

ReelLess is an independent extension and is not affiliated with, endorsed by, or sponsored by YouTube, Google, Instagram, Facebook, Meta, TikTok, ByteDance, or any other supported platform. Names and trademarks belong to their respective owners. This notice already ends the detailed description above.

## Release assets

Upload the five `screenshot-N-*.png` files from the submission kit's `listing-assets/` in order, the 440×280 promo tile, and the optional 1400×560 marquee tile. Screenshots must show the real extension UI and must not imply platform affiliation.
