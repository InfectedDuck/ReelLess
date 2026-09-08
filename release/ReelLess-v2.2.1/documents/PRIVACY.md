# ReelLess Privacy Policy

Effective: September 1, 2026

ReelLess — Shorts & Reels Blocker does not collect, transmit, sell, or share personal information. It has no analytics, advertising, tracking pixels, remote code, accounts, or external network requests.

## What the extension processes

On sites the user enables, ReelLess scripts inspect:

- the current page URL, to decide whether the page is a blocked short-form or selected section; and
- specific local page elements and links needed to find Shorts, Reels, and other enabled entry points.

This processing happens only in the browser. ReelLess does not transmit URLs, page contents, video titles, account details, messages, comments, cookies, or browsing history.

If the user starts the optional Ultimate Lock release ritual, ReelLess temporarily checks the length of the reflection typed on the Settings page. That text remains only in the open page, is never stored, and is discarded when the page closes or reloads.

## What the extension stores

ReelLess stores these values in `chrome.storage.local` on the user’s device:

- blocking modes, section choices, schedules, pause expiry, appearance preference, Ultimate Lock state/profile, and custom domain/path entries;
- a local daily and all-time count of deliberate blocked attempts, stored only as `{localDay, todayCount, totalCount}`; and
- first-run and review-prompt state, including only an active-day count and the last local active day used to delay the neutral prompt.

It does not store a history of blocked URLs, titles, or platforms. Settings are not synced to a ReelLess account because no account exists.

## Permissions

The four core sites—YouTube, Instagram, Facebook, and TikTok—are included with the extension. Seven Advanced sites and custom domains use optional HTTPS site access. Chrome asks for the exact additional site access only after the user enables that site or adds that domain.

`storage` saves local settings and counts. `alarms` refreshes schedules. `scripting` registers guards for Advanced sites after permission is granted. `declarativeNetRequestWithHostAccess` blocks only user-added custom destinations for which access has been granted.

Removing an Advanced site or custom domain removes its related optional access when that access is no longer needed.

## Contact

Questions and privacy reports can be opened at [GitHub Issues](https://github.com/InfectedDuck/Google-Chrome-Safe-Short-Video-content-blocker/issues).

If ReelLess ever changes its data practices, this policy will be updated before the changed version is released.
