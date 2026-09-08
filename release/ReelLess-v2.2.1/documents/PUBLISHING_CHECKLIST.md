# ReelLess v2.2.1 Publishing Checklist

## Upload

- Upload only `UPLOAD-THIS-reels-blocker-v2.2.1.zip` from the submission folder.
- Do not ZIP or upload the entire submission folder; the documents and Store images are dashboard materials, not extension runtime files.
- Confirm the dashboard reads version `2.2.1` after upload.

## Store listing

- Copy the summary, description, permission explanations, support URL, and non-affiliation notice from `documents/STORE_LISTING.md`.
- Upload the five numbered 1280×800 screenshots in order.
- Upload the 440×280 promo tile. The 1400×560 marquee tile is optional.
- Select the most accurate productivity category and English as the initial language.
- Avoid claims about guaranteed productivity, rankings, user counts, or platform endorsement.

## Privacy

- Use the public GitHub Pages privacy-policy URL once it is live.
- Declare the extension's single purpose exactly as written in `documents/STORE_LISTING.md`.
- Disclose local processing of supported-site URLs/page elements and local storage of settings and aggregate counters.
- State that ReelLess does not sell or transmit user data and does not use data for advertising, credit, or unrelated purposes.
- Explain every requested API and site-access permission using the supplied permission copy.

## Distribution and review

- Choose Public only after completing `documents/MANUAL_TESTING.md`; use trusted testers first if any live layout is uncertain.
- No account or test credentials are required for the extension itself.
- Use deferred publishing if you want to coordinate the Store listing and public website.
- After submission, monitor the developer email for reviewer questions.

## Final release gate

- `npm run test`, `npm run validate`, `npm run smoke`, `npm audit --audit-level=high`, and `npm run build` pass.
- YouTube, Instagram, Facebook, and TikTok pass logged-in and logged-out manual checks.
- Optional permission denial fails safely.
- The extension card and service-worker console contain no errors.
- Privacy and Store copy match version `2.2.1` behavior.
