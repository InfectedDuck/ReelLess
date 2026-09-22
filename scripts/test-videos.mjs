import fs from "node:fs";
import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import R from "../shared.js";

// Answers one question: are videos blocked or not?
// Part 1 checks every video route decision; part 2 checks the guard really stops
// feed videos, dialogs, thumbnails, and direct visits in a live DOM.
const defaults = R.getDefaultSettings();
const at = (minutesAhead) => new Date(Date.now() + minutesAhead * 60000);

// Platform video routes are blocked by default and stay allowed once deselected.
const watchOff = R.normalizeSettings({ platforms: { facebook: { mode: "selected", sections: { reels: true, watch: false, marketplace: false } } } });
const videoRoutes = [
  ["https://www.facebook.com/watch/?v=1", "watch", true],
  ["https://www.facebook.com/video.php?v=1", "watch", true],
  ["https://www.facebook.com/share/v/AbC123/", "watch", true],
  ["https://www.facebook.com/nasa/videos/", "watch", true],
  ["https://www.facebook.com/live/", "watch", true],
  ["https://fb.watch/AbC123/", "watch", true],
  ["https://www.facebook.com/reel/abc", "reels", true],
  ["https://www.facebook.com/share/r/AbC123/", "reels", true],
  ["https://www.youtube.com/shorts/abc123", "shorts", true],
  ["https://www.instagram.com/reel/xyz", "reels", true],
  ["https://www.tiktok.com/", "feed", true]
];
for (const [url, sectionId, expected] of videoRoutes) {
  const decision = R.shouldBlockUrl(defaults, url);
  assert.equal(decision.blocked, expected, `${url} blocked by default`);
  assert.equal(decision.section.id, sectionId, `${url} resolves to ${sectionId}`);
}
const ordinaryVideos = [
  "https://www.youtube.com/watch?v=abc",
  "https://www.instagram.com/p/photo123/",
  "https://www.tiktok.com/messages"
];
for (const url of ordinaryVideos) {
  assert.equal(R.shouldBlockUrl(defaults, url).blocked, false, `${url} stays available`);
}
for (const [url] of videoRoutes.filter(([, sectionId]) => sectionId === "watch")) {
  assert.equal(R.shouldBlockUrl(watchOff, url).blocked, false, `${url} plays once Watch is deselected`);
}

const sharedSource = fs.readFileSync(new URL("../shared.js", import.meta.url), "utf8");
const guardSource = fs.readFileSync(new URL("../site_guard.js", import.meta.url), "utf8");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fixture({ url, html, settings }) {
  const messages = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", () => {});
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  dom.window.HTMLMediaElement.prototype.pause = function pause() {
    Object.defineProperty(this, "paused", { value: true, configurable: true });
  };
  dom.window.chrome = {
    storage: { local: { get: async () => ({ settingsV2: settings }) }, onChanged: { addListener() {} } },
    runtime: { sendMessage: async (message) => { messages.push(message); return { ok: true }; }, openOptionsPage() {} }
  };
  dom.window.eval(sharedSource);
  dom.window.eval(guardSource);
  await wait(220);
  return { dom, document: dom.window.document, messages };
}

const blocks = (messages) => messages.filter((m) => m.type === "recordBlockAttempt").length;

// A feed video is hidden with its post, disarmed, and never playable.
let result = await fixture({
  url: "https://www.facebook.com/",
  settings: defaults,
  html: `<main id="main"><div role="feed" id="feed"><div aria-posinset="1" id="video-post"><video id="clip" autoplay></video></div><article id="photo-post"><a href="/photo/1">Photo</a></article></div></main>`
});
assert.equal(result.document.getElementById("video-post").dataset.reellessHidden, "true", "feed video post is hidden");
const clip = result.document.getElementById("clip");
assert.equal(clip.paused, true, "feed video is paused");
assert.equal(clip.preload, "none", "feed video cannot preload");
assert.equal(clip.hasAttribute("autoplay"), false, "feed video cannot autoplay");
assert.equal(result.document.getElementById("photo-post").hasAttribute("data-reelless-hidden"), false, "photo posts stay");
assert.equal(result.document.getElementById("main").hasAttribute("data-reelless-hidden"), false);
assert.equal(blocks(result.messages), 0, "hiding videos counts nothing");
result.dom.window.close();

// A direct Watch visit stops in place with the video screen, counted once.
result = await fixture({
  url: "https://www.facebook.com/watch/?v=1",
  settings: defaults,
  html: "<main><h1>Watch</h1></main>"
});
assert.ok(result.document.getElementById("reelless-focus-screen"), "direct Watch visit is stopped");
assert.match(result.document.getElementById("reelless-focus-title").textContent, /video/i);
assert.equal(blocks(result.messages), 1);
result.dom.window.close();

// A theater dialog playing without an address change is stopped, counted once.
result = await fixture({
  url: "https://www.facebook.com/",
  settings: defaults,
  html: `<main id="main"><div role="feed" id="feed"><div aria-posinset="1" id="post"><video id="clip"></video></div></div><div role="dialog" id="theater"><video id="theater-video"></video></div></main>`
});
await wait(300);
assert.ok(result.document.getElementById("reelless-focus-screen"), "theater video is stopped");
assert.equal(result.document.getElementById("theater-video").paused, true, "theater video is paused");
assert.equal(blocks(result.messages), 1, "a theater open counts once");
result.dom.window.close();

// Clicking a thumbnail cannot open the video.
result = await fixture({
  url: "https://www.facebook.com/",
  settings: R.normalizeSettings({ platforms: { facebook: { mode: "shortform", entryPoints: "keep" } } }),
  html: `<main id="main"><div id="feed"><div class="post" id="thumb-post"><div role="button" id="thumb"><video id="thumb-video"></video></div></div></div></main>`
});
assert.equal(
  result.document.getElementById("thumb").dispatchEvent(new result.dom.window.MouseEvent("click", { bubbles: true, cancelable: true })),
  false,
  "thumbnail click is refused"
);
assert.ok(result.document.getElementById("reelless-focus-screen"), "thumbnail click shows the video screen");
assert.equal(blocks(result.messages), 1);
result.dom.window.close();

// Deselecting Watch leaves videos playable.
result = await fixture({
  url: "https://www.facebook.com/",
  settings: watchOff,
  html: `<main id="main"><div role="feed" id="feed"><div aria-posinset="1" id="video-post"><video id="clip"></video></div></div></main>`
});
assert.equal(result.document.getElementById("video-post").hasAttribute("data-reelless-hidden"), false, "deselected Watch leaves videos alone");
assert.equal(result.document.getElementById("reelless-focus-screen"), null);
assert.equal(blocks(result.messages), 0);
result.dom.window.close();

// Pausing releases videos together with everything else.
const paused = R.normalizeSettings({ pausedUntil: at(30).toISOString() });
assert.equal(R.shouldBlockUrl(paused, "https://www.facebook.com/watch/?v=1").blocked, false);
assert.equal(R.shouldBlockCustomUrl(paused, "https://example.com/reels/123").blocked, false);

console.log("Video blocking tests passed: routes, feed videos, dialogs, thumbnails, and opt-outs.");
