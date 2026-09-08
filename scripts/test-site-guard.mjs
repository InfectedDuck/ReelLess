import fs from "node:fs";
import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";

const sharedSource = fs.readFileSync(new URL("../shared.js", import.meta.url), "utf8");
const guardSource = fs.readFileSync(new URL("../site_guard.js", import.meta.url), "utf8");
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
// jsdom cannot navigate, so redirects surface as "not implemented" reports; every other error is a failure.
const unexpectedErrors = [];

// jsdom has no CSS global and its selector engine rejects :has(), so every fixture takes the script
// path by default. `cssHas` pretends the browser supports :has(), which is enough to prove the
// script stands down on covered platforms; whether the rules themselves match is checked in real
// Chrome by scripts/smoke-extension.mjs.
async function fixture({ url, html, settings, cssHas = false }) {
  const messages = [];
  const settingsListeners = [];
  const observers = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => {
    if (!/not implemented: navigation/i.test(error.message)) unexpectedErrors.push(error);
  });
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  dom.window.HTMLMediaElement.prototype.pause = () => {};
  if (cssHas) dom.window.CSS = { supports: (query) => query === "selector(:has(a))" };
  const NativeObserver = dom.window.MutationObserver;
  dom.window.MutationObserver = class extends NativeObserver {
    constructor(callback) { super(callback); observers.push(this); }
  };
  dom.window.chrome = {
    storage: {
      local: { get: async () => ({ settingsV2: settings }) },
      onChanged: { addListener(listener) { settingsListeners.push(listener); } }
    },
    runtime: {
      sendMessage: async (message) => { messages.push(message); return { ok: true }; },
      openOptionsPage() {}
    }
  };
  dom.window.eval(sharedSource);
  dom.window.eval(guardSource);
  await wait(180);
  const changeSettings = async (next) => {
    settingsListeners.forEach((listener) => listener({ settingsV2: { newValue: next } }, "local"));
    await wait(180);
  };
  // The guard's own observer, if it made one. The test fixtures observe too, so count only the
  // observers created before the fixture handed control back.
  const guardObservers = observers.length;
  const mode = () => dom.window.document.documentElement.dataset.reellessMode;
  return { dom, document: dom.window.document, messages, changeSettings, guardObservers, mode };
}

function withEntryPoints(base, platformId, entryPoints) {
  const next = JSON.parse(JSON.stringify(base));
  next.platforms[platformId].entryPoints = entryPoints;
  return next;
}

function withSections(base, platformId, sections) {
  const next = JSON.parse(JSON.stringify(base));
  next.platforms[platformId].mode = "selected";
  next.platforms[platformId].sections = sections;
  return next;
}

// jsdom lays nothing out: every rect is zero and the window is 1024x768. Give named elements a
// vertical position in viewport coordinates so the reveal guard has something to read.
function layOut(document, boxes) {
  for (const [id, [top, bottom]] of Object.entries(boxes)) {
    document.getElementById(id).getBoundingClientRect = () => ({ top, bottom, left: 0, right: 600, width: 600, height: bottom - top, x: 0, y: top });
  }
}

// Forces the next guard pass without waiting on its one-second sweep.
async function nextPass(dom) {
  dom.window.dispatchEvent(new dom.window.Event("popstate"));
  await wait(200);
}

function observeHiddenFlips(dom, node) {
  const flips = [];
  new dom.window.MutationObserver((records) => flips.push(...records)).observe(node, { attributes: true, attributeFilter: ["data-reelless-hidden"] });
  return flips;
}

const defaults = (await import("../shared.js")).default.getDefaultSettings();
const shared = (await import("../shared.js")).default;

// YouTube: known Shorts shelf is hidden while the surrounding main layout and normal video remain.
let result = await fixture({
  url: "https://www.youtube.com/watch?v=useful",
  settings: defaults,
  html: `<main id="main"><ytd-reel-shelf-renderer id="shorts"><a href="/shorts/abc">Shorts</a></ytd-reel-shelf-renderer><ytd-rich-item-renderer id="normal"><a href="/watch?v=lesson">Lesson</a></ytd-rich-item-renderer></main>`
});
assert.equal(result.document.getElementById("shorts").dataset.reellessHidden, "true");
assert.equal(result.document.getElementById("normal").hasAttribute("data-reelless-hidden"), false);
assert.equal(result.document.getElementById("main").hasAttribute("data-reelless-hidden"), false);
result.dom.window.close();

// Direct-message pages are intentionally outside ReelLess protection and remain untouched.
result = await fixture({
  url: "https://www.instagram.com/direct/t/friend",
  settings: defaults,
  html: `<main id="main"><article><button id="play-video" aria-label="Play video">Play</button><video id="friend-video"></video><p>Friend message</p></article></main>`
});
const playControl = result.document.getElementById("play-video");
assert.equal(playControl.dispatchEvent(new result.dom.window.Event("pointerdown", { bubbles: true, cancelable: true })), true, "Direct video controls must not be intercepted");
assert.equal(result.document.getElementById("friend-video").hasAttribute("data-reelless-direct-video"), false);
assert.equal(result.document.getElementById("main").hasAttribute("data-reelless-hidden"), false);
assert.equal(result.document.getElementById("reelless-direct-blocked-notice"), null);
assert.equal(result.messages.filter((message) => message.type === "recordBlockAttempt").length, 0);
assert.equal(result.mode(), "off", "the stylesheet gate must be released on a conversation");
result.dom.window.close();

// A Reel link inside a Direct thread is left exactly as it is, on the script path (no :has()) and
// on the stylesheet path alike. Opening it is still refused, and the refusal is counted.
for (const cssHas of [false, true]) {
  result = await fixture({
    url: "https://www.instagram.com/direct/t/friend/",
    settings: defaults,
    cssHas,
    html: `<main id="main"><div class="msg" id="m1">Hey</div><div class="msg" id="m2"><article id="shared-card"><a id="shared-reel" href="/reel/fromfriend/">Watch this</a></article></div><div class="msg" id="m3"><a id="profile-link" href="/friend/">friend</a></div></main>`
  });
  assert.equal(result.mode(), "off", `cssHas=${cssHas}: a conversation must stamp off so the stylesheet hides nothing`);
  assert.equal(result.document.querySelectorAll("[data-reelless-hidden]").length, 0, `cssHas=${cssHas}: nothing in a conversation may be hidden`);
  assert.equal(result.document.getElementById("shared-card").hasAttribute("data-reelless-hidden"), false);
  assert.equal(result.document.getElementById("shared-reel").hasAttribute("data-reelless-hidden"), false);
  assert.equal(result.guardObservers, 0, `cssHas=${cssHas}: a conversation is not watched`);
  assert.equal(
    result.document.getElementById("shared-reel").dispatchEvent(new result.dom.window.MouseEvent("click", { bubbles: true, cancelable: true })),
    false,
    `cssHas=${cssHas}: a Reel opened from a conversation must still be refused`
  );
  assert.equal(result.messages.filter((message) => message.type === "recordBlockAttempt").length, 1);
  result.dom.window.close();
}

// Messenger threads on facebook.com get the same treatment.
for (const cssHas of [false, true]) {
  result = await fixture({
    url: "https://www.facebook.com/messages/t/12345/",
    settings: defaults,
    cssHas,
    html: `<main id="main"><div role="article" id="msg"><a id="shared-reel" href="/reel/999/">Reel</a></div><ul id="nav"><li id="nav-reels"><a href="/reel/?s=ifu">Reels</a></li></ul></main>`
  });
  assert.equal(result.mode(), "off", `cssHas=${cssHas}: Messenger must stamp off`);
  assert.equal(result.document.querySelectorAll("[data-reelless-hidden]").length, 0, `cssHas=${cssHas}: nothing on a Messenger page may be hidden`);
  assert.equal(result.guardObservers, 0);
  assert.equal(
    result.document.getElementById("shared-reel").dispatchEvent(new result.dom.window.MouseEvent("click", { bubbles: true, cancelable: true })),
    false,
    `cssHas=${cssHas}: a Reel opened from Messenger must still be refused`
  );
  result.dom.window.close();
}

// Messenger conversations are likewise not modified or counted.
result = await fixture({
  url: "https://www.messenger.com/t/friend",
  settings: defaults,
  html: `<main id="main"><div role="article"><video id="friend-video"></video><p>Friend message</p></div></main>`
});
assert.equal(result.document.getElementById("friend-video").hasAttribute("data-reelless-direct-video"), false);
assert.equal(result.document.getElementById("main").hasAttribute("data-reelless-hidden"), false);
assert.equal(result.messages.filter((message) => message.type === "recordBlockAttempt").length, 0);
result.dom.window.close();

// Instagram: changed markup still hides only the small Reel card, never role=main.
result = await fixture({
  url: "https://www.instagram.com/",
  settings: defaults,
  html: `<main role="main" id="main"><div role="list"><div role="listitem" id="reel-card"><a href="/reel/xyz">Reel</a></div><div role="listitem" id="photo-card"><a href="/p/photo">Photo</a></div></div></main>`
});
assert.equal(result.document.getElementById("reel-card").dataset.reellessHidden, "true");
assert.equal(result.document.getElementById("photo-card").hasAttribute("data-reelless-hidden"), false);
assert.equal(result.document.getElementById("main").hasAttribute("data-reelless-hidden"), false);
result.document.querySelector("#photo-card a").setAttribute("href", "/reel/changed-in-place");
await wait(180);
assert.equal(result.document.getElementById("photo-card").dataset.reellessHidden, "true");
result.dom.window.close();

// Ultimate Lock removes the focus screen's pause action.
result = await fixture({
  url: "https://www.tiktok.com/",
  settings: (await import("../shared.js")).default.createUltimateSettings(defaults, "block_shortform"),
  html: `<main><h1>TikTok fixture</h1></main>`
});
assert.ok(result.document.getElementById("reelless-focus-screen"));
assert.equal(result.document.querySelector('[data-action="pause"]'), null);
result.dom.window.close();

// Facebook: a dynamically inserted SPA Reel entry is found by the debounced observer.
result = await fixture({
  url: "https://www.facebook.com/",
  settings: defaults,
  html: `<main id="main"><a href="/friends">Friends</a><section id="spa"></section></main>`
});
result.document.getElementById("spa").innerHTML = `<article id="late-reel"><a href="/reels/123">Late Reel</a></article>`;
await wait(180);
assert.equal(result.document.getElementById("late-reel").dataset.reellessHidden, "true");
assert.equal(result.document.getElementById("main").hasAttribute("data-reelless-hidden"), false);
result.dom.window.close();

// TikTok: utility sections remain available while feed links are removed in selected mode.
const tiktokUtility = JSON.parse(JSON.stringify(defaults));
tiktokUtility.platforms.tiktok = {
  mode: "selected",
  sections: { feed: true, videos: true, messages: false, upload: false, settings: false }
};
result = await fixture({
  url: "https://www.tiktok.com/messages",
  settings: tiktokUtility,
  html: `<main id="main"><nav><a id="feed-link" href="/foryou">For You</a><a id="messages-link" href="/messages">Messages</a></nav></main>`
});
assert.equal(result.document.getElementById("feed-link").dataset.reellessHidden, "true");
assert.equal(result.document.getElementById("messages-link").hasAttribute("data-reelless-hidden"), false);
assert.equal(result.document.getElementById("reelless-focus-screen"), null);
result.dom.window.close();

// Default TikTok navigation uses the calm in-page focus screen and counts one deliberate attempt.
result = await fixture({
  url: "https://www.tiktok.com/",
  settings: defaults,
  html: `<main><h1>TikTok fixture</h1></main>`
});
assert.ok(result.document.getElementById("reelless-focus-screen"));
assert.equal(result.messages.filter((message) => message.type === "recordBlockAttempt").length, 1);
result.dom.window.close();

// Every optional platform is checked offline against its configured short-form route. This
// proves both the entry-point guard and direct-navigation focus screen without using accounts.
const advancedFixtures = [
  { id: "x", home: "https://x.com/home", short: "https://x.com/video/fixture" },
  { id: "reddit", home: "https://www.reddit.com/", short: "https://www.reddit.com/r/videos/fixture" },
  { id: "snapchat", home: "https://www.snapchat.com/", short: "https://www.snapchat.com/spotlight/fixture" },
  { id: "twitch", home: "https://www.twitch.tv/", short: "https://www.twitch.tv/clips/fixture" },
  { id: "pinterest", home: "https://www.pinterest.com/", short: "https://www.pinterest.com/watch/fixture" },
  { id: "linkedin", home: "https://www.linkedin.com/feed/", short: "https://www.linkedin.com/video/fixture" },
  { id: "threads", home: "https://www.threads.net/", short: "https://www.threads.net/media/fixture" }
];

assert.deepEqual(
  advancedFixtures.map((item) => item.id),
  shared.PLATFORMS.filter((platform) => !shared.CORE_PLATFORM_IDS.includes(platform.id)).map((platform) => platform.id),
  "The fixture matrix must cover every optional platform"
);

for (const platformFixture of advancedFixtures) {
  const settings = JSON.parse(JSON.stringify(defaults));
  settings.platforms[platformFixture.id].mode = "shortform";

  result = await fixture({
    url: platformFixture.home,
    settings,
    html: `<main id="main"><article id="blocked-card"><a id="blocked-link" href="${platformFixture.short}">Short video</a></article><article id="useful-card"><a href="/useful">Useful page</a></article></main>`
  });
  const blockedLink = result.document.getElementById("blocked-link");
  assert.equal(result.document.getElementById("blocked-card").dataset.reellessHidden, "true", `${platformFixture.id} should hide its configured short-form entry point`);
  assert.equal(result.document.getElementById("useful-card").hasAttribute("data-reelless-hidden"), false, `${platformFixture.id} should preserve unrelated content`);
  assert.equal(result.document.getElementById("main").hasAttribute("data-reelless-hidden"), false, `${platformFixture.id} must never hide the page main layout`);
  assert.equal(
    blockedLink.dispatchEvent(new result.dom.window.MouseEvent("click", { bubbles: true, cancelable: true })),
    false,
    `${platformFixture.id} should intercept a deliberate short-form click`
  );
  assert.ok(result.document.getElementById("reelless-focus-screen"), `${platformFixture.id} should show the focus screen after an intercepted click`);
  assert.equal(result.messages.filter((message) => message.type === "recordBlockAttempt").length, 1, `${platformFixture.id} should count one deliberate click`);
  result.dom.window.close();

  result = await fixture({
    url: platformFixture.short,
    settings,
    html: "<main id=main><h1>Optional platform fixture</h1></main>"
  });
  assert.ok(result.document.getElementById("reelless-focus-screen"), `${platformFixture.id} should block direct short-form navigation`);
  assert.equal(result.messages.filter((message) => message.type === "recordBlockAttempt").length, 1, `${platformFixture.id} should count one direct navigation`);
  result.dom.window.close();
}

// YouTube home: the whole Shorts shelf (heading included) disappears while neighbouring videos stay,
// and links are never marked on the DOM, so a busy feed pays no attribute churn per link.
const homeShelf = `<main id="main"><ytd-rich-grid-renderer><div id="contents">
  <ytd-rich-item-renderer id="video-1"><a href="/watch?v=one">One</a></ytd-rich-item-renderer>
  <ytd-rich-section-renderer id="shorts-section"><div id="content"><ytd-rich-shelf-renderer is-shorts><div id="rich-shelf-header"><span id="title">Shorts</span></div><div id="shelf-contents"><ytd-rich-item-renderer id="short-1"><ytm-shorts-lockup-view-model-v2><a href="/shorts/s1">S1</a></ytm-shorts-lockup-view-model-v2></ytd-rich-item-renderer><ytd-rich-item-renderer id="short-2"><a href="/shorts/s2">S2</a></ytd-rich-item-renderer></div></ytd-rich-shelf-renderer></div></ytd-rich-section-renderer>
  <ytd-rich-item-renderer id="video-2"><a href="/watch?v=two">Two</a></ytd-rich-item-renderer>
  <ytd-video-renderer id="recycled"><a id="recycled-link" href="/shorts/r1">Recycled</a></ytd-video-renderer>
  <ytd-video-renderer id="replaced"><a href="/shorts/r2">Replaced</a></ytd-video-renderer>
</div></ytd-rich-grid-renderer></main>`;
result = await fixture({ url: "https://www.youtube.com/", settings: defaults, html: homeShelf });
assert.equal(result.document.getElementById("shorts-section").dataset.reellessHidden, "true", "the Shorts shelf should be hidden as one unit");
assert.equal(result.document.getElementById("short-1").hasAttribute("data-reelless-hidden"), false, "cards inside a hidden shelf need no marker of their own");
assert.equal(result.document.getElementById("video-1").hasAttribute("data-reelless-hidden"), false);
assert.equal(result.document.getElementById("video-2").hasAttribute("data-reelless-hidden"), false);
assert.equal(result.document.getElementById("recycled").dataset.reellessHidden, "true");
assert.equal(result.document.getElementById("main").hasAttribute("data-reelless-hidden"), false);
assert.equal(result.document.querySelectorAll("[data-reelless-checked]").length, 0, "links must not be marked on the DOM");

// Unrelated href churn (re-sets to the same value, changes on ordinary videos) must not make hidden
// Shorts flash back into view: the hidden marker never toggles.
const flips = observeHiddenFlips(result.dom, result.document.getElementById("shorts-section"));
for (let round = 0; round < 5; round += 1) {
  result.document.querySelector("#video-1 a").setAttribute("href", "/watch?v=one");
  result.document.querySelector("#video-2 a").setAttribute("href", `/watch?v=two-${round}`);
  result.document.getElementById("contents").appendChild(result.document.createElement("span"));
  await wait(40);
}
await wait(200);
assert.equal(flips.length, 0, "hidden Shorts must not be unhidden and re-hidden while the feed changes");
assert.equal(result.document.getElementById("shorts-section").dataset.reellessHidden, "true");
assert.equal(result.document.getElementById("video-2").hasAttribute("data-reelless-hidden"), false);

// A hidden card that a framework recycles for an ordinary video is shown again, whether its link
// changes in place or its contents are replaced, once its place in the feed is provably below the
// viewport. jsdom lays nothing out, so the neighbour above both cards is placed there explicitly.
layOut(result.document, { "video-2": [1000, 1200] });
result.document.getElementById("recycled-link").setAttribute("href", "/watch?v=recycled");
result.document.getElementById("replaced").innerHTML = `<a href="/watch?v=replaced">Replaced video</a>`;
await wait(200);
assert.equal(result.document.getElementById("recycled").hasAttribute("data-reelless-hidden"), false, "a recycled card should reappear");
assert.equal(result.document.getElementById("replaced").hasAttribute("data-reelless-hidden"), false, "a card with replaced contents should reappear");
assert.equal(result.document.getElementById("shorts-section").dataset.reellessHidden, "true");

// Switching YouTube to keep mode at runtime reveals every hidden entry point without a reload.
await result.changeSettings(withEntryPoints(defaults, "youtube", "keep"));
assert.equal(result.document.querySelectorAll("[data-reelless-hidden]").length, 0, "keep mode should show the Shorts shelf again");
await result.changeSettings(defaults);
assert.equal(result.document.getElementById("shorts-section").dataset.reellessHidden, "true", "returning to hide mode should hide the shelf again");
assert.equal(result.messages.filter((message) => message.type === "recordBlockAttempt").length, 0, "hidden cards never count as attempts");
result.dom.window.close();

// Keep mode: Shorts stay visible in feeds, but opening one is still intercepted and converted.
const keepYoutube = withEntryPoints(defaults, "youtube", "keep");
result = await fixture({
  url: "https://www.youtube.com/",
  settings: keepYoutube,
  html: `<main id="main"><ytd-reel-shelf-renderer id="shorts"><a id="short-link" href="/shorts/abc">Shorts</a></ytd-reel-shelf-renderer><ytd-guide-entry-renderer id="guide"><a id="shorts-tab" href="/shorts">Shorts tab</a></ytd-guide-entry-renderer><ytd-rich-item-renderer id="normal"><a href="/watch?v=lesson">Lesson</a></ytd-rich-item-renderer></main>`
});
assert.equal(result.document.querySelectorAll("[data-reelless-hidden]").length, 0, "keep mode must not hide any entry point");
assert.equal(shared.shouldBlockUrl(keepYoutube, "https://www.youtube.com/shorts/abc").blocked, true, "keep mode still blocks the destination");
const shortLink = result.document.getElementById("short-link");
assert.equal(shortLink.dispatchEvent(new result.dom.window.MouseEvent("click", { bubbles: true, cancelable: true })), false, "opening a visible Short must be intercepted");
assert.equal(result.messages.filter((message) => message.type === "recordBlockAttempt").length, 1, "a deliberate click on a visible Short counts once");
assert.equal(result.document.getElementById("reelless-focus-screen"), null, "a Short with an id converts to the watch page instead of showing the screen");

// A blocked click that has no watch equivalent shows the focus screen, which stays until dismissed.
const shortsTab = result.document.getElementById("shorts-tab");
assert.equal(shortsTab.dispatchEvent(new result.dom.window.MouseEvent("click", { bubbles: true, cancelable: true })), false);
assert.ok(result.document.getElementById("reelless-focus-screen"), "the Shorts tab click should show the focus screen");
await wait(250);
assert.ok(result.document.getElementById("reelless-focus-screen"), "the click screen must survive later passes while the page is unchanged");
const dismiss = result.document.querySelector('#reelless-focus-screen [data-action="dismiss"]');
assert.ok(dismiss, "a click screen offers a way to stay on the current page");
dismiss.dispatchEvent(new result.dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
assert.equal(result.document.getElementById("reelless-focus-screen"), null, "Stay here should close the click screen");
assert.equal(result.messages.filter((message) => message.type === "recordBlockAttempt").length, 2);
result.dom.window.close();

// Direct navigation screens are not pinned and carry no Stay here action.
result = await fixture({ url: "https://www.tiktok.com/", settings: defaults, html: `<main><h1>TikTok fixture</h1></main>` });
assert.ok(result.document.getElementById("reelless-focus-screen"));
assert.equal(result.document.querySelector('#reelless-focus-screen [data-action="dismiss"]'), null, "a blocked page cannot simply be dismissed");
result.dom.window.close();

// Keep mode on Instagram leaves Reel cards in place while the click guard still redirects.
result = await fixture({
  url: "https://www.instagram.com/",
  settings: withEntryPoints(defaults, "instagram", "keep"),
  html: `<main role="main" id="main"><div role="list"><div role="listitem" id="reel-card"><a id="reel-link" href="/reel/xyz">Reel</a></div><div role="listitem" id="photo-card"><a href="/p/photo">Photo</a></div></div></main>`
});
assert.equal(result.document.getElementById("reel-card").hasAttribute("data-reelless-hidden"), false);
assert.equal(result.document.getElementById("reel-link").dispatchEvent(new result.dom.window.MouseEvent("click", { bubbles: true, cancelable: true })), false);
assert.equal(result.messages.filter((message) => message.type === "recordBlockAttempt").length, 1);
result.dom.window.close();

// Search results wrap the Shorts heading and its cards in grid-shelf-view-model. Hiding only the
// cards leaves an orphaned "Shorts" title, which is what the store screenshot exposed.
result = await fixture({
  url: "https://www.youtube.com/results?search_query=lofi",
  settings: defaults,
  html: `<main id="main"><div id="contents">
    <ytd-video-renderer id="normal-1"><a href="/watch?v=one">One</a></ytd-video-renderer>
    <grid-shelf-view-model id="search-shorts"><h2 id="shorts-heading">Shorts</h2>
      <ytm-shorts-lockup-view-model-v2 id="s1"><a href="/shorts/a">A</a></ytm-shorts-lockup-view-model-v2>
      <ytm-shorts-lockup-view-model-v2 id="s2"><a href="/shorts/b">B</a></ytm-shorts-lockup-view-model-v2>
    </grid-shelf-view-model>
    <ytd-video-renderer id="normal-2"><a href="/watch?v=two">Two</a></ytd-video-renderer>
  </div></main>`
});
assert.equal(result.document.getElementById("search-shorts").dataset.reellessHidden, "true", "the search Shorts shelf should be hidden with its heading");
assert.equal(result.document.getElementById("normal-1").hasAttribute("data-reelless-hidden"), false);
assert.equal(result.document.getElementById("normal-2").hasAttribute("data-reelless-hidden"), false);
result.dom.window.close();

// A grid that mixes Shorts with ordinary videos must lose only the Shorts, never the whole shelf.
result = await fixture({
  url: "https://www.youtube.com/results?search_query=lofi",
  settings: defaults,
  html: `<main id="main"><div id="contents"><grid-shelf-view-model id="mixed">
    <ytd-video-renderer id="keep"><a href="/watch?v=keep">Keep</a></ytd-video-renderer>
    <ytd-video-renderer id="drop"><a href="/shorts/c">Drop</a></ytd-video-renderer>
  </grid-shelf-view-model></div></main>`
});
assert.equal(result.document.getElementById("mixed").hasAttribute("data-reelless-hidden"), false, "a mixed grid must not be hidden whole");
assert.equal(result.document.getElementById("drop").dataset.reellessHidden, "true");
assert.equal(result.document.getElementById("keep").hasAttribute("data-reelless-hidden"), false);
result.dom.window.close();

// A long infinite-scroll session pushes new cards past FULL_SCAN_LIMIT anchors. A full scan only
// sweeps the first 4000 anchors in document order, so newly inserted content must be evaluated on
// its own and never discarded just because a full scan lands in the same coalesced pass.
const longFeed = Array.from({ length: 4200 }, (_, index) =>
  `<ytd-rich-item-renderer><a href="/watch?v=v${index}">V${index}</a></ytd-rich-item-renderer>`).join("");
result = await fixture({
  url: "https://www.youtube.com/",
  settings: defaults,
  html: `<main id="main"><div id="feed">${longFeed}</div></main>`
});
assert.ok(result.document.querySelectorAll("a[href]").length > 4000, "the fixture must exceed the full-scan cap");
const lateShelf = result.document.createElement("ytd-rich-section-renderer");
lateShelf.id = "late-shorts";
lateShelf.innerHTML = `<ytd-rich-shelf-renderer is-shorts><a href="/shorts/late">Late Short</a></ytd-rich-shelf-renderer>`;
result.document.getElementById("feed").appendChild(lateShelf);
// Force a full scan into the same pass as the insertion — this is what used to discard it.
result.dom.window.dispatchEvent(new result.dom.window.Event("yt-navigate-finish"));
await wait(400);
assert.equal(
  result.document.getElementById("late-shorts").dataset.reellessHidden,
  "true",
  "a Shorts shelf added beyond the full-scan cap must still be hidden"
);
result.dom.window.close();

// Instagram rewrites its address as reels scroll past. Answering that with a real navigation
// reloads the feed and throws the reader to the top, so the address is put back instead.
result = await fixture({
  url: "https://www.instagram.com/",
  settings: defaults,
  html: `<main role="main" id="main"><article id="post"><a href="/p/photo">Photo</a></article></main>`
});
assert.equal(result.document.getElementById("reelless-focus-screen"), null, "the feed itself is not blocked");
const startingCount = result.messages.filter((m) => m.type === "recordBlockAttempt").length;
result.dom.window.history.pushState({}, "", "/reel/scrolledpast/");
assert.equal(result.dom.window.location.pathname, "/reel/scrolledpast/");
// jsdom has no Navigation API, so this exercises the slower fallback: the periodic sweep noticing
// an address that changed with no accompanying event and no DOM mutation.
await wait(1500);
assert.equal(result.dom.window.location.pathname, "/", "the address must be restored to the page that was allowed");
assert.equal(result.document.getElementById("post"), result.document.querySelector("#post"), "the feed must survive untouched");
assert.equal(
  result.messages.filter((m) => m.type === "recordBlockAttempt").length,
  startingCount,
  "an address rewritten by the site is not a deliberate attempt and must not be counted"
);
result.dom.window.close();

// Arriving directly on a Reel is a real visit, so it still redirects rather than being restored.
result = await fixture({
  url: "https://www.instagram.com/reel/direct/",
  settings: defaults,
  html: `<main role="main"><h1>Reel</h1></main>`
});
assert.equal(
  result.messages.filter((m) => m.type === "recordBlockAttempt").length,
  1,
  "a direct visit to a Reel is a deliberate attempt and counts once"
);
result.dom.window.close();

// A Reel shared in a conversation is not a link, so the click guard never sees it. Opening it still
// moves the address, and that is what gets undone. The conversation itself is never touched.
result = await fixture({
  url: "https://www.instagram.com/direct/t/12345/",
  settings: defaults,
  html: `<main role="main"><div class="msg" id="m1">Hey</div><div class="msg" id="m2"><div id="shared" role="button">Shared Reel</div></div><div class="msg" id="m3">and this</div></main>`
});
assert.equal(result.document.querySelectorAll("[data-reelless-hidden]").length, 0, "a conversation must never have anything hidden in it");
const dmCountBefore = result.messages.filter((m) => m.type === "recordBlockAttempt").length;
// A real open begins with the reader touching the page.
result.document.getElementById("shared").dispatchEvent(new result.dom.window.Event("pointerdown", { bubbles: true }));
result.dom.window.history.pushState({}, "", "/reel/fromfriend/");
await wait(1500);
assert.notEqual(result.dom.window.location.pathname, "/reel/fromfriend/", "a Reel opened from a conversation must not stay open");
assert.equal(
  result.messages.filter((m) => m.type === "recordBlockAttempt").length,
  dmCountBefore + 1,
  "opening a shared Reel is a deliberate attempt and counts once"
);
for (const id of ["m1", "m2", "m3"]) {
  assert.equal(result.document.getElementById(id).hasAttribute("data-reelless-hidden"), false, `message ${id} must be left alone`);
}
result.dom.window.close();

// The guard must key the difference off a gesture, and must only decline in-page transitions.
assert.match(guardSource, /function userDriven\(\)/, "the guard must tell a deliberate open from an address the site rewrote");
assert.match(guardSource, /destination\.sameDocument/, "only in-page transitions may be declined; a real page load needs somewhere to go");
assert.match(guardSource, /navigation\.addEventListener|nav\.addEventListener\("navigate"/, "the guard must watch same-document navigations");

// Instagram and Facebook on the stylesheet path. With :has() available the script writes no marker
// and creates no observer, and the gate is armed; the rules themselves are exercised in Chrome.
const instagramFeed = `<main role="main" id="main">
  <nav id="rail"><a id="rail-home" href="/">Home</a><a id="rail-reels" href="/reels/">Reels</a><a id="rail-explore" href="/explore/">Explore</a></nav>
  <div id="feed">
    <article id="post"><a href="/alice/">alice</a><a href="/p/AAA/">post</a></article>
    <article id="reel"><a href="/bob/">bob</a><a id="reel-link" href="/reel/XYZ/">reel</a></article>
    <div role="listitem" id="reel-item"><a href="/reel/ABC/">reel</a></div>
  </div>
  <div id="tabs"><a id="tab-posts" href="/nasa/">Posts</a><a id="tab-reels" href="/nasa/reels/">Reels</a></div>
</main>`;
result = await fixture({ url: "https://www.instagram.com/", settings: defaults, cssHas: true, html: instagramFeed });
assert.equal(result.mode(), "hide", "Instagram must arm the stylesheet gate");
assert.equal(result.document.querySelectorAll("[data-reelless-hidden]").length, 0, "with :has() the script must not mark anything on Instagram");
assert.equal(result.guardObservers, 0, "with :has() the script must not watch the Instagram DOM");
result.dom.window.close();

result = await fixture({
  url: "https://www.facebook.com/",
  settings: defaults,
  cssHas: true,
  html: `<main id="main"><div role="feed"><div role="article" id="unit"><a href="/reel/111/">R1</a></div></div><ul><li id="nav-reels"><a href="/reel/?s=ifu">Reels</a></li></ul></main>`
});
assert.equal(result.mode(), "hide", "Facebook must arm the stylesheet gate");
assert.equal(result.document.querySelectorAll("[data-reelless-hidden]").length, 0, "with :has() the script must not mark anything on Facebook");
assert.equal(result.guardObservers, 0, "with :has() the script must not watch the Facebook DOM");
result.dom.window.close();

// The same page on the script path hides the same things, including the nav-rail entry and the
// profile tab, which sit outside any card. This is what the stylesheet rules are held to.
result = await fixture({ url: "https://www.instagram.com/", settings: defaults, html: instagramFeed });
assert.equal(result.document.getElementById("reel").dataset.reellessHidden, "true");
assert.equal(result.document.getElementById("reel-item").dataset.reellessHidden, "true");
assert.equal(result.document.getElementById("rail-reels").dataset.reellessHidden, "true", "the nav-rail Reels entry is hidden on its own");
assert.equal(result.document.getElementById("tab-reels").dataset.reellessHidden, "true", "a profile's Reels tab is hidden on its own");
for (const id of ["main", "rail", "rail-home", "rail-explore", "feed", "post", "tabs", "tab-posts"]) {
  assert.equal(result.document.getElementById(id).hasAttribute("data-reelless-hidden"), false, `${id} must stay`);
}
assert.ok(result.guardObservers >= 1, "without :has() the script still watches the DOM");
result.dom.window.close();

// Selected sections with Reels deliberately unchecked: the gate must not arm, or a rule that
// cannot see per-section choices would hide the Reels they kept. Explore, which they did block,
// is still taken out by the script, so the observer stays on even where :has() exists.
for (const cssHas of [false, true]) {
  result = await fixture({
    url: "https://www.instagram.com/",
    settings: withSections(defaults, "instagram", { reels: false, explore: true }),
    cssHas,
    html: instagramFeed
  });
  assert.equal(result.mode(), "keep", `cssHas=${cssHas}: Reels unchecked must release the stylesheet gate`);
  assert.equal(result.document.getElementById("reel").hasAttribute("data-reelless-hidden"), false, `cssHas=${cssHas}: a Reel they kept must not be hidden`);
  assert.equal(result.document.getElementById("rail-reels").hasAttribute("data-reelless-hidden"), false);
  assert.equal(result.document.getElementById("rail-explore").dataset.reellessHidden, "true", `cssHas=${cssHas}: Explore is blocked, so its entry is hidden by script`);
  assert.ok(result.guardObservers >= 1, `cssHas=${cssHas}: a blocked section the stylesheet does not cover keeps the script path on`);
  result.dom.window.close();
}
result = await fixture({
  url: "https://www.instagram.com/",
  settings: withSections(defaults, "instagram", { reels: true, explore: false }),
  cssHas: true,
  html: instagramFeed
});
assert.equal(result.mode(), "hide", "Reels checked on its own arms the gate");
assert.equal(result.guardObservers, 0, "with only Reels blocked the stylesheet covers everything");
result.dom.window.close();
result = await fixture({
  url: "https://www.youtube.com/",
  settings: withSections(defaults, "youtube", { shorts: false }),
  cssHas: true,
  html: `<main id="main"><ytd-reel-shelf-renderer id="shorts"><a href="/shorts/abc">Shorts</a></ytd-reel-shelf-renderer></main>`
});
assert.equal(result.mode(), "keep", "YouTube with Shorts unchecked must release the gate too");
result.dom.window.close();

// The fallback reveal guard. A card recycled from a Reel into an ordinary post keeps its author
// link, so it is not empty, and none of its links is blocked. Revealing it restores its height,
// and above the reader that carries them backward up the feed. So a reveal needs positive
// evidence the card sits below the viewport: unknown geometry, a neighbour above, and a neighbour
// straddling the top of the viewport all keep it hidden; it reappears once the evidence is there.
const recycledFeed = `<main role="main" id="main"><div id="feed">
  <article id="p1"><a href="/alice/">alice</a><a href="/p/A/">post</a></article>
  <article id="reel"><a href="/bob/">bob</a><a id="reel-link" href="/reel/X/">reel</a></article>
  <article id="p2"><a href="/carol/">carol</a><a href="/p/B/">post</a></article>
</div></main>`;
result = await fixture({ url: "https://www.instagram.com/", settings: defaults, html: recycledFeed });
assert.equal(result.document.getElementById("reel").dataset.reellessHidden, "true");
result.document.getElementById("reel-link").setAttribute("href", "/p/C/");
await nextPass(result.dom);
assert.equal(result.document.getElementById("reel").dataset.reellessHidden, "true", "unknown geometry must not reveal a recycled card");
layOut(result.document, { p1: [-900, -100], p2: [-50, 500] });
await nextPass(result.dom);
assert.equal(result.document.getElementById("reel").dataset.reellessHidden, "true", "a neighbour straddling the viewport top must not reveal it");
layOut(result.document, { p1: [-900, -100], p2: [-800, -300] });
await nextPass(result.dom);
assert.equal(result.document.getElementById("reel").dataset.reellessHidden, "true", "a card above the reader must not be revealed");
layOut(result.document, { p1: [100, 700], p2: [900, 1500] });
await nextPass(result.dom);
assert.equal(result.document.getElementById("reel").hasAttribute("data-reelless-hidden"), false, "a recycled card below the viewport reappears");
// A Reel link that loses its href altogether, with the author link surviving, is the same case.
result.document.getElementById("reel").setAttribute("data-reelless-hidden", "true");
result.document.getElementById("reel-link").setAttribute("href", "/reel/Y/");
await nextPass(result.dom);
layOut(result.document, { p1: [-900, -100], p2: [-50, 500] });
result.document.getElementById("reel-link").removeAttribute("href");
await nextPass(result.dom);
assert.equal(result.document.getElementById("reel").dataset.reellessHidden, "true", "a Reel link losing its href must not reveal the card above the reader");
result.dom.window.close();

// A card alone in its own wrapper has no siblings; the wrapper's neighbours place it instead.
result = await fixture({
  url: "https://www.instagram.com/",
  settings: defaults,
  html: `<main role="main" id="main"><div id="feed"><div id="w1"><article id="p1"><a href="/p/A/">post</a></article></div><div id="w2"><article id="reel"><a href="/bob/">bob</a><a id="reel-link" href="/reel/X/">reel</a></article></div><div id="w3"><article id="p2"><a href="/p/B/">post</a></article></div></div></main>`
});
assert.equal(result.document.getElementById("reel").dataset.reellessHidden, "true");
result.document.getElementById("reel-link").setAttribute("href", "/p/C/");
layOut(result.document, { w1: [-900, -100], w3: [-50, 500] });
await nextPass(result.dom);
assert.equal(result.document.getElementById("reel").dataset.reellessHidden, "true", "a wrapped card straddling the top must stay hidden");
layOut(result.document, { w1: [100, 700], w3: [900, 1500] });
await nextPass(result.dom);
assert.equal(result.document.getElementById("reel").hasAttribute("data-reelless-hidden"), false, "a wrapped card below the viewport reappears");
result.dom.window.close();

// The stylesheet carries the hiding on browsers that support :has(). These assertions pin the
// contract the CSS relies on, since jsdom has no :has() support and always takes the script path.
const guardCss = fs.readFileSync(new URL("../site_guard.css", import.meta.url), "utf8");
assert.match(guardCss, /html:not\(\[data-reelless-mode="keep"\]\):not\(\[data-reelless-mode="off"\]\)/,
  "the rules must default to hiding, so a page cannot flash Shorts before settings load");
for (const selector of [
  "ytd-reel-shelf-renderer",
  'ytd-rich-shelf-renderer[is-shorts]',
  'ytd-rich-item-renderer:has(a[href*="/shorts/"])',
  'ytd-video-renderer:has(a[href*="/shorts/"])',
  'grid-shelf-view-model:has(a[href*="/shorts/"]):not(:has(a[href*="/watch"]))'
]) {
  assert.ok(guardCss.includes(selector), `site_guard.css must cover ${selector}`);
}
// Each surface must have a rule, gated on its own token, and absent by default.
for (const surface of ["homeFeed", "sidebar", "comments", "endScreen"]) {
  assert.ok(guardCss.includes(`[data-reelless-surfaces~="${surface}"]`), `site_guard.css needs a rule for the ${surface} surface`);
}
assert.equal(guardCss.includes('data-reelless-surfaces~="explore"'), false, "Explore and Trending are gone from YouTube's navigation; the rule should not linger");
assert.match(guardSource, /applySurfaceAttribute/, "the guard must publish which surfaces are on");

// Instagram and Facebook rules: the innermost card around a Reel link, never a wrapper holding
// another post or the main region, plus the links that sit outside any card.
for (const selector of [
  'article:not(:has(article, [role="article"], main, [role="main"])):has(a[href*="/reel/"], a[href*="/reels/"], a[href$="/reels"], a[href*="/share/r/"])',
  '[role="article"]:not(:has(article, [role="article"], main, [role="main"])):has(a[href*="/reel/"], a[href*="/reels/"], a[href$="/reels"], a[href*="/share/r/"])',
  '[role="listitem"]:not(:has(article, [role="article"], [role="listitem"], li, main, [role="main"])):has(a[href*="/reel/"], a[href*="/reels/"], a[href$="/reels"], a[href*="/share/r/"])',
  'li:not(:has(article, [role="article"], [role="listitem"], li, main, [role="main"])):has(a[href*="/reel/"], a[href*="/reels/"], a[href$="/reels"], a[href*="/share/r/"])',
  'a[href*="/reel/"]',
  'a[href*="/reels/"]',
  'a[href$="/reels"]',
  // Facebook resolves a "/share/r/" link to a Reel, so the hiding path must cover it too, or a
  // shared Reel stays visible in a feed while the guard refuses to open it.
  'a[href*="/share/r/"]'
]) {
  assert.ok(guardCss.includes(selector), `site_guard.css must cover ${selector}`);
}

assert.match(guardSource, /CSS_COVERED = new Map\(\[\s*\["youtube", \["shorts"\]\],\s*\["instagram", \["reels"\]\],\s*\["facebook", \["reels"\]\]\s*\]\)/, "YouTube, Instagram and Facebook hiding is delegated to the stylesheet");
assert.match(guardSource, /CSS\.supports\("selector\(:has\(a\)\)"\)/, "the script must feature-detect rather than assume");
assert.match(guardSource, /CONVERSATION_PATHS = \{ instagram: \/\^\\\/direct/, "Instagram Direct must be excused from the stylesheet by address");
assert.match(guardSource, /facebook: \/\^\\\/messages/, "Messenger must be excused from the stylesheet by address");

await wait(50);
assert.deepEqual(unexpectedErrors.map((error) => error.message), [], "the guard must not raise errors in any fixture");

console.log("Core and optional platform DOM, mutation, safety-ancestor, entry-point mode, and focus-screen tests passed.");
