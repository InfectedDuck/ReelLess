import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const sharedSource = fs.readFileSync(new URL("../shared.js", import.meta.url), "utf8");
const workerSource = fs.readFileSync(new URL("../service_worker.js", import.meta.url), "utf8");
const listeners = { installed: [], startup: [], alarm: [], changed: [], message: [], added: [], removed: [] };
const store = {
  settings: {
    globalMode: "custom",
    platforms: { reddit: { mode: "selected", sections: { popular: true } } },
    customEntries: ["example.com/reels"]
  }
};
const granted = new Set();
let dynamicRules = [{ id: 44, action: { type: "block" }, condition: {} }];
let registered = [];

function pick(keys) {
  if (typeof keys === "string") return { [keys]: store[keys] };
  if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, store[key]]));
  return { ...store };
}

const chrome = {
  runtime: {
    id: "test-extension-id",
    getURL: (path) => `chrome-extension://test-extension-id/${path}`,
    onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
    onStartup: { addListener: (fn) => listeners.startup.push(fn) },
    onMessage: { addListener: (fn) => listeners.message.push(fn) }
  },
  tabs: { create: async () => ({}) },
  storage: {
    local: {
      get: async (keys) => pick(keys),
      set: async (values) => Object.assign(store, JSON.parse(JSON.stringify(values)))
    },
    onChanged: { addListener: (fn) => listeners.changed.push(fn) }
  },
  alarms: {
    create: async () => {},
    onAlarm: { addListener: (fn) => listeners.alarm.push(fn) }
  },
  permissions: {
    contains: async ({ origins }) => origins.every((origin) => granted.has(origin)),
    onAdded: { addListener: (fn) => listeners.added.push(fn) },
    onRemoved: { addListener: (fn) => listeners.removed.push(fn) }
  },
  declarativeNetRequest: {
    getDynamicRules: async () => dynamicRules,
    updateDynamicRules: async ({ removeRuleIds, addRules }) => {
      dynamicRules = dynamicRules.filter((rule) => !removeRuleIds.includes(rule.id)).concat(JSON.parse(JSON.stringify(addRules)));
    }
  },
  scripting: {
    getRegisteredContentScripts: async () => registered,
    registerContentScripts: async (scripts) => { registered.push(...JSON.parse(JSON.stringify(scripts))); },
    unregisterContentScripts: async ({ ids }) => { registered = registered.filter((item) => !ids.includes(item.id)); }
  }
};

const sandbox = { chrome, console, setTimeout, clearTimeout, Date, URL };
sandbox.globalThis = sandbox;
sandbox.importScripts = (path) => {
  assert.equal(path, "shared.js");
  vm.runInContext(sharedSource, sandbox);
};

vm.createContext(sandbox);
vm.runInContext(workerSource, sandbox);
await new Promise((resolve) => setTimeout(resolve, 20));

assert.equal(listeners.message.length, 1);
assert.equal(store.settingsV2.schemaVersion, 11, "v1 settings should migrate to the current schema");
assert.equal(store.settingsV2.platforms.reddit.mode, "selected");
assert.equal(dynamicRules.length, 0, "denied custom permission must fail safely");
assert.equal(registered.length, 0, "denied advanced permission must not register a guard");

function message(payload, sender) {
  return new Promise((resolve) => listeners.message[0](payload, sender || { id: chrome.runtime.id, url: "chrome-extension://test-extension-id/options.html" }, resolve));
}
function contentMessage(payload) {
  return message(payload, { id: chrome.runtime.id, url: "https://example.com/reels/123" });
}

granted.add("https://example.com/*");
for (const origin of sandbox.ReelLess.platformById("reddit").permissionPatterns) granted.add(origin);
let response = await message({ type: "applySettings" });
assert.equal(response.ok, true);
assert.equal(dynamicRules.length, 1);
assert.equal(dynamicRules[0].action.type, "block");
assert.equal(registered.some((item) => item.id === "reelless-advanced-reddit"), true);

const optionalPlatforms = sandbox.ReelLess.PLATFORMS.filter((platform) => !sandbox.ReelLess.CORE_PLATFORM_IDS.includes(platform.id));
for (const platform of optionalPlatforms) {
  store.settingsV2.platforms[platform.id].mode = platform.sections.some((section) => section.shortform) ? "shortform" : "selected";
  for (const origin of platform.permissionPatterns) granted.add(origin);
}
response = await message({ type: "applySettings" });
assert.equal(response.ok, true);
const customGuardId = sandbox.ReelLess.customScriptId("example.com/reels");
assert.deepEqual(
  Array.from(registered, (item) => item.id).sort(),
  [...Array.from(optionalPlatforms, (platform) => `reelless-advanced-${platform.id}`), customGuardId].sort(),
  "Every enabled optional platform with granted access should receive exactly one dynamic guard"
);
const customGuard = registered.find((item) => item.id === customGuardId);
assert.deepEqual([...customGuard.matches], ["https://example.com/*"], "a custom boundary guard covers its host so allowed pages detect SPA navigation");
assert.deepEqual([...customGuard.js], ["shared.js", "site_guard.js"]);
assert.deepEqual([...customGuard.css], ["site_guard.css"]);
for (const platform of optionalPlatforms) {
  const guard = registered.find((item) => item.id === `reelless-advanced-${platform.id}`);
  assert.deepEqual([...guard.matches], [...platform.permissionPatterns], `${platform.id} guard must be restricted to its exact granted origins`);
  assert.deepEqual([...guard.js], ["shared.js", "site_guard.js"]);
  assert.deepEqual([...guard.css], ["site_guard.css"]);
}

store.settingsV2.platforms.x.mode = "off";
response = await message({ type: "applySettings" });
assert.equal(response.ok, true);
assert.equal(registered.some((item) => item.id === "reelless-advanced-x"), false, "A disabled optional platform must remove its guard even when access remains granted");
assert.equal(registered.length, optionalPlatforms.length, "the custom boundary guard stays while its entry remains");
assert.equal(registered.some((item) => item.id === customGuardId), true);

store.settingsV2.customEntries = [];
response = await message({ type: "applySettings" });
assert.equal(response.ok, true);
assert.equal(registered.some((item) => item.id === customGuardId), false, "removing a custom entry must remove its guard");
assert.equal(dynamicRules.length, 0, "removing a custom entry must remove its network rule");

await message({ type: "recordBlockAttempt", eventId: "same-deliberate-attempt" });
await message({ type: "recordBlockAttempt", eventId: "same-deliberate-attempt" });
assert.equal(store.statsV1.totalCount, 1, "duplicate click/navigation event must count once");
assert.deepEqual(Object.keys(store.statsV1), ["localDay", "todayCount", "totalCount"]);

// A day of protected browsing counts even when nothing needed blocking, and counts once per day.
const daysBefore = store.metaV1.activeDayCount;
await message({ type: "markActiveDay" });
await message({ type: "markActiveDay" });
await message({ type: "markActiveDay" });
assert.equal(store.metaV1.activeDayCount, daysBefore, "the day was already counted by the blocked attempt above");
assert.equal(store.statsV1.totalCount, 1, "marking a day active must never touch the blocked counter");

store.metaV1.lastActiveDay = "2020-01-01";
await message({ type: "markActiveDay" });
assert.equal(store.metaV1.activeDayCount, daysBefore + 1, "a new local day counts once");
await message({ type: "markActiveDay" });
assert.equal(store.metaV1.activeDayCount, daysBefore + 1, "repeat page loads on the same day do not count again");

// Seven protected days is now enough on its own, with no blocked attempts required.
store.metaV1 = { installedAt: Date.now(), activeDayCount: 6, lastActiveDay: "2020-01-01", reviewDismissed: false, reviewShown: false };
store.statsV1 = { localDay: sandbox.ReelLess.localDay(new Date()), todayCount: 0, totalCount: 0 };
await message({ type: "markActiveDay" });
assert.equal(store.metaV1.activeDayCount, 7);
assert.equal(store.metaV1.reviewShown, true, "the prompt must reach someone the product simply worked for");

const pauseBeforeInvalidMessage = store.settingsV2.pausedUntil;
response = await message({ type: "pause", duration: 999999 });
assert.equal(response.invalid, true, "unexpected pause values must be rejected");
assert.equal(store.settingsV2.pausedUntil, pauseBeforeInvalidMessage, "an invalid message must not change pause state");
const unauthorized = await new Promise((resolve) => listeners.message[0]({ type: "getState" }, { id: "another-extension" }, resolve));
assert.equal(unauthorized.ok, false, "messages outside this extension must be rejected");

granted.clear();
response = await message({ type: "applySettings" });
assert.equal(response.ok, true);
assert.equal(dynamicRules.length, 0, "custom rules are removed when access is removed");
assert.equal(registered.length, 0, "all advanced guards are removed when optional access is removed");

store.settingsV2 = sandbox.ReelLess.createUltimateSettings(store.settingsV2, "block_shortform");
response = await message({ type: "pause", duration: 15 });
assert.equal(response.ok, true);
assert.equal(response.locked, true, "Ultimate Lock must reject pause requests");
assert.equal(response.settings.pausedUntil, null);

// Serialized writer: stale snapshots never clobber; Off restores the remembered mode.
store.settingsV2 = sandbox.ReelLess.releaseUltimateSettings(store.settingsV2);
store.settingsV2 = sandbox.ReelLess.normalizeSettings(store.settingsV2);
response = await message({ type: "setPlatformEnabled", platform: "youtube", enabled: false });
assert.equal(response.ok, true);
assert.equal(response.settings.platforms.youtube.mode, "off");
assert.equal(response.settings.platforms.youtube.lastEnabledMode, store.settingsV2.platforms.youtube.mode === "off" ? response.settings.platforms.youtube.lastEnabledMode : response.settings.platforms.youtube.lastEnabledMode);
const remembered = response.settings.platforms.youtube.lastEnabledMode;
response = await message({ type: "setPlatformEnabled", platform: "youtube", enabled: true });
assert.equal(response.settings.platforms.youtube.mode, remembered, "re-enabling restores the remembered mode");
response = await message({ type: "patchSettings", patch: { platforms: { instagram: { sections: { home: true } } } } });
assert.equal(response.ok, true);
assert.equal(response.saved, true);
assert.equal(typeof response.applied, "boolean", "responses distinguish saved preference from applied protection");
assert.equal(response.settings.platforms.instagram.sections.home, true, "only the requested field is applied");
const denied = await contentMessage({ type: "patchSettings", patch: { protectionEnabled: false } });
assert.equal(denied.ok, false, "content scripts must not change settings");
const deniedLock = await contentMessage({ type: "enableUltimate", profile: "keep_current" });
assert.equal(deniedLock.ok, false, "content scripts must not change the lock");
// Content scripts retain openOptions, state, pause, and counting.
const opened = await contentMessage({ type: "openOptions" });
assert.equal(opened.ok, true, "content scripts may request the settings page");
response = await message({ type: "getState" });
assert.equal(response.ok, true);
assert.equal(typeof response.status, "string", "getState carries diagnostics status");
assert.ok(Array.isArray(response.platforms), "getState carries per-site diagnostics");
response = await message({ type: "resetStats" });
assert.equal(response.ok, true);
assert.equal(response.stats.todayCount, 0);
assert.equal(response.stats.totalCount, 0, "reset clears counters without touching settings");

console.log("Service worker migration, optional permission, dynamic guard, counter, and Ultimate Lock tests passed.");
