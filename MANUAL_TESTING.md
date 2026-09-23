# ReelLess v2.3.1 Manual Release Matrix

Automated fixtures and Chrome-for-Testing smoke checks cover the repeatable core paths. Complete this matrix with real logged-in and logged-out desktop accounts before Web Store submission.

## Core platforms

For YouTube, Instagram, Facebook, and TikTok, test:

- desktop logged in and logged out;
- `www` and mobile hostnames;
- direct short-form link, in-app click, and refreshed blocked page;
- back/forward navigation and SPA transitions;
- two or more open tabs;
- pause start, pause expiry, and Resume now;
- platform Off and restored default;
- extension Reload/update with existing tabs open;
- Chrome site access set to allowed and restricted.

Expected specifics:

- YouTube Short links and channel Shorts tabs disappear; direct `/shorts` and `/shorts/{id}` visits show the focus screen and never play; ordinary videos and subscriptions remain.
- Instagram Reels links disappear; direct Reels return to the feed; messages and ordinary posts remain in the default mode.
- Facebook Reels and feed videos disappear; opening a video stops in place with the video focus screen; direct Watch visits stop in place. Messages and ordinary text/photo posts remain. Uncheck Watch under Advanced → Facebook → Selected sections to allow videos again.
- On Facebook Home, check several consecutive video posts (including posts with nested comments) while the address stays unchanged. Scroll to load more, open and close a viewer, and scroll back to reused posts: every player must remain hidden and silent. Test with both Reels and Watch selected and entry points Hidden; verify pausing protection restores players. The Chrome smoke test covers several URL-free players and a reused player, but release validation still needs a signed-in live feed.
- With Instagram/Facebook Reels set to "Visible, can't be opened", scroll down and activate a Reel link with a click or Enter. The viewer must not open, the document must not reload, and the scroll position must stay unchanged. Repeat from a message thread; opening a blocked URL directly still uses the normal redirect.
- Instagram Home: with Reels hidden, scroll through several consecutive video posts. Each becomes a short "Reel hidden" placeholder; photos and the next batch of posts must still appear, without repeated loading or scroll jumps. Switch to "Visible, can't be opened", then back to Hidden, and check Direct and profiles. Run `npm run test:instagram-browser` for the local geometry/recycling regression fixture; a logged-in feed is still required for release validation.
- TikTok feed/video navigation shows the ReelLess focus screen; allowed Advanced utility sections remain reachable.
- On each core card, tick a full-page option (e.g. Facebook → Block Home feed): the home page shows the focus screen with links to allowed pages, short-form stays blocked, and the matching Advanced checkbox follows. Unticking restores the page and collapses the mode back to Short-form only.
- Counts rise once for a deliberate blocked attempt, not for hidden cards or repeated DOM mutations.

## Entry points in feeds

- On YouTube home with the default **Hidden** choice, scroll through several screens of the feed. Shorts shelves must not flash into view while scrolling, the page must stay responsive, and no Shorts heading or empty shelf band should remain.
- Switch YouTube to **Visible, can't be opened** from the core card. Existing tabs should show Shorts shelves again without a reload; clicking a Short and the Shorts tab must each show the focus screen with a **Stay here** action that closes it, without navigating away.
- Repeat for Instagram and Facebook Reels: cards stay visible in keep mode, and clicking a Reel returns to the feed and counts once.
- Confirm the detailed Advanced row and the core card always show the same choice, and that the choice disappears for a site set to Off or Block all.
- Under Ultimate Lock the entry-point selects are disabled and the locked choice is enforced.

## Ultimate Lock

- Confirm Instagram Direct and Messenger conversations, including their videos, are not modified: nothing in a thread is hidden, and the conversation layout is untouched. A Reel shared in a conversation refuses to open and returns to the thread; a deliberate open counts as one blocked navigation; nothing else in the conversation is counted.
- Enable Ultimate Lock using both profiles. Confirm protection stays on, schedules stay Always on, all normal platform controls and pauses are unavailable, and TikTok's focus screen has no pause button.
- Start Ultimate removal: select **Remove Ultimate Lock**, enter `REMOVE ULTIMATE`, and confirm a reason shorter than 20 characters cannot start the release.
- Enter a longer private reason and start. Confirm the action, phrase, and reason become fixed, the reason is absent from Chrome storage, and Confirm stays disabled.
- Complete each checkpoint at 45, 30, and 15 seconds remaining. Confirm the countdown pauses at every checkpoint and removal becomes available only after all three and at least 60 focused seconds.
- Switch tabs, minimize/defocus, close, or reload Settings before confirming removal. It must reset the timer and all checkpoints.
- Complete the ritual and confirm removal; normal controls should return. Verify the wording does not imply it can prevent Chrome from disabling or uninstalling the extension.

## Appearance

- Confirm a fresh install opens ReelLess in the Dark theme without gradients or glass effects.
- Switch Settings between Dark, Light, and Use Chrome setting. Confirm the popup, Settings, onboarding, and TikTok focus screen follow the selected appearance.
- With Use Chrome setting selected, change Chrome/system appearance and reopen the popup or focus screen. It should follow the current system preference.

## Permissions and migration

- Deny an Advanced platform request: its mode must remain Off and no extension error should appear.
- Grant an Advanced site, confirm its dynamic guard, disable it, and confirm the access and guard are removed.
- Add a custom domain/path, deny and then grant access, verify block-only behavior, then remove it. A granted entry must also stop in place with its own focus screen, hide its links, and refuse clicks; a bare domain (no path) blocks the whole site.
- Update profiles from earlier schemas and confirm schedule, supported platform selections, custom entries, and Ultimate Lock snapshots are preserved in v11 `settingsV2` (including remembered modes); retired controls must disappear and every platform must default to hidden entry points.

## Release gate

- `npm test`, `npm run validate`, `npm run smoke`, and `npm run build` pass.
- Extension card and service-worker console have no errors.
- Five Store screenshots and permission/privacy copy match the current build.
- No unresolved core-platform bug remains.
- “ReelLess” trademark clearance is complete.

## X focus controls (schema 8)

- Grant X optional access and choose Selected sections. Check each control (Home, Explore page, Notifications, Messages) independently, then together, on x.com and a Twitter hostname. Enabling any control must not collapse the open site row.
- Home blocking must cover `/` and `/home`, show allowed-page shortcuts, and count deliberate attempts. With Explore hiding enabled, the Search shortcut must open a usable search field.
- Explore discovery content and topic tabs should disappear; search suggestions, submitted results, and opened posts must work. Test direct loading, in-app navigation, and Back/Forward.
- Sidebar hiding should remove news, trends, and Who to follow, while preserving search, navigation, Chat, and unrelated modules. Check newly loaded modules and profile/post pages.
- Pause, disable protection, leave the schedule window, or switch X Off: hidden content should return. Resume and verify it disappears again. Confirm Ultimate Lock preserves the choices.
- Check desktop and narrow layouts. Unrecognized modules should stay visible rather than taking useful controls with them.
- Upgrade schema 7 settings with Home/Explore/Video choices, including a locked snapshot. Home survives; selected Explore becomes hiding; Video disappears; X short-form mode becomes Off.
- Run `npm run test:x-browser` for offline browser fixtures. Live signed-in X verification is still required before publishing because X can change its markup.

## Reddit focus controls (schema 9)

- Grant Reddit optional access and choose Selected sections. Check Home, broad discovery, Chat, Notifications, and sidebar hiding independently and together on `reddit.com`, `www.reddit.com`, and `old.reddit.com` where supported.
- Confirm `/`, `?feed=home`, Popular, News, Explore, and legacy All routes follow their controls. Communities, posts, comments, search, notifications, Chat, profile, and Saved must remain accessible.
- Sidebar hiding should remove Games and promotional discovery groups without hiding Recent communities, Custom Feeds, navigation, search, or post content. Check dynamically loaded navigation.
- Verify allowed-page shortcuts, blocked-attempt counts, pause/resume, schedules, Off, settings updates, and Ultimate Lock.
- Upgrade schema 8 settings containing Popular, All, or Short video selections, including a locked snapshot. Popular/All migrate to discovery; short-form-only mode becomes Off.

## Remaining optional sites (schema 10)

- Snapchat: Spotlight blocks on `snapchat.com` and `web.snapchat.com`; Stories and Chat remain available.
- Twitch: test Home, Browse, Clips, and channel Videos (VODs) separately, including a direct `clips.twitch.tv` URL. Following, channels, search, and Creator Dashboard remain available.
- Pinterest: Home, Explore, and Search block separately. Boards, profiles, and individual Pins remain available.
- LinkedIn: Feed, Videos, and Notifications block separately. Jobs, messaging, profiles, and search remain available.
- Threads: Home and Activity block separately on `threads.com` and `threads.net`. Search, profiles, posts, saved items, and custom-feed routes remain available.
- YouTube: Home feed and Trending block separately from Shorts. Instagram: Home feed blocks separately. Facebook: Home feed and Groups block separately. TikTok: LIVE blocks separately from the feed.
- For each site, verify blocked-page shortcuts, entry-point hiding/keeping, direct and in-app navigation, history, pause/resume, schedules, Off, Block all, settings updates, and Ultimate Lock.
- Upgrade schema 9 selected and short-form settings. Supported choices survive; retired Stories, Videos, Pins, Jobs, Search, and Media choices disappear without enabling unrelated restrictions.
