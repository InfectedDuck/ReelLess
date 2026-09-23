# Block Shorts & Reels: YouTube, Instagram, TikTok, Facebook — ReelLess

ReelLess removes YouTube Shorts, Instagram and Facebook Reels, and TikTok distractions while keeping useful pages available. It is a free, open-source, account-free, ad-free, and telemetry-free Manifest V3 Chrome extension.

## Launch locally in Google Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder, not the ZIP:

   `C:\Users\ASUS\Desktop\projects\reels_blocker`

5. Pin ReelLess from Chrome’s Extensions menu.
6. Test YouTube Shorts, Instagram Reels, Facebook Reels, and TikTok.
7. After code changes, click **Reload** on the extension card and refresh existing social tabs.
8. Use the extension card’s service-worker link to check for errors.

## Product behavior

- X / Twitter offers **Block Home feed** (For You and Following), **Block Explore page**, **Block Notifications**, **Block Messages**, **Block Communities**, **Block Grok**, **Hide Explore recommendations** (search remains available), and **Hide sidebar distractions** (news, trends, and Who to follow). These optional controls are off by default. Profiles, posts, and bookmarks remain available unless you select Block all. X video posts are not blocked.
- Reddit offers **Block Home feed**, **Block Popular, News, and Explore**, **Block Chat**, **Block Notifications**, **Block Message inbox**, and **Hide sidebar distractions** for Reddit Games and promotional discovery links. Communities, posts, comments, search, and saved posts remain available unless you select Block all.
- The remaining Advanced sites use current web boundaries: Snapchat Spotlight with opt-in Stories; Twitch Home recommendations, Browse, Clips, channel Videos (VODs), and Drops; Pinterest Home, Explore, and Search; LinkedIn Feed, Videos, Notifications, Messaging, and My Network; and Threads Home and Activity. Utility pages such as Jobs, search, profiles, messages, saved content, boards, and individual posts remain available. Instagram, Facebook, and Snapchat Stories are opt-in under Selected sections and stay allowed by default. Core sites also offer extra tabs: YouTube Home feed, Trending, Subscriptions, and Gaming; Instagram Home feed; Facebook Home feed, Groups, and Events; and TikTok LIVE.
- YouTube Shorts entry points are hidden; opening a Short or visiting `/shorts/{id}` directly shows the focus screen instead of playing anything.
- Each site can instead keep Shorts, Reels, or feed links visible while still stopping them from opening. Choose **Hidden** or **Visible, can't be opened** on the core card or in Advanced.
- Instagram Reels entry points are hidden; direct Reel visits return to the normal feed.
- Facebook Reels, feed videos, Live videos, and fb.watch shares are hidden; opening a video stops in place with the focus screen instead of playing it. Direct Reel visits return to the feed. To allow videos again, use Advanced → Facebook → Selected sections and uncheck Watch.
- Instagram Direct and Facebook Messenger conversations are never modified. A Reel shared in a conversation refuses to open, but nothing in the thread is hidden.
- TikTok feed/video surfaces show a calm local focus screen. LIVE, Messages, Upload, and Settings stay available by default; use Advanced → TikTok → Selected sections for narrower or wider control.
- Only deliberate blocked navigation or clicks increase the local today/all-time count. Hidden cards do not.
- Schedules, seven additional platforms, full-site blocking, section controls, and custom domains live under Advanced.

The four core sites are bundled. Advanced sites and custom domains request exact optional access only from a user action. Custom boundaries use block-only dynamic rules for navigation plus the same in-page guard as the platforms: their pages stop in place with a focus screen, their links are hidden, and opening them is refused; core redirects are handled by site-specific navigation guards.

### Ultimate Lock

Settings includes an opt-in **Ultimate Lock** for someone who wants extra friction against disabling protection. Choose either **Block all core short-form content** or **Keep my current platform choices**, type `I ACCEPT THE LOCK`, and confirm. It forces protection on, keeps the schedule always active, and removes the extension's normal pause and settings controls.

To remove it, select **Remove Ultimate Lock**, type `REMOVE ULTIMATE`, write a private reason, and complete three timed check-ins during at least one focused minute. The reason is never saved. Leaving, reloading, minimizing, or defocusing Settings resets the entire release ritual. This is deliberate in-extension friction only: Chrome or a device administrator can still disable, uninstall, or clear an extension.

## Development checks

Install the test dependencies once:

```powershell
npm install
npx playwright-core install chromium
```

Then run:

```powershell
npm test
npm run validate
npm run smoke
npm run build
```

The smoke suite uses a temporary Chrome for Testing profile because current branded Chrome builds ignore command-line unpacked-extension loading. Manual Chrome installation still uses `chrome://extensions` as described above.

The verified Web Store package is created at `dist/reels-blocker.zip`, with `manifest.json` at the ZIP root.

## Release

- Store copy: [STORE_LISTING.md](STORE_LISTING.md)
- Privacy policy: [PRIVACY.md](PRIVACY.md)
- 90-day launch checklist: [LAUNCH_PLAN.md](LAUNCH_PLAN.md)
- Public site: `docs/` (ready for GitHub Pages)

Before public release, complete a trademark check for “ReelLess,” manually test authenticated and logged-out platform layouts, create the Chrome Web Store developer account, and upload the verified ZIP with deferred publishing.

ReelLess is independent and is not affiliated with YouTube, Instagram, Facebook, TikTok, or their owners. Platform names and trademarks belong to their respective owners.
