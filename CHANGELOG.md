# Changelog

All notable changes to ReelLess are documented here.

## 2.3.0 - 2026-09-08

- Facebook videos in the feed can now actually be stopped. Facebook plays them in place and opens them in a dialog without ever changing the address, so there was no navigation to refuse and no link click to catch: selecting the Watch section blocked the Watch tab and a page's Videos tab, and the feed carried on playing regardless. With Watch selected, the posts carrying those videos are now removed from the feed, which is the only point where the decision can still be made. Ordinary posts stay. This needs entry points set to Hidden, since "Visible, can't be opened" is precisely what cannot be delivered when nothing announces the open.
- Closed three routes that reached a Facebook Reel without being recognised as one. A Reel sent as a share link (`/share/r/`) opened and played, and so did a page's Reels tab (`/nasa/reels/`), which the stylesheet was already hiding but the guard did not know to stop. Both are now blocked in the default mode, and leaving a page's Reels tab lands on the page rather than the feed. Facebook's older `/video.php` address and video share links now follow the Watch choice, as the Videos tab already did.
- Instagram and Facebook Reels are now hidden by the stylesheet, as YouTube Shorts already were. A Reel card is never laid out or painted, so a Reel-heavy feed no longer stutters while scrolling, and the feed can no longer carry you upward when it reuses a card that had been hidden: a rule that never marked anything has nothing to take back. Only the innermost card around a Reel link is taken, never a wrapper that holds other posts or the page's main region. The Reels entry in the navigation rail and a profile's Reels tab are hidden on their own, since neither sits inside a card.
- Instagram Direct and Facebook Messenger conversations are excused from hiding by their address, before the settings are even read. Nothing in a thread is touched, a shared Reel link included; opening one is still refused, exactly as before.
- Selected sections mode with Reels or Shorts deliberately unchecked no longer hides them. The stylesheet gate now follows per-section choices, so an entry point you chose to keep stays visible.
- Where :has() is unavailable, a hidden card that a feed recycles for an ordinary post is now revealed only once it provably sits below what you are reading. It used to be revealed whenever its position could not be established, or when its neighbour straddled the top of the screen, which is exactly where a reveal pushes the feed down under you.
- Fixed the Instagram feed carrying you back up while you read it. Two causes. A recycled card was being revealed at full height above you the moment the site emptied it, because an absent link was treated as proof the card had become ordinary; revealing it pushed everything below it down. And the guard was answering the site's own address rewrites with a history step, which restores the scroll position saved on the entry it lands on. Measured over one reading session, the two together produced 22 backward jumps of up to 3,269 pixels. Both are now zero.
- The guard no longer steps back through history at all. It replaces the address, which moves nothing, and tells the page the address moved so a viewer opened by the page itself still closes.
- Paging with Space, PageDown or the arrow keys no longer looks like opening something, so reading a feed can never be mistaken for a deliberate attempt.
- A Reel shared in a Direct conversation can no longer be opened. Instagram renders these as a card rather than a link, so the click guard never saw them; opening one still moves the address, and that is now undone. The conversation itself is untouched, exactly as before: nothing in it is hidden, only the Reel refuses to open.
- Fixed the Instagram feed throwing you back to the top while scrolling. Instagram rewrites its address to a Reel as reels pass the viewport, and the guard answered that with a real navigation, which reloaded the feed and reset the scroll position, over and over. When the page you are on was already allowed, the address is now put back without touching the page. Arriving directly on a Reel still redirects as before, and a Short still opens in the normal player.
- Address changes made by a site while you scroll are no longer counted as blocked attempts, since nobody asked to go anywhere.
- Same-document address changes are now noticed through the Navigation API where available, which cuts the response from up to a second down to a few milliseconds.
- Added optional controls to quieten YouTube's other attention surfaces: the home feed recommendations, the Up next sidebar, comments, and end-screen suggestions. All four are off until switched on, none of them blocks navigation, and they live in the detailed YouTube row under Advanced. Hiding more of a page is the most common way an extension in this category breaks something, so these are opt-in by design.
- The review prompt now reaches people the extension simply worked for. It previously required seven separate days on which you tried to open something blocked, so the users who never relapsed were never asked.
- Migrated saved settings to schema v7, which adds the surface switches and keeps every existing choice.
- Hiding is now done by the stylesheet rather than by script, so a Short is never painted at all. Previously a card could appear for a few frames before script removed it, which is what produced the glimpse when scrolling or hovering near a Shorts row. Measured across 164 frames of scrolling, the old path showed Shorts on 7 of them and the new path on none.
- The script no longer watches the DOM on YouTube, because the stylesheet has already hidden everything before it is laid out. Where :has() is unavailable the previous script path still runs, so nothing is lost on older browsers.
- Closed short-form entry points that were reachable through a handle: an Instagram profile's Reels tab, a TikTok profile page, and a Facebook page's Videos tab. Section matching is now pattern-based, and a blocked profile Reels tab returns to that profile rather than the feed.
- Removed a TikTok path prefix that could never match a real profile URL, which left profile pages open whenever TikTok was narrowed from Block all.
- YouTube search results now hide the Shorts shelf with its heading, instead of leaving an empty "Shorts" title behind. A grid that mixes Shorts with ordinary videos loses only the Shorts.
- Added a Firefox build. The extension aliases the promise-based browser namespace, guards its background import, and generates the Firefox manifest from the Chrome one so the two cannot drift. The Firefox manifest carries a 45-character name and the data-collection declaration AMO requires, with a minimum of Firefox 140.
- Store packages are now written by a small in-repo ZIP writer. Windows PowerShell's Compress-Archive stored nested entries with backslashes, which Mozilla's validator rejects outright; the build now fails on a backslash instead of hiding it.
- Opted the Firefox package in to Firefox for Android, and hid the optional-sites and custom-pages controls there, since Android offers no way to grant that access.
- Store screenshots are now captured from the live YouTube and TikTok, not from synthetic mock-ups. Frames that need a signed-in account are skipped with instructions rather than faked.
- Renamed the Chrome Web Store listing to lead with what people search for: "Block Shorts & Reels: YouTube, Instagram, TikTok, Facebook — ReelLess". ReelLess remains the in-product brand in the popup, icon, and toolbar tooltip.
- Rewrote the store summary to name the platforms, the Shorts-to-normal-player redirect, and the offline/no-account promise.
- Updated the release check to accept the brand anywhere in the name and to fail if the store name or summary exceeds the 75 and 132 character limits.
- Fixed the release check reading the manifest as ANSI, which miscounted the em dash in the store name.
- Added a per-site entry-point choice: Shorts, Reels, and feed links can be hidden from feeds (default) or stay visible but cannot be opened. It appears on each core card and in the Advanced rows for every site.
- Fixed lag and flicker while scrolling YouTube with Shorts hidden. The guard no longer clears and re-checks every link on the page whenever a link attribute changes; it evaluates only new content and links that actually changed, hides new cards before they are painted, and tracks checked links off the DOM.
- YouTube home Shorts shelves are now hidden as one unit, including their heading, instead of leaving an empty band.
- A blocked click that cannot be converted now shows the focus screen until you choose Stay here, pause, or open Settings, instead of disappearing on the next page update.
- Hidden cards that a site recycles for ordinary content reappear automatically, and schedule or pause boundaries refresh hidden cards without a reload.
- Migrated saved settings to schema v6, keeping every existing choice and defaulting entry points to hidden.

## 2.2.1 - 2026-09-01

- Strengthened Ultimate Lock removal with a private unsaved reflection and three timed confirmation checkpoints.
- Made the one-minute release countdown pause at each checkpoint and reset completely when Settings loses focus, is hidden, reloaded, or closed.
- Added Chrome smoke and interface coverage for the active release ritual and its local-only privacy boundary.
- Removed obsolete Messenger content-script access, narrowed arbitrary optional access to HTTPS, safely rendered custom entries, and hardened service-worker message validation.
- Added a security review and a reproducible Chrome Web Store submission kit.

## 2.2.0 - 2026-08-31

- Retired the unreliable Direct-message video feature. ReelLess no longer changes Instagram Direct or Messenger conversations.
- Migrated saved settings to schema v5, safely removing the retired Direct-video field while preserving supported choices.
- Rebuilt the popup, onboarding, Settings workspace, focus screen, and Store assets around a calmer core-first interface.
- Added the optional Chrome Web Store marquee asset and refreshed release checks for the updated product promise.

## 2.1.3 - 2026-08-31

- Made the Instagram Direct and Facebook Messenger video control an independent toggle in each core platform card.
- Added early interception for recognizable Play, Video, and Reel media controls in direct-message conversations, before their viewer opens.
- Added local feedback and Chrome/DOM coverage for deliberate direct-message video attempts.

## 2.1.2 - 2026-08-31

- Fixed the Ultimate Lock panels so only the relevant action is visible: enable before activation, then removal after activation.
- Added Chrome smoke coverage to prevent both Ultimate Lock flows from appearing at once.

## 2.1.1 - 2026-08-31

- Added a minimal dark appearance as the default, with Light and Use Chrome setting options in Settings.
- Updated the popup, onboarding, in-page focus screen, and public site to use the selected or system dark appearance without returning to gradients or glass effects.
- Migrated saved settings safely to schema v4 to retain the appearance preference locally.

## 2.1.0 - 2026-08-31

- Added an optional Instagram Direct and Facebook Messenger control that hides and pauses inline direct-message videos while preserving the conversation layout.
- Added Ultimate Lock: choose either all core short-form blocking or the current platform choices, confirm with a phrase, and lock protection to always on.
- Ultimate Lock removes normal pause and settings controls. Releasing it requires selecting the removal action, entering a second phrase, and completing an uninterrupted one-minute wait.
- Documented the lock boundary clearly: Chrome can still disable, uninstall, or clear the extension; Ultimate Lock cannot override browser or device controls.
- Migrated local settings safely to the versioned v3 schema.

## 2.0.0 - 2026-08-31

- Rebranded the extension as ReelLess — Shorts & Reels Blocker.
- Replaced core DNR redirects with site-specific navigation and DOM guards for YouTube, Instagram, Facebook, and TikTok.
- Added YouTube Shorts-to-watch conversion, Reels feed redirects, and a calm TikTok focus screen.
- Fixed the Always on midnight gap and added schedule/pause boundary coverage.
- Introduced the versioned v2 settings migration and separate privacy-minimal statistics key.
- Moved seven additional platforms and custom destinations behind explicit optional site access.
- Rebuilt onboarding, popup, settings, privacy/support pages, icon, listing copy, and five real UI screenshots.
- Added DOM fixtures, permission/counter tests, Chrome extension smoke tests, verified packaging, and CI.

## 1.2.5 - 2026-05-30

- Added a social-platform guard for TikTok, Instagram, Facebook, X, Reddit, Snapchat, Twitch, Pinterest, LinkedIn, and Threads section navigation.
- Section-level blocks now redirect blocked in-app navigation back to the platform home page where possible.
- Full-site modes still use Chrome's normal blocked-page behavior, so Block Social Media and per-platform Block All show an error instead of redirecting.

## 1.2.4 - 2026-05-30

- Added an Instagram-only guard script for Reels, Explore, and Stories internal navigation.
- Blocked Instagram sections now redirect back to Instagram home instead of remaining usable after in-app clicks.
- Updated Instagram section rules so page navigation can be handled by the local guard while background media requests remain blocked.

## 1.2.3 - 2026-05-30

- Fixed stale Chrome blocking rules from older builds by clearing all dynamic and session rules before applying the current saved settings.
- This makes platform `Off` settings remove old TikTok rules even if they were created by an earlier extension version.

## 1.2.2 - 2026-05-30

- Fixed background rule syncing so it evaluates the full saved settings when applying blocking rules.
- Platform, schedule, preset, and custom list changes now apply immediately instead of waiting for a separate save click.
- Opening the settings page now asks the extension to resync rules, which helps clear stale rules from older versions.

## 1.2.1 - 2026-05-30

- Fixed schedule preset time fields so Always On, Work Hours, Sleep Time, and other presets immediately show their own time windows.
- Limited direct time editing to the Custom schedule preset.
- Fixed platform controls so changing a platform quick mode or section automatically switches Focus Mode to Custom.

## 1.2.0 - 2026-05-30

- Added global modes for short-form blocking, social media blocking, custom controls, and pause.
- Added schedule presets and manual temporary pause buttons.
- Expanded platform controls to Facebook, X, Reddit, Snapchat, Twitch, Pinterest, LinkedIn, and Threads.
- Added section-level controls for feeds, profiles, messages, create pages, and short-form sections.
- Redesigned the settings page and GitHub Pages site.

## 1.1.0 - 2026-05-29

- Added platform tabs for TikTok, Instagram, and YouTube.
- Added per-platform modes for short-form only, full-site blocking, and off.
- Moved built-in platform blocking to local dynamic rules so settings can control each platform.

## 1.0.2 - 2026-05-29

- Added a YouTube-only guard script that redirects internal Shorts clicks back to YouTube home.
- Updated privacy and store listing text to disclose the YouTube-only script.

## 1.0.1 - 2026-05-29

- Strengthened YouTube Shorts blocking with direct Chrome URL filters.
- Added tests for reported Shorts URLs.

## 1.0.0 - 2026-05-29

- Stabilized the privacy-first extension for public release.
- Added launch-ready documentation and store listing materials.

## 0.5.0 - 2026-05-29

- Added optional short-form blocking presets.
- Added community, security, and issue template documents.

## 0.4.0 - 2026-05-29

- Added local schedules for Always On, Work Hours, and Custom Schedule modes.

## 0.3.0 - 2026-05-29

- Added a local custom block list.
- Added local settings storage without sync or account requirements.

## 0.2.0 - 2026-05-29

- Added a local focus page.
- Improved the popup trust messaging.

## 0.1.0 - 2026-05-29

- Added the first Manifest V3 extension.
- Blocked TikTok, Instagram Reels, and YouTube Shorts using local Chrome rules.
- Added privacy policy, package script, rule tests, and Chrome Web Store listing draft.
