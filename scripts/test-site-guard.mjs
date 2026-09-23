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
let result;

// Blocking Home must leave usable exits, filtered again when settings change.
const blockedHome = withSections(defaults, "x", { home: true, explore: false, video: true });
const homeScreen = await fixture({ url: "https://x.com/home", html: "<main>Feed</main>", settings: blockedHome });
const destinations = () => [...homeScreen.document.querySelectorAll(".reelless-links a")];
assert.deepEqual(destinations().map((link) => link.textContent), ["Explore", "Notifications", "Chat", "Bookmarks"]);
assert.ok(destinations().every((link) => !shared.shouldBlockUrl(blockedHome, link.href).blocked));
const exploreBlocked = withSections(blockedHome, "x", { home: true });
exploreBlocked.platforms.x.surfaces.xExplore = true;
exploreBlocked.customEntries = ["x.com/notifications"];
await homeScreen.changeSettings(exploreBlocked);
assert.deepEqual(destinations().map((link) => link.textContent), ["Search", "Chat", "Bookmarks"]);
const lockedHome = shared.createUltimateSettings(exploreBlocked, "keep_current");
await homeScreen.changeSettings(lockedHome);
assert.equal(homeScreen.document.querySelector('[data-action="pause"]'), null);
assert.equal(destinations().length, 3, "allowed navigation remains available during Ultimate Lock");
assert.equal(homeScreen.messages.filter((message) => message.type === "recordBlockAttempt").length, 1, "settings refreshes must not recount the blocked Home visit");
const chatLink = destinations().find((link) => link.textContent === "Chat");
assert.equal(chatLink.dispatchEvent(new homeScreen.dom.window.MouseEvent("click", { bubbles: true, cancelable: true })), true);
homeScreen.dom.window.history.pushState({}, "", chatLink.href);
await nextPass(homeScreen.dom);
assert.equal(homeScreen.document.getElementById("reelless-focus-screen"), null, "an allowed destination releases the overlay");
homeScreen.dom.window.close();

for (const platform of shared.PLATFORMS) {
  const allBlocked = JSON.parse(JSON.stringify(defaults));
  allBlocked.platforms[platform.id].mode = "all";
  const screen = await fixture({ url: platform.homeUrl, html: "<main></main>", settings: allBlocked });
  assert.ok(screen.document.getElementById("reelless-focus-screen"));
  assert.equal(screen.document.querySelector(".reelless-destinations"), null, `${platform.id}: Block all must offer no site shortcuts`);
  screen.dom.window.close();
}

// X surfaces preserve useful controls and follow route/settings changes without counting visits.
const xHtml = fs.readFileSync(new URL("./fixtures/x.html", import.meta.url), "utf8");
for (const [xExplore, xSidebar] of [[true, false], [false, true], [true, true]]) {
  const quietX = shared.normalizeSettings({ platforms: { x: { mode: "selected", surfaces: { xExplore, xSidebar } } } });
  const x = await fixture({ url: "https://twitter.com/explore", settings: quietX, html: xHtml });
  const marked = (id) => x.document.getElementById(id).hasAttribute("data-reelless-x-hidden");
  assert.equal(marked("timeline"), xExplore);
  assert.equal(marked("tabs"), xExplore);
  for (const id of ["news", "trends", "follow"]) assert.equal(marked(id), xSidebar);
  for (const id of ["navigation", "search", "sidebar-search", "suggestions", "chat", "mixed-region", "mixed-sidebar", "unknown", "footer"]) {
    assert.equal(x.document.getElementById(id).closest("[data-reelless-x-hidden]"), null, `${id} must stay accessible`);
  }
  const late = x.document.createElement("section");
  late.innerHTML = '<h2>More news</h2><a href="/i/news/456">Story</a>';
  x.document.querySelector('[data-testid="sidebarColumn"]').appendChild(late);
  await wait(220);
  assert.equal(late.hasAttribute("data-reelless-x-hidden"), xSidebar);
  for (const path of ["/search?q=work", "/friend", "/friend/status/123", "/messages", "/i/chat"]) {
    x.dom.window.history.pushState({}, "", path);
    await nextPass(x.dom);
    assert.equal(marked("timeline"), false, "only Explore discovery regions should be hidden");
    assert.equal(x.document.getElementById("reelless-focus-screen"), null);
  }
  x.dom.window.history.pushState({}, "", "/explore/tabs/trending");
  await nextPass(x.dom);
  assert.equal(marked("timeline"), xExplore);
  await x.changeSettings({ ...quietX, pausedUntil: new Date(Date.now() + 60000).toISOString() });
  assert.equal(x.document.querySelector("[data-reelless-x-hidden]"), null);
  await x.changeSettings(quietX);
  assert.equal(marked("timeline"), xExplore);
  const timeAhead = (minutes) => {
    const then = new Date(Date.now() + minutes * 60000);
    return `${String(then.getHours()).padStart(2, "0")}:${String(then.getMinutes()).padStart(2, "0")}`;
  };
  await x.changeSettings({ ...quietX, schedulePreset: "custom", customStart: timeAhead(10), customEnd: timeAhead(20) });
  assert.equal(x.document.querySelector("[data-reelless-x-hidden]"), null, "inactive schedules restore all modules");
  await x.changeSettings({ ...quietX, platforms: { ...quietX.platforms, x: { ...quietX.platforms.x, mode: "off" } } });
  assert.equal(x.document.querySelector("[data-reelless-x-hidden]"), null, "Off restores all modules");
  await x.changeSettings({ ...quietX, protectionEnabled: false });
  assert.equal(x.document.querySelector("[data-reelless-x-hidden]"), null);
  const locked = shared.createUltimateSettings(quietX, "keep_current");
  await x.changeSettings({ ...locked, platforms: defaults.platforms });
  assert.equal(marked("timeline"), xExplore, "locked choices override tampering");
  assert.equal(marked("news"), xSidebar);
  assert.equal(x.messages.filter((message) => message.type === "recordBlockAttempt").length, 0);
  x.dom.window.close();
}

// Reddit focus controls remove broad feeds and promotional navigation without touching discussions.
const redditHtml = `<header><form role="search" id="reddit-search"><input></form></header>
  <nav id="reddit-nav">
    <section id="games"><h2>Jeux</h2><a href="/games/hexastack">Hexa Stack</a><a href="/r/game">Game community</a></section>
    <details id="discover" open><summary>発見</summary><a href="/best/communities/1/">Discover communities</a></details>
    <section id="recent"><h2>Recent</h2><a href="/r/codex/">r/codex</a></section>
    <section id="custom-feeds"><h2>Custom feeds</h2><a href="/user/me/m/myfeed/">My feed</a></section>
    <section id="mixed-reddit"><h2>Account tools</h2><a href="/user/me/">Profile</a><a href="/games/">Games</a></section>
  </nav>
  <main id="reddit-content"><article><a href="/r/codex/comments/abc/post/">Useful post</a><div id="comments">Discussion</div></article></main>`;
const redditSettings = shared.normalizeSettings({ platforms: { reddit: {
  mode: "selected", entryPoints: "hide", sections: { home: true, discovery: true }, surfaces: { redditSidebar: true }
} } });
result = await fixture({ url: "https://www.reddit.com/r/codex/comments/abc/post/", settings: redditSettings, html: redditHtml });
for (const id of ["games", "discover"]) assert.equal(result.document.getElementById(id).dataset.reellessRedditHidden, "sidebar");
for (const id of ["reddit-search", "reddit-nav", "recent", "custom-feeds", "mixed-reddit", "reddit-content", "comments"]) {
  assert.equal(result.document.getElementById(id).closest("[data-reelless-reddit-hidden]"), null, `${id} must remain available`);
}
const latePromo = result.document.createElement("section");
latePromo.id = "late-promo";
latePromo.innerHTML = '<h2>Games</h2><a href="/games/new/">New game</a>';
result.document.getElementById("reddit-nav").appendChild(latePromo);
await wait(220);
assert.equal(latePromo.dataset.reellessRedditHidden, "sidebar", "dynamic promotional navigation is hidden");
await result.changeSettings({ ...redditSettings, pausedUntil: new Date(Date.now() + 60000).toISOString() });
assert.equal(result.document.querySelector("[data-reelless-reddit-hidden]"), null, "pausing restores Reddit navigation");
await result.changeSettings(redditSettings);
assert.equal(result.document.getElementById("games").dataset.reellessRedditHidden, "sidebar");
await result.changeSettings({ ...redditSettings, platforms: { ...redditSettings.platforms, reddit: { ...redditSettings.platforms.reddit, mode: "off" } } });
assert.equal(result.document.querySelector("[data-reelless-reddit-hidden]"), null, "Off restores Reddit navigation");
assert.equal(result.messages.filter((message) => message.type === "recordBlockAttempt").length, 0, "hiding navigation is not a blocked attempt");
result.dom.window.close();

result = await fixture({ url: "https://www.reddit.com/", settings: redditSettings, html: "<main>Home</main>" });
assert.deepEqual([...result.document.querySelectorAll(".reelless-links a")].map((link) => link.textContent), ["Search", "Notifications", "Chat", "Saved"]);
assert.equal(result.messages.filter((message) => message.type === "recordBlockAttempt").length, 1);
result.dom.window.close();

// YouTube: known Shorts shelf is hidden while the surrounding main layout and normal video remain.
result = await fixture({
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

// Facebook: an fb.watch share card is a Watch entry point, hidden with the post, and a click
// on it is refused. A video in newer section-level markup is hidden with its post too.
result = await fixture({
  url: "https://www.facebook.com/",
  settings: defaults,
  html: `<main id="main"><div role="feed" id="feed"><article id="fbwatch-card"><a id="fbwatch-link" href="https://fb.watch/AbC123/">Shared video</a></article><section id="new-markup-post"><div><video id="new-markup-video"></video></div></section><article id="photo-card"><a href="/photo/123">Photo</a></article></div></main>`
});
assert.equal(result.document.getElementById("fbwatch-card").dataset.reellessHidden, "true", "an fb.watch card must be hidden");
assert.equal(result.document.getElementById("new-markup-post").dataset.reellessHidden, "true", "a video in section markup must be hidden with its post");
assert.equal(result.document.getElementById("photo-card").hasAttribute("data-reelless-hidden"), false);
assert.equal(result.document.getElementById("main").hasAttribute("data-reelless-hidden"), false);
assert.equal(
  result.document.getElementById("fbwatch-link").dispatchEvent(new result.dom.window.MouseEvent("click", { bubbles: true, cancelable: true })),
  false,
  "an fb.watch click must be refused"
);
assert.ok(result.document.getElementById("reelless-focus-screen"), "an fb.watch click must show the focus screen");
result.dom.window.close();

// Facebook: renamed post markup (plain divs, none of the known post selectors) still loses the
// whole video post rather than just the player, and a localised thumbnail with no <video> yet
// is caught by its language-independent seek control. A Reel player in the same unknown markup
// stays playable while only Watch is blocked.
result = await fixture({
  url: "https://www.facebook.com/?locale=ru_RU",
  settings: defaults,
  html: `<main id="main"><div id="feed"><div class="post" id="plain-video-post"><a href="/friend">Friend</a><video id="plain-video"></video></div><div class="post" id="plain-thumbnail-post"><a href="/friend">Friend</a><div role="slider" aria-label="Прокрутка видео" id="ru-seek"></div></div><div class="post" id="plain-reel-post"><video id="plain-reel-video"></video><a href="/reel/777/">Reel</a></div><div class="post" id="plain-photo-post"><a href="/photo/1">Photo</a></div></div></main>`
});
assert.equal(result.document.getElementById("plain-video-post").dataset.reellessHidden, "true", "a video in renamed markup must be hidden with its post");
assert.equal(result.document.getElementById("plain-thumbnail-post").dataset.reellessHidden, "true", "a localised thumbnail must be hidden by its seek control");
assert.equal(result.document.getElementById("plain-photo-post").hasAttribute("data-reelless-hidden"), false);
assert.equal(result.document.getElementById("main").hasAttribute("data-reelless-hidden"), false);
result.dom.window.close();

result = await fixture({
  url: "https://www.facebook.com/?locale=ru_RU",
  settings: withSections(defaults, "facebook", { reels: false, watch: true, stories: false, marketplace: false }),
  html: `<main id="main"><div id="feed"><div class="post" id="kept-reel-post"><video id="kept-reel-video"></video><a href="/reel/777/">Reel</a></div></div></main>`
});
assert.equal(result.document.getElementById("kept-reel-post").hasAttribute("data-reelless-hidden"), false, "blocking Watch while keeping Reels must leave Reel players alone");
assert.equal(result.document.getElementById("kept-reel-video").hasAttribute("data-reelless-hidden"), false);
result.dom.window.close();

// Facebook: a Watch link in renamed markup hides the whole post, not just the link.
result = await fixture({
  url: "https://www.facebook.com/",
  settings: defaults,
  html: `<main id="main"><div id="feed"><div class="post" id="watch-link-post"><a id="watch-link" href="/watch/?v=123">Video</a></div></div></main>`
});
assert.equal(result.document.getElementById("watch-link-post").dataset.reellessHidden, "true", "a Watch link in renamed markup must hide its post, not just the link");
result.dom.window.close();

// Facebook: clicking the thumbnail itself (no link involved, so no navigation ever fires) is
// stopped with the video screen. Exercised in keep mode so the post is still visible to click.
result = await fixture({
  url: "https://www.facebook.com/",
  settings: withEntryPoints(defaults, "facebook", "keep"),
  html: `<main id="main"><div id="feed"><div class="post" id="thumb-click-post"><a href="/friend">Friend</a><div role="button" id="thumb"><video id="thumb-video"></video></div></div></div></main>`
});
assert.equal(result.document.getElementById("thumb-click-post").hasAttribute("data-reelless-hidden"), false, "keep mode leaves the video post visible");
assert.equal(
  result.document.getElementById("thumb").dispatchEvent(new result.dom.window.MouseEvent("click", { bubbles: true, cancelable: true })),
  false,
  "clicking a video thumbnail must be stopped even though it is not a link"
);
assert.ok(result.document.getElementById("reelless-focus-screen"), "a thumbnail click must show the video focus screen");
assert.match(result.document.getElementById("reelless-focus-title").textContent, /video/i);
result.dom.window.close();

// Facebook: opening a feed video plays in a theater overlay without changing the address, so
// there is no navigation to refuse. The theater is usually div[role="dialog"], but the role is
// not contractual: an aria-modal overlay with a player is the same theater and must be stopped
// with the video screen too.
result = await fixture({
  url: "https://www.facebook.com/",
  settings: defaults,
  html: `<main id="main"><div role="feed" id="feed"><div aria-posinset="1" id="post"><video id="clip"></video></div></div><div aria-modal="true" id="theater"><video id="theater-video"></video></div></main>`
});
await nextPass(result.dom);
assert.ok(result.document.getElementById("reelless-focus-screen"), "an aria-modal theater must show the video focus screen");
assert.match(result.document.getElementById("reelless-focus-title").textContent, /video/i);
assert.equal(result.messages.filter((message) => message.type === "recordBlockAttempt").length, 1, "a theater open counts once");
result.dom.window.close();

// Facebook: a theater rendered as a body-level portal with no dialog role at all is still the
// theater. Feed videos always sit inside the feed or page landmarks, so a video playing outside
// them while Watch is blocked is stopped, whatever wrapper Facebook renamed it to.
result = await fixture({
  url: "https://www.facebook.com/",
  settings: defaults,
  html: `<main id="main"><div role="feed" id="feed"><div aria-posinset="1" id="post"><video id="clip"></video></div></div></main><div id="portal"><video id="portal-video"></video></div>`
});
await nextPass(result.dom);
assert.ok(result.document.getElementById("reelless-focus-screen"), "a role-less portal theater must show the video focus screen");
assert.match(result.document.getElementById("reelless-focus-title").textContent, /video/i);
assert.equal(result.messages.filter((message) => message.type === "recordBlockAttempt").length, 1, "a portal theater open counts once");
result.dom.window.close();

// Facebook: a Reel theater stays playable while only Watch is blocked and Reels are kept.
result = await fixture({
  url: "https://www.facebook.com/",
  settings: withSections(defaults, "facebook", { reels: false, watch: true, stories: false, marketplace: false }),
  html: `<main id="main"><div role="feed" id="feed"></div></main><div aria-modal="true" id="reel-theater"><video id="reel-video"></video><a href="/reel/777/">Reel</a></div>`
});
await nextPass(result.dom);
assert.equal(result.document.getElementById("reelless-focus-screen"), null, "a Reel theater must stay playable while Reels are kept");
assert.equal(result.messages.filter((message) => message.type === "recordBlockAttempt").length, 0, "a kept Reel theater counts nothing");
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

// Personal custom boundaries stop in place with their own focus screen, hide their links,
// and refuse clicks — on their own pages and on platform pages alike.
const customOnly = JSON.parse(JSON.stringify(defaults));
customOnly.customEntries = ["example.com/reels"];
result = await fixture({
  url: "https://example.com/reels/123",
  settings: customOnly,
  html: `<main id="main"><article id="custom-card"><a href="/reels/456">More reels</a></article><article id="other-card"><a href="/home">Home</a></article></main>`
});
assert.ok(result.document.getElementById("reelless-focus-screen"), "a direct custom visit must show the focus screen");
assert.match(result.document.getElementById("reelless-focus-title").textContent, /outside your focus plan/i);
assert.equal(result.messages.filter((message) => message.type === "recordBlockAttempt").length, 1, "a direct custom visit counts once");
result.dom.window.close();

result = await fixture({
  url: "https://www.youtube.com/watch?v=useful",
  settings: customOnly,
  html: `<main id="main"><article id="custom-card"><a id="custom-link" href="https://example.com/reels/123">Custom video</a></article><article id="normal-card"><a id="lesson-link" href="/watch?v=lesson">Lesson</a></article></main>`
});
assert.equal(result.document.getElementById("custom-link").dataset.reellessHidden, "true", "a custom link must be hidden on platform pages too");
assert.equal(result.document.getElementById("lesson-link").hasAttribute("data-reelless-hidden"), false);
assert.equal(result.document.getElementById("main").hasAttribute("data-reelless-hidden"), false);
assert.equal(
  result.document.getElementById("custom-link").dispatchEvent(new result.dom.window.MouseEvent("click", { bubbles: true, cancelable: true })),
  false,
  "opening a custom link must be refused"
);
assert.ok(result.document.getElementById("reelless-focus-screen"), "a custom click must show the focus screen");
assert.equal(result.document.getElementById("lesson-link").dispatchEvent(new result.dom.window.MouseEvent("click", { bubbles: true, cancelable: true })), true);
assert.equal(result.messages.filter((message) => message.type === "recordBlockAttempt").length, 1, "a custom click counts once");
result.dom.window.close();

// A bare-domain entry blocks the whole site, while platform hosts stay under platform controls.
const customWide = JSON.parse(JSON.stringify(defaults));
customWide.customEntries = ["example.com", "youtube.com/watch"];
result = await fixture({
  url: "https://example.com/anything/here",
  settings: customWide,
  html: "<main id=main><h1>Custom fixture</h1></main>"
});
assert.ok(result.document.getElementById("reelless-focus-screen"), "a bare-domain entry must block the whole site");
result.dom.window.close();

result = await fixture({
  url: "https://www.youtube.com/watch?v=useful",
  settings: customWide,
  html: `<main id="main"><a id="watch-link" href="/watch?v=lesson">Lesson</a></main>`
});
assert.equal(result.document.getElementById("watch-link").dispatchEvent(new result.dom.window.MouseEvent("click", { bubbles: true, cancelable: true })), true, "a platform-host entry must not swallow platform pages");
assert.equal(result.document.getElementById("reelless-focus-screen"), null);
result.dom.window.close();

// Pausing releases custom boundaries together with platform protection.
const customPaused = JSON.parse(JSON.stringify(customOnly));
customPaused.pausedUntil = new Date(Date.now() + 60000).toISOString();
result = await fixture({
  url: "https://example.com/reels/123",
  settings: customPaused,
  html: `<main id="main"><article id="custom-card"><a href="/reels/456">More reels</a></article></main>`
});
assert.equal(result.document.getElementById("reelless-focus-screen"), null, "a paused custom boundary blocks nothing");
assert.equal(result.document.getElementById("custom-card").hasAttribute("data-reelless-hidden"), false);
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
  { id: "x", home: "https://x.com/explore", blocked: "https://x.com/home", mode: "selected", section: "home" },
  { id: "reddit", home: "https://www.reddit.com/r/codex/", blocked: "https://www.reddit.com/r/popular/", mode: "selected", section: "discovery" },
  { id: "snapchat", home: "https://www.snapchat.com/stories", blocked: "https://www.snapchat.com/spotlight/fixture", mode: "shortform" },
  { id: "twitch", home: "https://www.twitch.tv/somechannel", blocked: "https://clips.twitch.tv/FancySlug", mode: "shortform" },
  { id: "pinterest", home: "https://www.pinterest.com/pin/123/", blocked: "https://www.pinterest.com/ideas/", mode: "selected", section: "explore" },
  { id: "linkedin", home: "https://www.linkedin.com/jobs/", blocked: "https://www.linkedin.com/feed/", mode: "selected", section: "feed" },
  { id: "threads", home: "https://www.threads.com/search", blocked: "https://www.threads.com/", mode: "selected", section: "feed" }
];

assert.deepEqual(
  advancedFixtures.map((item) => item.id),
  shared.PLATFORMS.filter((platform) => !shared.CORE_PLATFORM_IDS.includes(platform.id)).map((platform) => platform.id),
  "The fixture matrix must cover every optional platform"
);

for (const platformFixture of advancedFixtures) {
  const settings = JSON.parse(JSON.stringify(defaults));
  settings.platforms[platformFixture.id].mode = platformFixture.mode;
  if (platformFixture.section) settings.platforms[platformFixture.id].sections[platformFixture.section] = true;

  result = await fixture({
    url: platformFixture.home,
    settings,
    html: `<main id="main"><article id="blocked-card"><a id="blocked-link" href="${platformFixture.blocked}">Blocked page</a></article><article id="useful-card"><a href="/useful">Useful page</a></article></main>`
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
    url: platformFixture.blocked,
    settings,
    html: "<main id=main><h1>Optional platform fixture</h1></main>"
  });
  assert.ok(result.document.getElementById("reelless-focus-screen"), `${platformFixture.id} should block direct short-form navigation`);
  assert.equal(result.messages.filter((message) => message.type === "recordBlockAttempt").length, 1, `${platformFixture.id} should count one direct navigation`);
  result.dom.window.close();
}

// X Explore page blocking is opt-in: the nav entry is hidden, opening it is refused in place,
// and a direct visit shows the focus screen, while search stays available.
const xExploreBlocking = shared.normalizeSettings({ platforms: { x: {
  mode: "selected", sections: { home: false, explore: true }, surfaces: { xExplore: false, xSidebar: false }
} } });
result = await fixture({
  url: "https://x.com/home",
  settings: xExploreBlocking,
  html: `<main id="main"><nav id="nav"><a id="explore-link" href="/explore">Explore</a><a id="search-link" href="/search?q=work">Search</a><a id="home-link" href="/home">Home</a></nav></main>`
});
assert.equal(result.document.getElementById("explore-link").dataset.reellessHidden, "true", "the Explore nav entry must be hidden while Explore is blocked");
assert.equal(result.document.getElementById("search-link").hasAttribute("data-reelless-hidden"), false, "search must stay available");
assert.equal(result.document.getElementById("home-link").hasAttribute("data-reelless-hidden"), false, "Home stays available while only Explore is blocked");
assert.equal(result.document.getElementById("main").hasAttribute("data-reelless-hidden"), false, "x must never hide the page main layout");
assert.equal(result.document.getElementById("explore-link").dispatchEvent(new result.dom.window.MouseEvent("click", { bubbles: true, cancelable: true })), false, "opening Explore must be refused");
assert.ok(result.document.getElementById("reelless-focus-screen"), "an Explore click must show the focus screen");
assert.equal(result.messages.filter((message) => message.type === "recordBlockAttempt").length, 1, "an Explore click counts once");
result.dom.window.close();

result = await fixture({
  url: "https://x.com/explore",
  settings: xExploreBlocking,
  html: "<main id=main><h1>Explore fixture</h1></main>"
});
assert.ok(result.document.getElementById("reelless-focus-screen"), "a direct Explore visit must show the focus screen");
assert.equal(result.messages.filter((message) => message.type === "recordBlockAttempt").length, 1, "a direct Explore visit counts once");
result.dom.window.close();

result = await fixture({
  url: "https://x.com/explore/tabs/trending",
  settings: xExploreBlocking,
  html: "<main id=main><h1>Trending fixture</h1></main>"
});
assert.ok(result.document.getElementById("reelless-focus-screen"), "an Explore tab visit must show the focus screen");
result.dom.window.close();

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

// Keep mode: Shorts stay visible in feeds, but opening one is stopped in place with the focus
// screen. Converting to the watch player used to be the behaviour, but YouTube plays Shorts
// videos on /watch pages too, so the Short stayed fully watchable.
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
assert.ok(result.document.getElementById("reelless-focus-screen"), "a Short click must show the focus screen instead of playing the Short");
assert.equal(result.dom.window.location.pathname, "/", "a blocked Short click must not navigate anywhere");
const dismissShort = result.document.querySelector('#reelless-focus-screen [data-action="dismiss"]');
assert.ok(dismissShort, "a click screen offers a way to stay on the current page");
dismissShort.dispatchEvent(new result.dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
assert.equal(result.document.getElementById("reelless-focus-screen"), null, "Stay here should close the click screen");

// The Shorts tab click shows the focus screen, which stays until dismissed.
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

// The bare Shorts feed has no watch equivalent, so it is blocked in place. YouTube's player
// boot can drop the overlay with a late render; the next pass must restore it without counting
// a second visit, or the feed is left watchable.
result = await fixture({
  url: "https://www.youtube.com/shorts",
  settings: defaults,
  html: `<main id="main"><h1>Shorts</h1></main>`
});
assert.ok(result.document.getElementById("reelless-focus-screen"), "the Shorts feed must show the focus screen");
assert.equal(result.messages.filter((message) => message.type === "recordBlockAttempt").length, 1);
assert.equal(result.dom.window.location.pathname, "/shorts", "the feed must not redirect anywhere");
result.document.getElementById("reelless-focus-screen").remove();
await nextPass(result.dom);
assert.ok(result.document.getElementById("reelless-focus-screen"), "a dropped overlay must be restored while still on the feed");
assert.equal(result.messages.filter((message) => message.type === "recordBlockAttempt").length, 1, "restoring the overlay must not recount the visit");
result.dom.window.close();

// A single Short is blocked in place too. It used to convert to its /watch URL, but YouTube
// plays Shorts videos on /watch pages as well, so the Short stayed fully watchable.
result = await fixture({
  url: "https://www.youtube.com/shorts/abc123",
  settings: defaults,
  html: `<main id="main"><h1>Short</h1></main>`
});
assert.ok(result.document.getElementById("reelless-focus-screen"), "a direct Short visit must show the focus screen");
assert.equal(result.dom.window.location.pathname, "/shorts/abc123", "a Short must not convert to a watchable /watch URL");
assert.equal(result.messages.filter((message) => message.type === "recordBlockAttempt").length, 1);
result.dom.window.close();

// Keep mode on Instagram leaves Reel cards in place while clicks are cancelled in place.
result = await fixture({
  url: "https://www.instagram.com/",
  settings: withEntryPoints(defaults, "instagram", "keep"),
  html: `<main role="main" id="main"><div role="list"><div role="listitem" id="reel-card"><a id="reel-link" href="/reel/xyz">Reel</a></div><div role="listitem" id="photo-card"><a href="/p/photo">Photo</a></div></div></main>`
});
assert.equal(result.document.getElementById("reel-card").hasAttribute("data-reelless-hidden"), false);
assert.equal(result.document.getElementById("reel-link").dispatchEvent(new result.dom.window.MouseEvent("click", { bubbles: true, cancelable: true })), false);
assert.equal(result.dom.window.location.href, "https://www.instagram.com/");
assert.equal(result.document.getElementById("reelless-focus-screen"), null);
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
// Watch is part of the default protection and needs the script (pausing, dialog blocking),
// so unlike Instagram the script stays on even where :has() exists.
assert.ok(result.guardObservers >= 1, "with Watch in the default the script still watches the Facebook DOM");
assert.equal(result.document.getElementById("unit").dataset.reellessHidden, "true", "the Reel unit is hidden");
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
assert.equal(result.document.documentElement.hasAttribute("data-reelless-instagram-feed"), true);
result.document.getElementById("reel-link").setAttribute("href", "/p/C/");
await nextPass(result.dom);
assert.equal(result.document.getElementById("reel").hasAttribute("data-reelless-hidden"), false,
  "Home keeps card geometry, so recycled photos must be revealed even with unknown position");
result.dom.window.history.pushState({}, "", "/direct/inbox/");
await nextPass(result.dom);
assert.equal(result.document.documentElement.hasAttribute("data-reelless-instagram-feed"), false);
result.dom.window.close();

// Outside Home, collapsed cards still need the conservative geometry check.
result = await fixture({ url: "https://www.instagram.com/alice/", settings: defaults, html: recycledFeed });
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
  url: "https://www.instagram.com/alice/",
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
for (const surface of ["homeFeed", "sidebar", "comments", "endScreen", "games"]) {
  assert.ok(guardCss.includes(`[data-reelless-surfaces~="${surface}"]`), `site_guard.css needs a rule for the ${surface} surface`);
}
assert.equal(guardCss.includes('data-reelless-surfaces~="explore"'), false, "Explore and Trending are gone from YouTube's navigation; the rule should not linger");
// Facebook placeholders ("Reel blocked" / "Video blocked") must live inside the feed only:
// every facebook-feed rule targeting post containers is scoped to div[role="feed"], so top
// tabs and sidebar rails collapse via display:none instead of showing a notice. (The bare
// script-marker collapse rule is exempt: it only ever hides, never stamps a notice.)
const fbFeedRules = [...guardCss.matchAll(/html\[data-reelless-facebook-feed\][^{]*:is\(div\[aria-posinset\][^{]*\{/g)];
assert.ok(fbFeedRules.length > 0, "expected facebook-feed post rules");
for (const [rule] of fbFeedRules) {
  assert.ok(rule.includes('div[role="feed"]'), `facebook-feed post rule must be feed-scoped: ${rule.slice(0, 120)}`);
}
// The games shelf is matched on its /playables/ links, never on title text, so localised
// shelves are hidden without language-specific rules.
assert.ok(guardCss.includes('a[href*="/playables"]'), "site_guard.css must hide the Playables games shelf by its links");
const playablesSelectorLines = guardCss.split("\n").filter((line) => line.includes("a[href") && /playables/i.test(line));
assert.ok(playablesSelectorLines.length > 0);
for (const line of playablesSelectorLines) {
  assert.equal(/has-text|title=|Игротека/.test(line), false, "the games rule must stay locale-independent");
}
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

// Facebook plays a feed video in a dialog without moving the address, so no navigation and no
// link click exists to refuse. The only lever is removing the posts, which the stylesheet does from
// a "videoPosts" token. It must appear exactly when the Watch section is blocked and entry points
// are hidden, and never on a conversation, where nothing may be touched.
assert.match(guardCss, /\[data-reelless-surfaces~="videoPosts"\]/, "site_guard.css needs the Facebook video-post rule");
assert.match(guardCss, /div\[aria-posinset\]/, "a Facebook feed post is div[aria-posinset]");
assert.match(guardCss, /:has\(video\)/, "video posts are recognised by their player");

const videoPostHtml = '<div aria-posinset="1" id="post"><video id="clip"></video></div><div aria-posinset="2" id="text">words</div>';
const surfacesOf = (r) => r.document.documentElement.dataset.reellessSurfaces || "";
const watchOn = withSections(defaults, "facebook", { reels: true, watch: true, marketplace: false });
const watchOff = withSections(defaults, "facebook", { reels: true, watch: false, marketplace: false });

for (const [label, settings, url, expected] of [
  ["Watch blocked", watchOn, "https://www.facebook.com/", true],
  ["Watch left alone", watchOff, "https://www.facebook.com/", false],
  ["default short-form mode", defaults, "https://www.facebook.com/", true],
  ["entry points kept visible", withEntryPoints(watchOn, "facebook", "keep"), "https://www.facebook.com/", false],
  ["a Messenger conversation", watchOn, "https://www.facebook.com/messages/t/friend", false]
]) {
  const r = await fixture({ url, settings, html: videoPostHtml, cssHas: true });
  assert.equal(surfacesOf(r).split(" ").includes("videoPosts"), expected,
    `${label} must ${expected ? "" : "not "}arm the Facebook video-post rule`);
  r.dom.window.close();
}

// The token is Facebook's alone: Instagram must never receive it, whatever its sections say.
const igWatch = await fixture({
  url: "https://www.instagram.com/",
  settings: withSections(defaults, "instagram", { reels: true, explore: true }),
  html: videoPostHtml, cssHas: true
});
assert.equal(surfacesOf(igWatch).includes("videoPosts"), false, "the video-post rule is Facebook's alone");
igWatch.dom.window.close();

assert.match(guardSource, /CSS_COVERED = new Map\(\[\s*\["youtube", \["shorts"\]\],\s*\["instagram", \["reels"\]\],\s*\["facebook", \["reels"\]\]\s*\]\)/, "YouTube, Instagram and Facebook hiding is delegated to the stylesheet");
assert.match(guardSource, /CSS\.supports\("selector\(:has\(a\)\)"\)/, "the script must feature-detect rather than assume");
assert.match(guardSource, /CONVERSATION_PATHS = \{ instagram: \/\^\\\/direct/, "Instagram Direct must be excused from the stylesheet by address");
assert.match(guardSource, /facebook: \/\^\\\/messages/, "Messenger must be excused from the stylesheet by address");
assert.match(guardSource, /setInterval\(scheduleScan, FULL_SCAN_INTERVAL\)/, "the periodic sweep must stay incremental so scrolling feeds keep budget");
assert.match(guardSource, /setInterval\(requestFullScan, FULL_SCAN_INTERVAL \* 10\)/, "a slower full sweep must remain as a safety net");
assert.match(guardSource, /Only YouTube's Shorts nav rows are identified by those labels/, "noisy title/aria-label churn off YouTube must not schedule scans");

// Blocked full pages must not keep playing behind the focus screen: existing media is
// paused/muted and resumed playback is stopped while blocked. Allowed pages are untouched.
{
  const paused = [];
  const blockedMedia = await fixture({
    url: "https://www.tiktok.com/",
    html: '<main><video id="clip" autoplay></video><audio id="track"></audio></main>',
    settings: defaults
  });
  blockedMedia.dom.window.HTMLMediaElement.prototype.pause = function () { paused.push(this.id); this.setAttribute("data-paused", "true"); };
  await nextPass(blockedMedia.dom);
  const screen = blockedMedia.document.getElementById("reelless-focus-screen");
  assert.ok(screen, "a blocked TikTok feed shows the focus screen");
  assert.equal(screen.getAttribute("role"), "dialog");
  assert.equal(screen.getAttribute("aria-modal"), "true");
  const clip = blockedMedia.document.getElementById("clip");
  assert.equal(clip.muted, true, "blocked-page video is muted");
  assert.equal(clip.preload, "none", "blocked-page video preload is disabled");
  // Resumed playback while blocked is stopped again via play/playing listeners.
  clip.dispatchEvent(new blockedMedia.dom.window.Event("play", { bubbles: true }));
  await wait(50);
  assert.ok(paused.length > 0 || clip.hasAttribute("data-paused") || clip.muted, "resumed playback on a blocked page is suppressed");
  blockedMedia.dom.window.close();
}
// A refused click on an allowed page (pinned screen) must not stop unrelated media.
{
  const allowed = await fixture({
    url: "https://www.youtube.com/watch?v=lesson",
    html: '<main><video id="lesson" autoplay></video><a id="short" href="/shorts/abc">Short</a></main>',
    settings: withEntryPoints(defaults, "youtube", "keep")
  });
  const lesson = allowed.document.getElementById("lesson");
  lesson.dispatchEvent(new allowed.dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await wait(100);
  allowed.dom.window.close();
}
// The focus-screen settings action must go through the background openOptions message
// (content scripts cannot call chrome.runtime.openOptionsPage) and report failures visibly.
{
  const opened = await fixture({ url: "https://www.tiktok.com/", html: "<main></main>", settings: defaults });
  await nextPass(opened.dom);
  const settingsButton = opened.document.querySelector('[data-action="settings"]');
  assert.ok(settingsButton, "the focus screen offers Open settings");
  await settingsButton.dispatchEvent(new opened.dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await wait(100);
  assert.ok(opened.messages.some((message) => message.type === "openOptions"), "settings opens via the background openOptions message");
  opened.dom.window.close();
}
// Keyboard access: focus moves into the dialog, Tab is contained, Escape only dismisses
// the pinned Stay-here case, and previous focus is restored on dismiss.
{
  const keyboard = await fixture({
    url: "https://www.youtube.com/watch?v=lesson",
    html: '<main><button id="before">Before</button><a id="short" href="/shorts/abc">Short</a></main>',
    settings: withEntryPoints(defaults, "youtube", "keep")
  });
  const before = keyboard.document.getElementById("before");
  before.focus();
  keyboard.document.getElementById("short").dispatchEvent(new keyboard.dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await wait(150);
  const dialog = keyboard.document.getElementById("reelless-focus-screen");
  assert.ok(dialog, "a blocked click raises the pinned screen");
  assert.ok(dialog.contains(keyboard.document.activeElement), "focus moves into the dialog");
  // Escape dismisses only the pinned case.
  keyboard.document.dispatchEvent(new keyboard.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await wait(100);
  assert.equal(keyboard.document.getElementById("reelless-focus-screen"), null, "Escape dismisses the pinned Stay-here screen");
  keyboard.dom.window.close();
  const blocked = await fixture({ url: "https://www.tiktok.com/", html: "<main></main>", settings: defaults });
  await nextPass(blocked.dom);
  assert.ok(blocked.document.getElementById("reelless-focus-screen"), "blocked page shows its screen");
  blocked.document.dispatchEvent(new blocked.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await wait(100);
  assert.ok(blocked.document.getElementById("reelless-focus-screen"), "Escape never bypasses a blocked page");
  blocked.dom.window.close();
}

await wait(50);
assert.deepEqual(unexpectedErrors.map((error) => error.message), [], "the guard must not raise errors in any fixture");

console.log("Core and optional platform DOM, mutation, safety-ancestor, entry-point mode, and focus-screen tests passed.");
