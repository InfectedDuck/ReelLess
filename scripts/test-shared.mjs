import assert from "node:assert/strict";
import R from "../shared.js";

const at = (year, month, day, hour, minute = 0) => new Date(year, month - 1, day, hour, minute, 0, 0);

// "Always on" is a true always-active state, including both midnight boundaries.
const defaults = R.getDefaultSettings();
assert.equal(R.isScheduleActive(defaults, at(2026, 8, 31, 0, 0)), true);
assert.equal(R.isScheduleActive(defaults, at(2026, 8, 31, 23, 59)), true);
assert.equal(R.isScheduleActive(defaults, at(2026, 9, 1, 0, 0)), true);

// Cross-midnight schedules include the start and exclude the end.
const sleep = R.normalizeSettings({ schedulePreset: "custom", customStart: "22:00", customEnd: "07:00" });
assert.equal(R.isScheduleActive(sleep, at(2026, 8, 31, 21, 59)), false);
assert.equal(R.isScheduleActive(sleep, at(2026, 8, 31, 22, 0)), true);
assert.equal(R.isScheduleActive(sleep, at(2026, 9, 1, 6, 59)), true);
assert.equal(R.isScheduleActive(sleep, at(2026, 9, 1, 7, 0)), false);

// Pauses expire cleanly at their exact boundary.
const pauseEnd = at(2026, 8, 31, 12, 15);
const paused = R.normalizeSettings({ pausedUntil: pauseEnd.toISOString() });
assert.equal(R.isScheduleActive(paused, at(2026, 8, 31, 12, 14)), false);
assert.equal(R.isScheduleActive(paused, pauseEnd), true);
assert.equal(new Date(R.pauseUntil("tomorrow", at(2026, 8, 31, 23, 50))).getTime(), at(2026, 9, 1, 0, 0).getTime());

// v1 settings migrate to the current schema without losing advanced selections or custom entries.
const migrated = R.normalizeSettings({
  globalMode: "custom",
  schedule: { mode: "custom", customStart: "08:10", customEnd: "16:40" },
  platforms: {
    youtube: { mode: "off", sections: { shorts: false } },
    reddit: { mode: "selected", sections: { popular: true, shorts: false } }
  },
  customEntries: ["example.com/reels", "https://www.example.com/reels/", "invalid"]
});
assert.equal(migrated.schemaVersion, 11);
assert.equal(migrated.schedulePreset, "custom");
assert.equal(migrated.customStart, "08:10");
assert.equal(migrated.platforms.youtube.mode, "off");
assert.equal(migrated.platforms.reddit.mode, "selected");
assert.equal(migrated.platforms.reddit.sections.discovery, true);
assert.deepEqual(migrated.customEntries, ["example.com/reels", "www.example.com/reels"]);
assert.equal(migrated.appearance, "dark", "existing settings receive the dark appearance default");
assert.equal(R.normalizeSettings({ appearance: "light" }).appearance, "light");
assert.equal(R.normalizeSettings({ appearance: "system" }).appearance, "system");
assert.equal(R.normalizeSettings({ appearance: "unknown" }).appearance, "dark");

// v4 settings retain supported choices but lose the retired Direct-message field.
const v4DirectSetting = R.normalizeSettings({
  schemaVersion: 4,
  platforms: {
    instagram: { mode: "selected", sections: { reels: false, explore: true, direct_videos: true } },
    facebook: { mode: "selected", sections: { reels: false, watch: true, marketplace: false, direct_videos: true } }
  }
});
assert.equal(v4DirectSetting.schemaVersion, 11);
assert.deepEqual(v4DirectSetting.platforms.instagram.sections, { reels: false, home: false, explore: true, stories: false });
assert.deepEqual(v4DirectSetting.platforms.facebook.sections, { reels: false, watch: true, home: false, groups: false, stories: false, marketplace: false, events: false });
assert.equal(Object.hasOwn(v4DirectSetting.platforms.instagram.sections, "direct_videos"), false);
assert.equal(typeof R.shouldBlockDirectVideos, "undefined", "The retired Direct-message behavior must not remain public");

// v5 settings gain the entry-point choice with hiding as the default; explicit choices survive normalization.
const v5EntryPoints = R.normalizeSettings({
  schemaVersion: 5,
  platforms: {
    youtube: { mode: "shortform", sections: { shorts: true } },
    instagram: { mode: "shortform", entryPoints: "keep", sections: { reels: true, explore: false } },
    facebook: { mode: "shortform", entryPoints: "unexpected", sections: { reels: true } }
  }
});
assert.equal(v5EntryPoints.schemaVersion, 11);
assert.equal(v5EntryPoints.platforms.youtube.entryPoints, "hide", "existing settings keep hiding entry points");
assert.equal(v5EntryPoints.platforms.instagram.entryPoints, "keep");
assert.equal(v5EntryPoints.platforms.facebook.entryPoints, "hide", "unknown values fall back to hiding");
assert.equal(v5EntryPoints.platforms.tiktok.entryPoints, "hide");
assert.deepEqual(R.ENTRY_POINT_MODES.map((mode) => mode.value), ["hide", "keep"]);
assert.equal(R.hidesEntryPoints(v5EntryPoints, "youtube"), true);
assert.equal(R.hidesEntryPoints(v5EntryPoints, R.platformById("instagram")), false, "keep mode leaves entry points visible");
assert.equal(R.hidesEntryPoints(R.normalizeSettings({ platforms: { youtube: { mode: "off" } } }), "youtube"), false, "an Off platform hides nothing");
// Keep mode changes only what is hidden, never what can be opened.
assert.equal(R.shouldBlockUrl(v5EntryPoints, "https://www.instagram.com/reels/abc").blocked, true);
assert.equal(R.shouldBlockUrl(v5EntryPoints, "https://www.youtube.com/shorts/abc").blocked, true);

// Optional YouTube surfaces are a separate axis from sections: they quieten parts of a page that
// stays reachable, and they never affect what shouldBlockUrl decides.
const youtube = R.platformById("youtube");
assert.deepEqual(youtube.surfaces.map((s) => s.id), ["homeFeed", "sidebar", "comments", "endScreen", "games"]);
assert.ok(youtube.surfaces.every((s) => defaults.platforms.youtube.surfaces[s.id] === false), "every surface must start off");
assert.deepEqual(R.activeSurfaces(defaults, "youtube"), [], "nothing is quietened until asked for");

const quiet = R.normalizeSettings({ platforms: { youtube: { mode: "shortform", surfaces: { homeFeed: true, comments: true } } } });
assert.deepEqual(R.activeSurfaces(quiet, "youtube"), ["homeFeed", "comments"]);
assert.deepEqual(R.activeSurfaces(quiet, "instagram"), [], "platforms without surfaces report none");
assert.equal(R.shouldBlockUrl(quiet, "https://www.youtube.com/").blocked, false, "quietening the home feed must not block the page");
assert.equal(R.shouldBlockUrl(quiet, "https://www.youtube.com/watch?v=abc").blocked, false);

const quietOff = R.normalizeSettings({ platforms: { youtube: { mode: "off", surfaces: { homeFeed: true } } } });
assert.deepEqual(R.activeSurfaces(quietOff, "youtube"), [], "a platform switched off quietens nothing");
const quietPaused = R.normalizeSettings({ protectionEnabled: false, platforms: { youtube: { mode: "shortform", surfaces: { homeFeed: true } } } });
assert.deepEqual(R.activeSurfaces(quietPaused, "youtube"), [], "paused protection quietens nothing");

// v6 settings gain the surfaces map without losing anything, and every surface arrives off.
const v6 = R.normalizeSettings({ schemaVersion: 6, platforms: { youtube: { mode: "shortform", entryPoints: "keep", sections: { shorts: true } } } });
assert.equal(v6.schemaVersion, 11);
assert.equal(v6.platforms.youtube.entryPoints, "keep", "the entry-point choice survives the migration");
assert.deepEqual(v6.platforms.youtube.surfaces, { homeFeed: false, sidebar: false, comments: false, endScreen: false, games: false });

// Ultimate Lock forces always-on protection and restores its saved platform snapshot if settings are tampered with.
const ultimate = R.createUltimateSettings(R.normalizeSettings({
  platforms: { instagram: { mode: "off" }, reddit: { mode: "selected", sections: { popular: true } } }
}), "keep_current");
assert.equal(ultimate.ultimate.enabled, true);
assert.equal(ultimate.schedulePreset, "always");
assert.equal(ultimate.platforms.instagram.mode, "off");
const tamperedUltimate = R.normalizeSettings({ ...ultimate, protectionEnabled: false, schedulePreset: "work_hours", platforms: { instagram: { mode: "all" } } });
assert.equal(tamperedUltimate.protectionEnabled, true);
assert.equal(tamperedUltimate.pausedUntil, null);
assert.equal(tamperedUltimate.schedulePreset, "always");
assert.equal(tamperedUltimate.platforms.instagram.mode, "off");
const coreUltimate = R.createUltimateSettings(R.normalizeSettings({ platforms: { youtube: { mode: "off" }, tiktok: { mode: "off" } } }), "block_shortform");
assert.equal(coreUltimate.platforms.youtube.mode, "shortform");
assert.equal(coreUltimate.platforms.tiktok.mode, "shortform");
assert.equal(R.releaseUltimateSettings(coreUltimate).ultimate.enabled, false);
const keepUltimate = R.createUltimateSettings(R.normalizeSettings({ platforms: { youtube: { mode: "shortform", entryPoints: "keep" } } }), "keep_current");
assert.equal(keepUltimate.platforms.youtube.entryPoints, "keep", "the lock snapshot keeps the entry-point choice");
assert.equal(R.normalizeSettings({ ...keepUltimate, platforms: { youtube: { mode: "shortform", entryPoints: "hide" } } }).platforms.youtube.entryPoints, "keep", "tampering cannot change a locked entry-point choice");

// Statistics roll over locally without retaining URLs, titles, or history.
assert.deepEqual(R.normalizeStats({ localDay: "2026-08-30", todayCount: 9, totalCount: 41 }, at(2026, 8, 31, 0, 0)), {
  localDay: "2026-08-31", todayCount: 0, totalCount: 41
});
assert.deepEqual(Object.keys(R.normalizeStats({}, at(2026, 8, 31, 0, 0))), ["localDay", "todayCount", "totalCount"]);

// Core URL decisions use navigation guards, not DNR redirects.
assert.equal(R.shouldBlockUrl(defaults, "https://www.youtube.com/shorts/abc").blocked, true);
assert.equal(R.shouldBlockUrl(defaults, "https://www.youtube.com/@study/shorts").blocked, true);
assert.equal(R.shouldBlockUrl(defaults, "https://www.youtube.com/watch?v=abc").blocked, false);
assert.equal(R.shouldBlockUrl(defaults, "https://www.instagram.com/reels/abc").blocked, true);
assert.equal(R.shouldBlockUrl(defaults, "https://www.instagram.com/direct/inbox/").blocked, false);
assert.equal(R.shouldBlockUrl(defaults, "https://www.facebook.com/reel/abc").blocked, true);
assert.equal(R.platformForUrl("https://www.messenger.com/t/friend"), null, "Messenger must remain outside ReelLess site access");
// TikTok defaults to shortform so utilities stay available; feed/video pages are still blocked.
assert.equal(R.shouldBlockUrl(defaults, "https://www.tiktok.com/messages").blocked, false);
assert.equal(R.shouldBlockUrl(defaults, "https://www.tiktok.com/").blocked, true);
// Shorts are never converted to watch URLs: YouTube plays Shorts videos on /watch pages too,
// so a conversion would leave the Short fully watchable. Blocked Shorts stop in place instead.
assert.equal(R.youtubeWatchUrl, undefined, "the Shorts-to-watch conversion must stay removed");

// Handle-scoped entry points reach the same players as the canonical paths, so they must be
// matched too. Each of these leaked before the section patterns were introduced.
const handleRoutes = [
  ["https://www.youtube.com/@mkbhd/shorts", true, "shorts"],
  ["https://www.instagram.com/nasa/reels/", true, "reels"],
  ["https://www.instagram.com/nasa/reel/", true, "reels"],
  ["https://www.tiktok.com/@charlidamelio", true, "videos"],
  ["https://www.tiktok.com/@charlidamelio/video/123", true, "videos"]
];
for (const [url, blocked, sectionId] of handleRoutes) {
  const decision = R.shouldBlockUrl(defaults, url);
  assert.equal(decision.blocked, blocked, `${url} should be blocked by default`);
  assert.equal(decision.section && decision.section.id, sectionId, `${url} should resolve to the ${sectionId} section`);
}

// The same patterns must not swallow ordinary pages that merely start with a handle or username.
const preserved = [
  "https://www.youtube.com/@mkbhd",
  "https://www.youtube.com/@mkbhd/videos",
  "https://www.instagram.com/nasa/",
  "https://www.instagram.com/p/photo123/",
  "https://www.instagram.com/direct/inbox/",
  "https://www.facebook.com/nasa/"
];
for (const url of preserved) {
  assert.equal(R.shouldBlockUrl(defaults, url).blocked, false, `${url} must stay available`);
}

// X v8: remove video URL guesses, migrate Explore without broadening restrictions, including locks.
assert.deepEqual(defaults.platforms.x, { mode: "off", lastEnabledMode: "off", entryPoints: "hide", sections: { home: false, explore: false, notifications: false, messages: false, communities: false, grok: false }, surfaces: { xExplore: false, xSidebar: false } });
const oldX = { mode: "selected", entryPoints: "keep", sections: { home: true, explore: true, video: true } };
const migratedX = R.normalizeSettings({ schemaVersion: 7, platforms: { x: oldX } });
assert.deepEqual(migratedX.platforms.x, { mode: "selected", lastEnabledMode: "selected", entryPoints: "keep", sections: { home: true, explore: false, notifications: false, messages: false, communities: false, grok: false }, surfaces: { xExplore: true, xSidebar: false } });
assert.deepEqual(R.normalizeSettings(migratedX), migratedX, "migration is idempotent");
const lockedX = R.normalizeSettings({ schemaVersion: 7, platforms: { x: { mode: "off" } }, ultimate: { enabled: true, profile: "keep_current", lockedPlatforms: { x: oldX } } });
assert.deepEqual(lockedX.platforms.x, migratedX.platforms.x);
assert.deepEqual(lockedX.ultimate.lockedPlatforms.x, migratedX.platforms.x);
assert.equal(lockedX.ultimate.enabled, true);
for (const value of ["shortform", { ...oldX, mode: "shortform" }]) {
  const migrated = R.normalizeSettings({ schemaVersion: 7, platforms: { x: value } });
  assert.equal(migrated.platforms.x.mode, "off");
  assert.deepEqual(R.activeSurfaces(migrated, "x"), []);
}
const videoOnly = R.normalizeSettings({ schemaVersion: 7, platforms: { x: { mode: "selected", sections: { video: true } } } });
assert.equal(videoOnly.platforms.x.sections.home, false);
assert.deepEqual(videoOnly.platforms.x.surfaces, { xExplore: false, xSidebar: false });
for (const host of ["x.com", "www.x.com", "twitter.com", "mobile.twitter.com"]) {
  for (const path of ["/", "/home", "/home/"]) assert.equal(R.shouldBlockUrl(migratedX, `https://${host}${path}`).blocked, true);
  for (const path of ["/explore", "/explore/tabs/trending", "/search?q=work", "/notifications", "/messages", "/i/chat", "/i/chat/abc123", "/friend", "/friend/status/123", "/i/status/123", "/video/123", "/i/bookmarks", "/i/lists/123", "/compose/post"]) {
    assert.equal(R.shouldBlockUrl(migratedX, `https://${host}${path}`).blocked, false, `${path} must remain available`);
  }
}

// X Explore page blocking is opt-in and never enabled by the legacy recommendation flag.
const explorePage = R.normalizeSettings({ platforms: { x: { mode: "selected", sections: { home: false, explore: true }, surfaces: { xExplore: false, xSidebar: false } } } });
assert.equal(explorePage.platforms.x.sections.explore, true, "an explicit Explore page choice in the current shape must survive");
for (const path of ["/explore", "/explore/", "/explore/tabs/trending", "/explore/tabs/for-you"]) {
  const decision = R.shouldBlockUrl(explorePage, `https://x.com${path}`);
  assert.equal(decision.blocked, true, `${path} is the Explore discovery page`);
  assert.equal(decision.section.id, "explore");
}
for (const path of ["/", "/home", "/search?q=work", "/notifications", "/messages", "/i/chat", "/friend", "/friend/status/123", "/i/bookmarks"]) {
  assert.equal(R.shouldBlockUrl(explorePage, `https://x.com${path}`).blocked, false, `${path} stays available while only Explore is blocked`);
}
assert.equal(R.sectionBlocked(explorePage, "x", "explore"), true);
assert.equal(R.sectionBlocked(migratedX, "x", "explore"), false, "legacy recommendation hiding must not become page blocking");

// Reddit v9 replaces two guessed video-community URLs with intentional focus controls.
assert.deepEqual(defaults.platforms.reddit, { mode: "off", lastEnabledMode: "off", entryPoints: "hide", sections: { home: false, discovery: false, chat: false, notifications: false, inbox: false }, surfaces: { redditSidebar: false } });
const oldReddit = { mode: "selected", entryPoints: "keep", sections: { popular: true, all: false, shorts: true } };
const migratedReddit = R.normalizeSettings({ schemaVersion: 8, platforms: { reddit: oldReddit } });
assert.deepEqual(migratedReddit.platforms.reddit, { mode: "selected", lastEnabledMode: "selected", entryPoints: "keep", sections: { home: false, discovery: true, chat: false, notifications: false, inbox: false }, surfaces: { redditSidebar: false } });
assert.deepEqual(R.normalizeSettings(migratedReddit), migratedReddit, "Reddit migration is idempotent");
for (const value of ["shortform", { mode: "shortform", sections: { shorts: true } }]) {
  const retired = R.normalizeSettings({ schemaVersion: 8, platforms: { reddit: value } });
  assert.equal(retired.platforms.reddit.mode, "off");
  assert.deepEqual(retired.platforms.reddit.sections, { home: false, discovery: false, chat: false, notifications: false, inbox: false });
}
const redditFocus = R.normalizeSettings({ platforms: { reddit: { mode: "selected", sections: { home: true, discovery: true }, surfaces: { redditSidebar: true } } } });
for (const url of ["https://www.reddit.com/", "https://www.reddit.com/?feed=home", "https://reddit.com/?feed=following"]) {
  assert.equal(R.shouldBlockUrl(redditFocus, url).section.id, "home", `${url} is Home`);
}
for (const url of ["https://www.reddit.com/r/popular/", "https://www.reddit.com/r/all/", "https://www.reddit.com/news/", "https://www.reddit.com/explore/", "https://www.reddit.com/?feed=news", "https://reddit.com/?feed=popular"]) {
  const decision = R.shouldBlockUrl(redditFocus, url);
  assert.equal(decision.blocked, true, `${url} is a discovery feed`);
  assert.equal(decision.section.id, "discovery");
}
for (const url of ["https://www.reddit.com/r/codex/", "https://www.reddit.com/r/codex/comments/abc/post/", "https://www.reddit.com/search/?q=focus", "https://www.reddit.com/notifications", "https://www.reddit.com/chat", "https://www.reddit.com/user/me/saved/"]) {
  assert.equal(R.shouldBlockUrl(redditFocus, url).blocked, false, `${url} stays available`);
}
assert.deepEqual(R.activeSurfaces(redditFocus, "reddit"), ["redditSidebar"]);

// Checklist sections stay opt-in: every section beyond the short-form defaults arrives off,
// each with a description naming the tab it removes so the checklist explains itself.
assert.deepEqual(R.platformById("youtube").sections.map((section) => section.id), ["shorts", "home", "trending", "subscriptions", "gaming"]);
assert.deepEqual(R.platformById("instagram").sections.map((section) => section.id), ["reels", "home", "explore", "stories"]);
assert.deepEqual(R.platformById("facebook").sections.map((section) => section.id), ["reels", "watch", "home", "groups", "stories", "marketplace", "events"]);
assert.deepEqual(R.platformById("tiktok").sections.map((section) => section.id), ["feed", "videos", "live", "messages", "upload", "settings"]);
assert.deepEqual(R.platformById("x").sections.map((section) => section.id), ["home", "explore", "notifications", "messages", "communities", "grok"]);
assert.deepEqual(R.platformById("snapchat").sections.map((section) => section.id), ["spotlight", "stories"]);
assert.deepEqual(R.platformById("twitch").sections.map((section) => section.id), ["home", "directory", "clips", "videos", "drops"]);
assert.deepEqual(R.platformById("pinterest").sections.map((section) => section.id), ["home", "explore", "search"]);
assert.deepEqual(R.platformById("linkedin").sections.map((section) => section.id), ["feed", "videos", "notifications", "messaging", "network"]);
assert.deepEqual(R.platformById("threads").sections.map((section) => section.id), ["feed", "activity"]);
assert.deepEqual(R.platformById("reddit").sections.map((section) => section.id), ["home", "discovery", "chat", "inbox", "notifications"]);
for (const platform of R.PLATFORMS) {
  for (const section of platform.sections) {
    assert.equal(typeof section.label, "string", `${platform.id}.${section.id} needs a checklist label`);
    assert.ok(section.description && section.description.length > 10, `${platform.id}.${section.id} needs an explanatory description`);
    assert.equal(defaults.platforms[platform.id].sections[section.id], Boolean(section.shortform),
      `${platform.id}.${section.id} defaults to ${section.shortform ? "blocked" : "allowed"}`);
  }
}
assert.deepEqual(R.platformById("threads").hosts, ["threads.com", "threads.net"]);
assert.ok(R.platformById("twitch").permissionPatterns.includes("https://clips.twitch.tv/*"));

const oldOptional = R.normalizeSettings({ schemaVersion: 9, platforms: {
  snapchat: { mode: "selected", sections: { spotlight: true, stories: true } },
  twitch: { mode: "selected", sections: { directory: true, clips: true, videos: true } },
  pinterest: { mode: "shortform", sections: { watch: true, ideas: true, pins: false } },
  linkedin: { mode: "selected", sections: { feed: true, video: true, jobs: true } },
  threads: { mode: "selected", sections: { feed: true, search: true, media: true } }
} });
assert.deepEqual(oldOptional.platforms.snapchat.sections, { spotlight: true, stories: true });
assert.deepEqual(oldOptional.platforms.twitch.sections, { home: false, directory: true, clips: true, videos: true, drops: false }, "the retired Videos choice carries onto channel video archives");
assert.deepEqual(oldOptional.platforms.pinterest.sections, { home: false, explore: true, search: false });
assert.equal(oldOptional.platforms.pinterest.mode, "selected");
assert.deepEqual(oldOptional.platforms.linkedin.sections, { feed: true, videos: false, notifications: false, messaging: false, network: false });
assert.deepEqual(oldOptional.platforms.threads.sections, { feed: true, activity: false });
const lockedOptional = R.normalizeSettings({ schemaVersion: 9, ultimate: {
  enabled: true, profile: "keep_current", lockedPlatforms: {
    snapchat: { mode: "selected", sections: { spotlight: true, stories: true } },
    twitch: { mode: "selected", sections: { directory: true, clips: true, videos: true } },
    pinterest: { mode: "shortform", sections: { watch: true, ideas: true } },
    linkedin: { mode: "selected", sections: { feed: true, video: true, jobs: true } },
    threads: { mode: "selected", sections: { feed: true, search: true, media: true } }
  }
} });
for (const id of ["snapchat", "twitch", "pinterest", "linkedin", "threads"]) {
  assert.deepEqual(lockedOptional.ultimate.lockedPlatforms[id], oldOptional.platforms[id], `${id} locked snapshot migrates`);
  assert.deepEqual(lockedOptional.platforms[id], oldOptional.platforms[id], `${id} lock remains enforced`);
}
for (const id of ["linkedin", "threads"]) {
  assert.equal(R.normalizeSettings({ schemaVersion: 9, platforms: { [id]: { mode: "shortform" } } }).platforms[id].mode, "off");
}

const focusedOptional = R.normalizeSettings({ platforms: {
  snapchat: { mode: "selected", sections: { spotlight: true, stories: false } },
  twitch: { mode: "selected", sections: { home: true, directory: true, clips: true } },
  pinterest: { mode: "selected", sections: { home: true, explore: true } },
  linkedin: { mode: "selected", sections: { feed: true } },
  threads: { mode: "selected", sections: { feed: true } }
} });
// Stories are opt-in: Spotlight-only leaves Stories available, Stories-checked blocks them.
const storiesOptional = R.normalizeSettings({ platforms: {
  snapchat: { mode: "selected", sections: { spotlight: false, stories: true } },
  instagram: { mode: "selected", sections: { reels: false, explore: false, stories: true } },
  facebook: { mode: "selected", sections: { reels: false, watch: false, stories: true, marketplace: false } }
} });
assert.equal(R.shouldBlockUrl(storiesOptional, "https://www.snapchat.com/stories/abc").blocked, true);
assert.equal(R.shouldBlockUrl(focusedOptional, "https://www.snapchat.com/stories/abc").blocked, false);
assert.equal(R.shouldBlockUrl(storiesOptional, "https://www.instagram.com/stories/user/123/").blocked, true);
assert.equal(R.shouldBlockUrl(defaults, "https://www.instagram.com/stories/user/123/").blocked, false, "Stories stay allowed by default");
assert.equal(R.shouldBlockUrl(storiesOptional, "https://www.facebook.com/stories/123/").blocked, true);
assert.equal(R.shouldBlockUrl(storiesOptional, "https://www.facebook.com/story.php?story_fbid=123").blocked, true);
assert.equal(R.shouldBlockUrl(defaults, "https://www.facebook.com/stories/123/").blocked, false, "Stories stay allowed by default");
assert.equal(R.shouldBlockUrl(defaults, "https://www.instagram.com/").blocked, false);
assert.equal(R.shouldBlockUrl(defaults, "https://www.facebook.com/").blocked, false);
const optionalRoutes = [
  ["snapchat", ["https://www.snapchat.com/spotlight/abc"], ["https://www.snapchat.com/stories", "https://web.snapchat.com/"]],
  ["twitch", ["https://www.twitch.tv/", "https://www.twitch.tv/directory", "https://www.twitch.tv/clips/abc", "https://clips.twitch.tv/FancySlug"], ["https://www.twitch.tv/following", "https://www.twitch.tv/somechannel", "https://www.twitch.tv/somechannel/videos", "https://dashboard.twitch.tv/"]],
  ["pinterest", ["https://www.pinterest.com/", "https://www.pinterest.com/ideas/", "https://www.pinterest.com/explore/"], ["https://www.pinterest.com/pin/123/", "https://www.pinterest.com/search/pins/?q=desk", "https://www.pinterest.com/user/board/"]],
  ["linkedin", ["https://www.linkedin.com/feed/"], ["https://www.linkedin.com/jobs/", "https://www.linkedin.com/messaging/", "https://www.linkedin.com/in/person/", "https://www.linkedin.com/video/123"]],
  ["threads", ["https://www.threads.com/", "https://www.threads.net/"], ["https://www.threads.com/search", "https://www.threads.com/@person/post/abc", "https://www.threads.com/activity", "https://www.threads.com/saved", "https://www.threads.com/@person/media"]]
];
for (const [id, blockedUrls, allowedUrls] of optionalRoutes) {
  for (const url of blockedUrls) assert.equal(R.shouldBlockUrl(focusedOptional, url).blocked, true, `${id}: ${url} should be blocked`);
  for (const url of allowedUrls) assert.equal(R.shouldBlockUrl(focusedOptional, url).blocked, false, `${id}: ${url} should stay available`);
}

// Every new checklist tab resolves to its own section, blocks only when checked, and leaves
// the platform's ordinary pages alone. Each entry enables a single section on top of defaults.
const newSectionRoutes = [
  ["youtube", "home", ["https://www.youtube.com/"], ["https://www.youtube.com/watch?v=abc", "https://www.youtube.com/shorts/abc", "https://www.youtube.com/feed/trending"]],
  ["youtube", "trending", ["https://www.youtube.com/feed/trending", "https://www.youtube.com/trending"], ["https://www.youtube.com/", "https://www.youtube.com/watch?v=abc"]],
  ["youtube", "subscriptions", ["https://www.youtube.com/feed/subscriptions"], ["https://www.youtube.com/", "https://www.youtube.com/watch?v=abc", "https://www.youtube.com/feed/trending"]],
  ["youtube", "gaming", ["https://www.youtube.com/gaming", "https://www.youtube.com/gaming/game/123"], ["https://www.youtube.com/", "https://www.youtube.com/watch?v=abc"]],
  ["instagram", "home", ["https://www.instagram.com/"], ["https://www.instagram.com/nasa/", "https://www.instagram.com/p/photo123/", "https://www.instagram.com/reels/abc"]],
  ["facebook", "home", ["https://www.facebook.com/"], ["https://www.facebook.com/nasa/", "https://www.facebook.com/reel/abc", "https://www.facebook.com/groups/123/"]],
  ["facebook", "groups", ["https://www.facebook.com/groups/", "https://www.facebook.com/groups/123/"], ["https://www.facebook.com/", "https://www.facebook.com/marketplace/"]],
  ["facebook", "events", ["https://www.facebook.com/events/", "https://www.facebook.com/events/123/"], ["https://www.facebook.com/", "https://www.facebook.com/groups/123/"]],
  ["tiktok", "live", ["https://www.tiktok.com/live", "https://www.tiktok.com/live/tag/x"], ["https://www.tiktok.com/messages", "https://www.tiktok.com/@user"]],
  ["x", "notifications", ["https://x.com/notifications"], ["https://x.com/home", "https://x.com/explore", "https://x.com/messages", "https://x.com/i/chat"]],
  ["x", "messages", ["https://x.com/messages", "https://twitter.com/messages/inbox", "https://x.com/i/chat", "https://x.com/i/chat/abc123"], ["https://x.com/home", "https://x.com/notifications"]],
  ["x", "communities", ["https://x.com/i/communities", "https://x.com/i/communities/123"], ["https://x.com/home", "https://x.com/explore"]],
  ["x", "grok", ["https://x.com/i/grok"], ["https://x.com/home", "https://x.com/notifications"]],
  ["reddit", "chat", ["https://www.reddit.com/chat"], ["https://www.reddit.com/", "https://www.reddit.com/r/codex/comments/abc/post/"]],
  ["reddit", "notifications", ["https://www.reddit.com/notifications"], ["https://www.reddit.com/", "https://www.reddit.com/chat"]],
  ["reddit", "inbox", ["https://www.reddit.com/message/inbox", "https://old.reddit.com/message/inbox"], ["https://www.reddit.com/", "https://www.reddit.com/chat", "https://www.reddit.com/r/codex/comments/abc/post/"]],
  ["twitch", "videos", ["https://www.twitch.tv/somechannel/videos", "https://www.twitch.tv/somechannel/videos/abc"], ["https://www.twitch.tv/somechannel", "https://www.twitch.tv/somechannel/clips", "https://clips.twitch.tv/FancySlug", "https://dashboard.twitch.tv/"]],
  ["twitch", "drops", ["https://www.twitch.tv/drops", "https://www.twitch.tv/drops/campaigns"], ["https://www.twitch.tv/", "https://www.twitch.tv/directory", "https://www.twitch.tv/somechannel"]],
  ["pinterest", "search", ["https://www.pinterest.com/search/pins/?q=desk"], ["https://www.pinterest.com/pin/123/", "https://www.pinterest.com/", "https://www.pinterest.com/user/board/"]],
  ["linkedin", "videos", ["https://www.linkedin.com/video/123"], ["https://www.linkedin.com/feed/", "https://www.linkedin.com/jobs/"]],
  ["linkedin", "notifications", ["https://www.linkedin.com/notifications/"], ["https://www.linkedin.com/feed/", "https://www.linkedin.com/messaging/"]],
  ["linkedin", "messaging", ["https://www.linkedin.com/messaging/", "https://www.linkedin.com/messaging/thread/123"], ["https://www.linkedin.com/feed/", "https://www.linkedin.com/jobs/"]],
  ["linkedin", "network", ["https://www.linkedin.com/mynetwork/", "https://www.linkedin.com/mynetwork/invites"], ["https://www.linkedin.com/feed/", "https://www.linkedin.com/messaging/"]],
  ["threads", "activity", ["https://www.threads.com/activity"], ["https://www.threads.com/", "https://www.threads.com/search"]]
];
for (const [platformId, sectionId, blockedUrls, allowedUrls] of newSectionRoutes) {
  const allOff = Object.fromEntries(R.platformById(platformId).sections.map((section) => [section.id, false]));
  const onlyThis = R.normalizeSettings({ platforms: { [platformId]: { mode: "selected", sections: { ...allOff, [sectionId]: true } } } });
  assert.equal(R.sectionBlocked(onlyThis, platformId, sectionId), true);
  for (const url of blockedUrls) {
    const decision = R.shouldBlockUrl(onlyThis, url);
    assert.equal(decision.blocked, true, `${platformId}.${sectionId}: ${url} should be blocked`);
    assert.equal(decision.section.id, sectionId, `${platformId}.${sectionId}: ${url} should resolve to ${sectionId}`);
  }
  for (const url of allowedUrls) {
    assert.equal(R.shouldBlockUrl(onlyThis, url).blocked, false, `${platformId}.${sectionId}: ${url} must stay available`);
  }
  // Defaults leave every new tab allowed.
  for (const url of blockedUrls) {
    assert.equal(R.shouldBlockUrl(defaults, url).blocked, false, `${platformId}.${sectionId}: ${url} stays allowed by default`);
  }
}

// Personal custom boundaries match their exact host (www is distinct) with an optional
// case-sensitive path prefix, never swallow platform hosts, and honor the global schedule.
assert.equal(R.matchCustomEntry("example.com/reels", "https://example.com/reels/123"), true);
assert.equal(R.matchCustomEntry("example.com/reels", "https://www.example.com/reels/"), false, "www is a distinct host");
assert.equal(R.matchCustomEntry("www.example.com/reels", "https://www.example.com/reels/"), true);
assert.equal(R.matchCustomEntry("example.com", "https://example.com/anything/here"), true);
assert.equal(R.matchCustomEntry("example.com/reels", "https://example.com/home"), false);
assert.equal(R.matchCustomEntry("example.com/reels", "https://other.com/reels/123"), false);
assert.equal(R.matchCustomEntry("example.com/reels", "https://example.com/reelsy/123"), false, "a path prefix must end at a boundary");
assert.equal(R.matchCustomEntry("m.example.com/feed", "https://m.example.com/feed/1"), true);
assert.equal(R.matchCustomEntry("not a url", "https://example.com/"), false);
// Path case is preserved: /Private and /private are different boundaries.
assert.equal(R.validateEntry("www.example.com/Private").value, "www.example.com/Private");
assert.equal(R.matchCustomEntry("example.com/Private", "https://example.com/Private/1"), true);
assert.equal(R.matchCustomEntry("example.com/Private", "https://example.com/private/1"), false, "paths are case-sensitive");
assert.equal(R.validateEntry("http://example.com/reels").ok, false, "explicit http URLs are rejected");
assert.equal(R.validateEntry("https://user:pass@example.com/").ok, false, "credentials are rejected");
assert.equal(R.validateEntry("example.com:8080/reels").ok, false, "ports are rejected");
assert.equal(R.validateEntry("example.com/reels?x=1").ok, false, "queries are rejected");
assert.equal(R.validateEntry("example.com/reels#x").ok, false, "fragments are rejected");
assert.equal(R.validateEntry("*.example.com").ok, false, "wildcards are rejected");
assert.equal(R.customEntryForUrl(["example.com/reels", "another.test/x"], "https://another.test/x/1"), "another.test/x");
assert.equal(R.customEntryForUrl(["example.com/reels"], "https://example.com/home"), null);
assert.equal(R.customScriptPattern("example.com/reels"), "https://example.com/*", "guards register host-wide so allowed pages detect SPA navigation");
assert.equal(R.customScriptPattern("example.com"), "https://example.com/*");
assert.equal(R.customScriptId("example.com/reels"), R.customScriptId("example.com/other"), "entries sharing one host share one guard");
assert.ok(R.customScriptId("example.com/reels") !== R.customScriptId("other.com/reels"), "different hosts stay distinct");
// Remembered modes: Off restores the last enabled mode instead of resetting.
const offOn = R.setPlatformEnabled(R.normalizeSettings({ platforms: { youtube: { mode: "all" } } }), "youtube", false);
assert.equal(offOn.platforms.youtube.mode, "off");
assert.equal(offOn.platforms.youtube.lastEnabledMode, "all");
const backOn = R.setPlatformEnabled(offOn, "youtube", true);
assert.equal(backOn.platforms.youtube.mode, "all", "switching back on restores the remembered mode");
// Effective status distinguishes off, paused, schedule, empty, and active.
assert.equal(R.getEffectiveStatus(R.normalizeSettings({ protectionEnabled: false }), at(2026, 8, 31, 12)).key, "off");
assert.equal(R.getEffectiveStatus(R.normalizeSettings({ pausedUntil: new Date(Date.now() + 60000).toISOString() })).key, "paused");
assert.equal(R.getEffectiveStatus(R.normalizeSettings({ schedulePreset: "always" }), at(2026, 8, 31, 12)).key, "active");
// Review URLs are never derived from runtime ids; unknown listings hide the action.
assert.equal(R.getReviewUrl("chrome"), null);
const customOnly = R.normalizeSettings({ customEntries: ["example.com/reels"] });
assert.equal(R.shouldBlockCustomUrl(customOnly, "https://example.com/reels/123").blocked, true);
assert.equal(R.shouldBlockCustomUrl(customOnly, "https://example.com/home").blocked, false);
assert.equal(R.shouldBlockCustomUrl(customOnly, "https://www.youtube.com/shorts/abc").blocked, false, "platform hosts stay under platform controls");
assert.equal(R.shouldBlockCustomUrl({ ...customOnly, protectionEnabled: false }, "https://example.com/reels/123").blocked, false, "pausing releases custom boundaries too");
assert.equal(R.shouldBlockCustomUrl(defaults, "https://example.com/reels/123").blocked, false, "no entries means nothing custom is blocked");

// TikTok's "/@" path prefix could never match a real profile URL, and the bug was masked by the
// platform defaulting to Block all. Narrowing the mode is what used to expose it.
const tiktokShortform = R.normalizeSettings({ platforms: { tiktok: { mode: "shortform" } } });
assert.equal(R.shouldBlockUrl(tiktokShortform, "https://www.tiktok.com/@charlidamelio").blocked, true);
assert.equal(R.shouldBlockUrl(tiktokShortform, "https://www.tiktok.com/messages").blocked, false);
assert.equal(
  R.platformById("tiktok").sections.find((section) => section.id === "videos").paths.includes("/@"),
  false,
  "the unreachable /@ path prefix should be gone"
);

// A page's Videos tab belongs to Watch, which is part of the default protection because feed
// videos autoplay in place like Reels. It can still be allowed via Selected sections.
const facebookWatch = R.normalizeSettings({ platforms: { facebook: { mode: "selected", sections: { reels: true, watch: true, marketplace: false } } } });
const facebookWatchOff = R.normalizeSettings({ platforms: { facebook: { mode: "selected", sections: { reels: true, watch: false, marketplace: false } } } });
assert.equal(R.shouldBlockUrl(defaults, "https://www.facebook.com/nasa/videos/").blocked, true, "Watch follows the default protection");
assert.equal(R.shouldBlockUrl(facebookWatch, "https://www.facebook.com/nasa/videos/").blocked, true);
assert.equal(R.shouldBlockUrl(facebookWatchOff, "https://www.facebook.com/nasa/videos/").blocked, false, "Watch can be allowed via Selected sections");
assert.equal(R.sectionForUrl(R.platformById("facebook"), new URL("https://www.facebook.com/nasa/videos/")).id, "watch");

// Every route that reaches a Facebook Reel must be recognised as Reels, or the default mode lets a
// Reel through. A shared Reel arrives as /share/r/, and a page's Reels tab begins with a page name.
const facebookSection = (path) => {
  const found = R.sectionForUrl(R.platformById("facebook"), new URL(`https://www.facebook.com${path}`));
  return found ? found.id : null;
};
for (const path of ["/reel/abc", "/reels/", "/watch/reels/abc", "/share/r/AbC123/", "/nasa/reels/", "/nasa/reel/"]) {
  assert.equal(facebookSection(path), "reels", `${path} is a Reels route`);
  assert.equal(R.shouldBlockUrl(defaults, `https://www.facebook.com${path}`).blocked, true, `${path} must be blocked by default`);
}

// The video routes belong to Watch: blocked by default, allowed once Watch is deselected.
for (const path of ["/watch/?v=1", "/video.php?v=1", "/share/v/AbC123/", "/nasa/videos/", "/live/", "/nasa/live/", "/watch/live/"]) {
  const url = `https://www.facebook.com${path}`;
  assert.equal(facebookSection(path.split("?")[0]), "watch", `${path} is a Watch route`);
  assert.equal(R.shouldBlockUrl(defaults, url).blocked, true, `${path} is blocked by default`);
  assert.equal(R.shouldBlockUrl(facebookWatchOff, url).blocked, false, `${path} can be allowed via Selected sections`);
  assert.equal(R.shouldBlockUrl(facebookWatch, url).blocked, true, `${path} must follow the Watch choice`);
}

// fb.watch links are video shares only: recognised as Facebook Watch wherever they appear,
// so feed cards carrying them are hidden and clicks on them are refused.
for (const url of ["https://fb.watch/AbC123/", "https://www.fb.watch/AbC123/"]) {
  assert.equal(R.platformForUrl(url).id, "facebook", `${url} belongs to Facebook`);
  assert.equal(R.sectionForUrl(R.platformById("facebook"), new URL(url)).id, "watch", `${url} is a Watch route`);
  assert.equal(R.shouldBlockUrl(defaults, url).blocked, true, `${url} must be blocked by default`);
  assert.equal(R.shouldBlockUrl(facebookWatchOff, url).blocked, false, `${url} can be allowed via Selected sections`);
}
assert.equal(R.platformForUrl("https://fb.com/profile/").id, "facebook", "fb.com links belong to Facebook");
assert.equal(R.shouldBlockUrl(defaults, "https://fb.com/profile/").blocked, false, "a plain fb.com page is not a video route");

// Neither share prefix may swallow an ordinary shared post, and a page whose name merely starts
// with "r" is not a share route.
assert.equal(facebookSection("/share/p/AbC123/"), null, "a shared post is not a Reel");
assert.equal(facebookSection("/rabbits/"), null, "a page name is not a share route");
assert.equal(R.shouldBlockUrl(defaults, "https://www.facebook.com/share/p/AbC123/").blocked, false);

// TikTok utility sections can be explicitly allowed in Advanced settings.
const utility = R.normalizeSettings({ platforms: { tiktok: { mode: "selected", sections: { feed: true, videos: true, messages: false, upload: false, settings: false } } } });
assert.equal(R.shouldBlockUrl(utility, "https://www.tiktok.com/").blocked, true);
assert.equal(R.shouldBlockUrl(utility, "https://www.tiktok.com/messages").blocked, false);

// DNR is block-only and limited to custom entries with an explicitly granted origin.
const custom = R.normalizeSettings({ customEntries: ["example.com/reels", "another.test"] });
const rules = R.buildDynamicRules(custom, ["example.com/reels"], at(2026, 8, 31, 12));
assert.equal(rules.length, 1);
assert.equal(rules[0].action.type, "block");
assert.equal(new RegExp(rules[0].condition.regexFilter).test("https://example.com/reels/123"), true);
assert.equal(new RegExp(rules[0].condition.regexFilter).test("https://example.com/home"), false);
assert.equal(new RegExp(rules[0].condition.regexFilter).test("https://www.example.com/reels/123"), false);
assert.equal(new RegExp(rules[0].condition.regexFilter).test("http://example.com/reels/123"), false);
assert.equal(R.permissionPatternForEntry("example.com/reels"), "https://example.com/*");

// Full-page options expose addictive pages (home feeds, Explore, Groups, ...) as one-click
// blocks backed by the existing Selected-sections machinery.
assert.deepEqual(R.fullPageSections("facebook").map((s) => s.id), ["home", "groups", "stories", "marketplace", "events"]);
assert.deepEqual(R.fullPageSections("youtube").map((s) => s.id), ["home", "trending", "subscriptions", "gaming"]);
assert.deepEqual(R.fullPageSections("instagram").map((s) => s.id), ["home", "explore", "stories"]);
assert.deepEqual(R.fullPageSections("tiktok").map((s) => s.id), ["live"]);
assert.deepEqual(R.fullPageSections("nope"), []);
let full = R.setSectionBlocked(defaults, "facebook", "home", true);
assert.equal(full.platforms.facebook.mode, "selected", "ticking a page switches to Selected sections");
assert.equal(full.platforms.facebook.sections.home, true, "the page is blocked");
assert.equal(full.platforms.facebook.sections.reels, true, "short-form defaults are preserved");
assert.equal(full.platforms.facebook.sections.watch, true);
assert.equal(R.shouldBlockUrl(full, "https://www.facebook.com/").blocked, true, "the home feed is fully blocked");
assert.equal(R.shouldBlockUrl(full, "https://www.facebook.com/reel/abc").blocked, true, "reels stay blocked");
full = R.setSectionBlocked(full, "facebook", "home", false);
assert.equal(full.platforms.facebook.mode, "shortform", "unticking the last extra page collapses back to Short-form only");
assert.equal(R.shouldBlockUrl(full, "https://www.facebook.com/").blocked, false, "the home feed is reachable again");
assert.equal(R.shouldBlockUrl(full, "https://www.facebook.com/reel/abc").blocked, true);
const untouched = R.setSectionBlocked(defaults, "facebook", "nope", true);
assert.deepEqual(untouched, defaults, "unknown sections leave settings untouched");
assert.deepEqual(R.setSectionBlocked(defaults, "nope", "home", true), defaults, "unknown platforms leave settings untouched");
const fromOff = R.setSectionBlocked(R.normalizeSettings({ platforms: { facebook: "off" } }), "facebook", "home", true);
assert.equal(fromOff.platforms.facebook.mode, "selected");
assert.equal(fromOff.platforms.facebook.sections.home, true);
assert.equal(R.shouldBlockUrl(fromOff, "https://www.facebook.com/").blocked, true);

// Review eligibility is neutral, delayed, and permanently dismissible.
const eligibleDate = at(2026, 8, 31, 12);
assert.equal(R.reviewEligible({ activeDayCount: 7 }, { localDay: R.localDay(eligibleDate), todayCount: 10, totalCount: 10 }, eligibleDate), true);
assert.equal(R.reviewEligible({ activeDayCount: 30, reviewDismissed: true }, { totalCount: 100 }, eligibleDate), false);

console.log("Shared schema, schedule, URL, counter, and rule tests passed.");
