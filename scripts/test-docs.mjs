import fs from "node:fs";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const html = fs.readFileSync(new URL("../docs/index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../docs/styles.css", import.meta.url), "utf8");
const optionsCss = fs.readFileSync(new URL("../options.css", import.meta.url), "utf8");
const optionsHtml = fs.readFileSync(new URL("../options.html", import.meta.url), "utf8");
const popupHtml = fs.readFileSync(new URL("../popup.html", import.meta.url), "utf8");
const onboardingHtml = fs.readFileSync(new URL("../onboarding.html", import.meta.url), "utf8");
const runtimeSources = ["shared.js", "site_guard.js", "site_guard.css", "options.js", "options.html"].map((file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8")).join("\n");
const document = new JSDOM(html).window.document;

assert.ok(document.querySelector(".hero .preview"), "The hero should keep a product preview");
assert.equal(document.querySelectorAll("#how .journey-track article").length, 3, "The guided walkthrough should have three concise steps");
assert.deepEqual(
  Array.from(document.querySelectorAll(".core-chips span"), (item) => item.textContent.trim()),
  ["YouTube Shorts", "Instagram Reels", "Facebook Reels", "TikTok"],
  "The four core platforms should be grouped first"
);
assert.equal(document.querySelectorAll(".optional-group .platform-chips span").length, 7, "Every optional platform should be grouped in the Advanced section");
assert.ok(document.querySelector("#install .principles"), "Privacy and permission copy should be combined with installation");
assert.ok(document.querySelector("#install .install-box"), "The closing action should include local install steps");
assert.match(css, /\.journey-track/, "Styles should include the guided walkthrough");
assert.match(css, /\.platform-board/, "Styles should include the platform matrix");
assert.match(css, /\.closing/, "Styles should include the combined closing section");
assert.match(optionsCss, /\.advanced-summary-action/, "Settings styles should include the Advanced disclosure action");
const optionsDocument = new JSDOM(optionsHtml).window.document;
assert.ok(optionsDocument.querySelector("details.advanced"), "Settings should retain a progressive Advanced workspace");
assert.equal(optionsDocument.querySelector("#unlockReason")?.getAttribute("minlength"), "20", "Ultimate release should require a private reflection");
assert.equal(optionsDocument.querySelectorAll("#unlockProgress span").length, 3, "Ultimate release should show three active checkpoints");
assert.ok(optionsDocument.querySelector("#unlockCheckpoint"), "Ultimate release should require active timed check-ins");
assert.ok(new JSDOM(popupHtml).window.document.querySelector(".status-card"), "The popup should lead with a clear protection state");
assert.equal(new JSDOM(onboardingHtml).window.document.querySelectorAll(".steps article").length, 3, "Onboarding should be a three-step first-run flow");
assert.doesNotMatch(runtimeSources, /direct_videos|shouldBlockDirectVideos|reelless-direct-blocked/i, "Retired Direct-message behavior must not appear in runtime sources");
assert.doesNotMatch(runtimeSources, /item\.innerHTML\s*=/, "Custom user entries must be rendered with safe DOM text assignment");

console.log("Landing-page structure and responsive component styles passed.");
