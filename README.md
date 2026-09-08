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

- YouTube Shorts entry points are hidden; `/shorts/{id}` opens as `/watch?v={id}`.
- Each site can instead keep Shorts, Reels, or feed links visible while still stopping them from opening. Choose **Hidden** or **Visible, can't be opened** on the core card or in Advanced.
- Instagram and Facebook Reels entry points are hidden; direct Reel visits return to the normal feed.
- Instagram Direct and Facebook Messenger conversations are never modified. A Reel shared in a conversation refuses to open, but nothing in the thread is hidden.
- TikTok feed/video surfaces show a calm local focus screen. Selected utility sections can be allowed in Advanced settings.
- Only deliberate blocked navigation or clicks increase the local today/all-time count. Hidden cards do not.
- Schedules, seven additional platforms, full-site blocking, section controls, and custom domains live under Advanced.

The four core sites are bundled. Advanced sites and custom domains request exact optional access only from a user action. Custom destinations use block-only dynamic rules; core redirects are handled by site-specific navigation guards.

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
