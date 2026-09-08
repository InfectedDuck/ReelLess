# ReelLess 90-Day Organic Launch

## Success gate

- 300 Chrome Web Store users by day 90
- 10 or more genuine reviews and a 4.5+ rating
- no unresolved core-platform blocking bug
- no unresolved extension-card or service-worker error

Track only Web Store users, installs/uninstalls, ratings, reviews, and support reports. Do not add in-extension analytics. Firefox and Edge listings ship from the same release but are tracked separately; the gate above is the Chrome Web Store alone.

## Days 1–14 — private reliability test

- Recruit 10–20 students, remote workers, and digital-minimalism testers.
- Cover logged-in/logged-out layouts, mobile hostnames, direct links, back/forward, multiple tabs, updates, and restricted site access.
- Include a long Instagram feed scroll and a Reel shared in a Direct conversation, the two 2.3.0 fixes most likely to regress with a site change.
- Record reports with browser version, platform, URL shape (not a private URL), login state, expected behavior, and screenshot.
- Fix every core failure before submission.

## Days 15–30 — launch to 75 users

- Publish the Web Store listing, GitHub `v2.3.0` release, and GitHub Pages privacy/support site.
- Submit `dist/reelless-firefox.zip` to addons.mozilla.org and `dist/reels-blocker.zip` to Microsoft Edge Add-ons under the same version, once the Chrome listing is approved.
- Publish one accurate 30-second before/after demo using the real extension.
- Use deferred Web Store publishing so the listing, site, and release go live together.

## Days 31–60 — improve to 175 users

- Group feedback by reliability, confusing copy, and requested utility sections.
- Ship the highest-retention update; avoid adding unrelated platform count.
- Contact 20 small productivity or newsletter creators with a concise, personalized demo.
- Post only in communities that permit self-promotion and lead with a useful workflow.

## Days 61–90 — retain to 300 users

- Ship a second reliability/localization update.
- Add Spanish and Portuguese only after the English core behavior is stable.
- Refresh screenshots from common support questions with `npm run screenshots`, which captures the live sites.
- Review uninstall changes, ratings, reviews, and unresolved support reports weekly.

The in-product review prompt appears neutrally after seven days on which a guarded page loaded under active protection. It no longer waits for blocked attempts, so it reaches the people the extension simply worked for. It offers an honest review or feedback, is permanently dismissible, and never filters by sentiment.

## Positioning benchmark

As of August 31, 2026, use [FocusTube](https://chromewebstore.google.com/detail/focustube-distraction-blo/ppdjgkniggbikifojmkindmbhppmoell) (314 users and Featured) and [Marketplace Focus](https://chromewebstore.google.com/detail/marketplace-focus-%E2%80%94-faceb/lchgjnkonkmccfpjjmnkbegibdgjocog) (231 users) as focused-utility benchmarks. Compete on a clear four-platform promise, dependable blocking, useful-page preservation, restrained permissions, and strong onboarding—not maximum platform count.

The Store listing leads with what people search for: "Block Shorts & Reels: YouTube, Instagram, TikTok, Facebook — ReelLess". ReelLess remains the in-product brand in the popup, icon, and toolbar tooltip, so the name is the search hook and the product stays recognisable once installed.
