# ReelLess v2.2.1 Security Review

Review date: September 1, 2026

## Result

No known high-severity or release-blocking security issue remains after the checks below. This is a focused source and packaging review, not a formal third-party penetration test.

## Checks completed

- `npm audit --audit-level=high`: 0 known dependency vulnerabilities.
- Manifest V3 is used and all executable code is bundled locally.
- Runtime files contain no `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `eval`, or `new Function` use.
- No environment files, private keys, credentials, API keys, or client secrets are included.
- Required API permissions are limited to `storage`, `alarms`, `scripting`, and `declarativeNetRequestWithHostAccess`.
- Core content scripts are limited to HTTPS pages on YouTube, Instagram, Facebook, and TikTok.
- Messenger access was removed because Direct-message behavior is no longer part of ReelLess.
- Advanced sites request their configured HTTPS origins only after a user enables them.
- Arbitrary custom domains use the required `https://*/*` optional declaration, but ReelLess requests and retains only the specific HTTPS host selected by the user.
- Custom-domain text is rendered with DOM `textContent` instead of HTML interpolation.
- Service-worker messages reject unknown senders and invalid pause durations.
- Ultimate Lock reflection text remains in page memory only and is never written to Chrome storage.
- The release ZIP uses an explicit file allowlist, places `manifest.json` at the ZIP root, and excludes development scripts, tests, documentation, Store assets, and `node_modules`.

## Security boundaries

- ReelLess inspects supported-site URLs and selected local page elements because that is required to identify short-form entry points.
- ReelLess makes no extension-originated external network requests and includes no analytics, advertising, accounts, or remote code.
- Chrome always retains control: a user or device administrator can disable, uninstall, or clear the extension, including Ultimate Lock.
- Social-platform markup changes can affect blocking reliability. Complete the live manual test matrix before every public release.

## Maintainer actions

- Enable two-factor authentication on the Google publisher and GitHub accounts.
- Protect recovery codes and limit publisher roles to trusted people.
- Re-run the test, audit, validation, smoke, and build commands before every upload.
- Use GitHub private security advisories for vulnerability reports.
