if (typeof importScripts === "function") importScripts("shared.js");

const {
  SETTINGS_KEY,
  LEGACY_SETTINGS_KEY,
  STATS_KEY,
  META_KEY,
  CORE_PLATFORM_IDS,
  PLATFORMS,
  normalizeSettings,
  normalizeStats,
  normalizeMeta,
  buildDynamicRules,
  permissionPatternForEntry,
  customScriptPattern,
  customScriptId,
  customHostForEntry,
  splitCustomEntry,
  setPlatformEnabled,
  setSectionBlocked,
  createUltimateSettings,
  releaseUltimateSettings,
  getEffectiveStatus,
  pauseUntil,
  reviewEligible
} = ReelLess;

const REFRESH_ALARM = "reelless-refresh";
const SCRIPT_PREFIX = "reelless-advanced-";
const ALLOWED_PAUSE_DURATIONS = new Set(["5", "15", "30", "tomorrow"]);
const recentEvents = new Map();
let statsQueue = Promise.resolve();
let applyQueue = Promise.resolve();

// Runs storage read-modify-write work one at a time while still handing each caller its own result.
function enqueue(work) {
  const task = statsQueue.then(work, work);
  statsQueue = task.then(() => undefined, () => undefined);
  return task;
}

async function readState() {
  const stored = await chrome.storage.local.get([SETTINGS_KEY, LEGACY_SETTINGS_KEY, STATS_KEY, META_KEY]);
  const settings = normalizeSettings(stored[SETTINGS_KEY] || stored[LEGACY_SETTINGS_KEY]);
  const stats = normalizeStats(stored[STATS_KEY]);
  const meta = normalizeMeta(stored[META_KEY]);
  const updates = {};
  if (!stored[SETTINGS_KEY] || JSON.stringify(stored[SETTINGS_KEY]) !== JSON.stringify(settings)) updates[SETTINGS_KEY] = settings;
  if (!stored[STATS_KEY] || JSON.stringify(stored[STATS_KEY]) !== JSON.stringify(stats)) updates[STATS_KEY] = stats;
  if (!stored[META_KEY]) updates[META_KEY] = meta;
  if (Object.keys(updates).length) await chrome.storage.local.set(updates);
  return { settings, stats, meta };
}

async function hasOrigins(origins) {
  if (!origins.length) return false;
  try {
    return await chrome.permissions.contains({ origins });
  } catch (_error) {
    return false;
  }
}

async function permittedCustomEntries(settings) {
  const results = await Promise.all(settings.customEntries.map(async (entry) => {
    const pattern = permissionPatternForEntry(entry);
    return pattern && await hasOrigins([pattern]) ? entry : null;
  }));
  return results.filter(Boolean);
}

async function syncDynamicRules(settings, permittedEntries) {
  const current = await chrome.declarativeNetRequest.getDynamicRules();
  const permitted = Array.isArray(permittedEntries) ? permittedEntries : await permittedCustomEntries(settings);
  const next = buildDynamicRules(settings, permitted, new Date());
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: current.map((rule) => rule.id),
    addRules: next
  });
}

async function syncAdvancedGuards(settings) {
  const registrations = await chrome.scripting.getRegisteredContentScripts();
  const registeredIds = new Set(registrations.map((item) => item.id));
  const desired = [];

  for (const platform of PLATFORMS.filter((item) => !CORE_PLATFORM_IDS.includes(item.id))) {
    const id = `${SCRIPT_PREFIX}${platform.id}`;
    const enabled = settings.platforms[platform.id].mode !== "off";
    const granted = enabled && await hasOrigins(platform.permissionPatterns);
    if (granted) {
      desired.push(id);
      if (!registeredIds.has(id)) {
        await chrome.scripting.registerContentScripts([{
          id,
          matches: platform.permissionPatterns,
          js: ["shared.js", "site_guard.js"],
          css: ["site_guard.css"],
          runAt: "document_start",
          persistAcrossSessions: true
        }]);
      }
    }
  }

  const obsolete = Array.from(registeredIds).filter((id) => id.startsWith(SCRIPT_PREFIX) && !desired.includes(id));
  if (obsolete.length) await chrome.scripting.unregisterContentScripts({ ids: obsolete });
}

// Personal custom boundaries get the same in-page guard as optional platforms (focus screen,
// entry-point hiding, click refusal). One guard covers each granted host (not each path)
// so allowed pages on that host can hide/refuse blocked links and detect SPA navigation
// into the blocked path. Network rules remain the backstop for direct document requests:
// those show the browser's blocked-page error, while in-page navigation uses the focus screen.
async function syncCustomGuards(settings, permittedEntries) {
  const registrations = await chrome.scripting.getRegisteredContentScripts();
  const registeredIds = new Set(registrations.map((item) => item.id));
  const byHost = new Map();
  for (const entry of permittedEntries || []) {
    const host = customHostForEntry(entry);
    if (!host) continue;
    if (!byHost.has(host)) byHost.set(host, customScriptPattern(entry));
  }
  const desired = [];
  for (const [host, matches] of byHost) {
    if (!matches) continue;
    const id = customScriptId(host);
    desired.push(id);
    if (!registeredIds.has(id)) {
      await chrome.scripting.registerContentScripts([{
        id,
        matches: [matches],
        js: ["shared.js", "site_guard.js"],
        css: ["site_guard.css"],
        runAt: "document_start",
        persistAcrossSessions: true
      }]);
    }
  }
  const obsolete = Array.from(registeredIds).filter((id) => id.startsWith("reelless-custom-") && !desired.includes(id));
  if (obsolete.length) await chrome.scripting.unregisterContentScripts({ ids: obsolete });
}

async function applySettingsNow() {
  const { settings } = await readState();
  const permittedEntries = await permittedCustomEntries(settings);
  await Promise.all([
    syncDynamicRules(settings, permittedEntries),
    syncAdvancedGuards(settings),
    syncCustomGuards(settings, permittedEntries)
  ]);
  return settings;
}

function applySettings() {
  applyQueue = applyQueue.then(applySettingsNow, applySettingsNow);
  return applyQueue;
}

function pruneRecentEvents(now) {
  for (const [id, timestamp] of recentEvents) {
    if (now - timestamp > 5000) recentEvents.delete(id);
  }
}

async function recordBlockAttempt(message) {
  const eventId = typeof message.eventId === "string" ? message.eventId.slice(0, 100) : "";
  const now = Date.now();
  pruneRecentEvents(now);
  if (eventId && recentEvents.has(eventId)) return (await readState()).stats;
  if (eventId) recentEvents.set(eventId, now);

  return enqueue(async () => {
    const stored = await chrome.storage.local.get([STATS_KEY, META_KEY]);
    const stats = normalizeStats(stored[STATS_KEY], new Date(now));
    stats.todayCount += 1;
    stats.totalCount += 1;
    const meta = normalizeMeta(stored[META_KEY]);
    if (meta.lastActiveDay !== stats.localDay) {
      meta.lastActiveDay = stats.localDay;
      meta.activeDayCount += 1;
    }
    if (reviewEligible(meta, stats, new Date(now))) meta.reviewShown = true;
    await chrome.storage.local.set({ [STATS_KEY]: stats, [META_KEY]: meta });
    return stats;
  });
}

// Counts today once, the first time a guarded page loads with protection actually in force.
// This is what lets the review prompt reach people for whom nothing needed blocking.
async function markActiveDay() {
  return enqueue(async () => {
    const stored = await chrome.storage.local.get([STATS_KEY, META_KEY]);
    const stats = normalizeStats(stored[STATS_KEY]);
    const meta = normalizeMeta(stored[META_KEY]);
    if (meta.lastActiveDay === stats.localDay) return meta;
    meta.lastActiveDay = stats.localDay;
    meta.activeDayCount += 1;
    if (reviewEligible(meta, stats, new Date())) meta.reviewShown = true;
    await chrome.storage.local.set({ [STATS_KEY]: stats, [META_KEY]: meta });
    return meta;
  });
}

async function setPause(duration) {
  const { settings } = await readState();
  if (settings.ultimate.enabled) return { settings, locked: true };
  const selectedDuration = String(duration);
  if (!ALLOWED_PAUSE_DURATIONS.has(selectedDuration)) return { settings, locked: false, invalid: true };
  settings.pausedUntil = pauseUntil(selectedDuration, new Date());
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  await applySettings();
  return { settings, locked: false, invalid: false };
}

// One serialized settings writer: reads the latest state and applies only the
// requested fields so a stale popup never overwrites unrelated changes made elsewhere.
let settingsQueue = Promise.resolve();
function enqueueSettings(work) {
  const task = settingsQueue.then(work, work);
  settingsQueue = task.then(() => undefined, () => undefined);
  return task;
}

function isExtensionPage(sender) {
  const url = sender && typeof sender.url === "string" ? sender.url : "";
  return url.startsWith("chrome-extension://") || url.startsWith("moz-extension://");
}

async function writeSettings(mutator) {
  return enqueueSettings(async () => {
    const { settings } = await readState();
    if (settings.ultimate.enabled) return { settings, locked: true, saved: false, applied: false };
    const next = normalizeSettings(mutator(normalizeSettings(settings)));
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    let applied = true;
    let applyError = null;
    try {
      await applySettings();
    } catch (error) {
      applied = false;
      applyError = error && error.message ? error.message : String(error);
    }
    const fresh = (await readState()).settings;
    return { settings: fresh, saved: true, applied, error: applyError, locked: false };
  });
}

async function handlePatchSettings(message) {
  const patch = message && typeof message.patch === "object" && message.patch ? message.patch : null;
  if (!patch) return { ok: false, error: "No settings patch provided." };
  return writeSettings((current) => {
    const next = JSON.parse(JSON.stringify(current));
    if (typeof patch.protectionEnabled === "boolean") {
      next.protectionEnabled = patch.protectionEnabled;
      if (patch.protectionEnabled) next.pausedUntil = null;
    }
    if (typeof patch.pausedUntil !== "undefined") next.pausedUntil = patch.pausedUntil;
    if (typeof patch.schedulePreset === "string") next.schedulePreset = patch.schedulePreset;
    if (typeof patch.customStart === "string") next.customStart = patch.customStart;
    if (typeof patch.customEnd === "string") next.customEnd = patch.customEnd;
    if (typeof patch.appearance === "string") next.appearance = patch.appearance;
    if (patch.platforms && typeof patch.platforms === "object") {
      for (const [id, change] of Object.entries(patch.platforms)) {
        if (!next.platforms[id] || !change || typeof change !== "object") continue;
        if (typeof change.mode === "string") {
          // Route through the remembered-mode helper so Off restores correctly.
          if (change.mode === "off") {
            const updated = setPlatformEnabled(next, id, false);
            next.platforms[id] = updated.platforms[id];
          } else {
            const wasOff = next.platforms[id].mode === "off";
            next.platforms[id].mode = change.mode;
            if (wasOff) next.platforms[id].lastEnabledMode = change.mode;
          }
        }
        if (change.sections && typeof change.sections === "object") {
          for (const [sectionId, value] of Object.entries(change.sections)) {
            if (sectionId in next.platforms[id].sections && typeof value === "boolean") {
              next.platforms[id].sections[sectionId] = value;
            }
          }
        }
        if (change.surfaces && typeof change.surfaces === "object") {
          for (const [surfaceId, value] of Object.entries(change.surfaces)) {
            if (next.platforms[id].surfaces && surfaceId in next.platforms[id].surfaces && typeof value === "boolean") {
              next.platforms[id].surfaces[surfaceId] = value;
            }
          }
        }
        if (typeof change.entryPoints === "string") next.platforms[id].entryPoints = change.entryPoints;
      }
    }
    if (Array.isArray(patch.customEntries)) next.customEntries = patch.customEntries;
    return next;
  });
}

async function handleSetPlatformEnabled(message) {
  const id = typeof message.platform === "string" ? message.platform : null;
  const enabled = Boolean(message.enabled);
  if (!id || !ReelLess.platformById(id)) return { ok: false, error: "Unknown platform." };
  return writeSettings((current) => setPlatformEnabled(current, id, enabled));
}

async function handleSetSection(message) {
  const { platform, section, blocked } = message || {};
  if (typeof platform !== "string" || typeof section !== "string") return { ok: false, error: "Unknown section." };
  return writeSettings((current) => setSectionBlocked(current, platform, section, Boolean(blocked)));
}

async function handleEnableUltimate(message) {
  const profile = typeof message.profile === "string" ? message.profile : "keep_current";
  return enqueueSettings(async () => {
    const { settings } = await readState();
    if (settings.ultimate.enabled) return { ok: true, settings, locked: true, saved: false, applied: true };
    const next = createUltimateSettings(settings, profile);
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    try {
      await applySettings();
    } catch (error) {
      return { ok: true, settings: (await readState()).settings, saved: true, applied: false, error: error.message };
    }
    return { ok: true, settings: (await readState()).settings, saved: true, applied: true };
  });
}

async function handleReleaseUltimate() {
  return enqueueSettings(async () => {
    const { settings } = await readState();
    const next = releaseUltimateSettings(settings);
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    try {
      await applySettings();
    } catch (error) {
      return { ok: true, settings: (await readState()).settings, saved: true, applied: false, error: error.message };
    }
    return { ok: true, settings: (await readState()).settings, saved: true, applied: true };
  });
}

async function handleResetStats() {
  return enqueue(async () => {
    const stored = await chrome.storage.local.get([STATS_KEY]);
    const stats = normalizeStats(stored[STATS_KEY]);
    stats.todayCount = 0;
    stats.totalCount = 0;
    // Settings, lock, and review-prompt state are untouched; only counters reset.
    await chrome.storage.local.set({ [STATS_KEY]: stats });
    return { ok: true, stats };
  });
}

async function getDiagnosticsState() {
  const { settings, stats, meta } = await readState();
  const status = getEffectiveStatus(settings, new Date());
  let platforms = [];
  try {
    platforms = await Promise.all(PLATFORMS.map(async (platform) => {
      let access = "bundled";
      if (!CORE_PLATFORM_IDS.includes(platform.id)) {
        try {
          const granted = await chrome.permissions.contains({ origins: platform.permissionPatterns });
          access = granted ? "granted" : "not-granted";
        } catch (_error) {
          access = "unknown";
        }
      }
      return { id: platform.id, mode: settings.platforms[platform.id].mode, access };
    }));
  } catch (_error) {
    platforms = PLATFORMS.map((platform) => ({ id: platform.id, mode: settings.platforms[platform.id].mode, access: "unknown" }));
  }
  return { settings, stats, meta, status: status.key, active: status.active, platforms };
}

chrome.runtime.onInstalled.addListener((details) => {
  (async () => {
    await readState();
    await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 1 });
    await applySettings();
    if (details.reason === "install") await chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
  })().catch((error) => console.error("ReelLess install setup failed", error));
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 1 });
  applySettings().catch((error) => console.error("ReelLess startup sync failed", error));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) applySettings().catch((error) => console.error("ReelLess schedule refresh failed", error));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[SETTINGS_KEY]) {
    applySettings().catch((error) => console.error("ReelLess settings sync failed", error));
  }
});

if (chrome.permissions && chrome.permissions.onAdded) {
  chrome.permissions.onAdded.addListener(() => applySettings().catch(console.error));
  chrome.permissions.onRemoved.addListener(() => applySettings().catch(console.error));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const task = (async () => {
    if (!_sender || _sender.id !== chrome.runtime.id) return { ok: false, error: "unauthorized" };
    if (!message || typeof message !== "object") return { ok: false };
    if (message.type === "applySettings") return { ok: true, settings: await applySettings() };
    if (message.type === "recordBlockAttempt") return { ok: true, stats: await recordBlockAttempt(message) };
    if (message.type === "markActiveDay") return { ok: true, meta: await markActiveDay() };
    if (message.type === "pause") return { ok: true, ...(await setPause(message.duration)) };
    if (message.type === "getState") return { ok: true, ...(await getDiagnosticsState()) };
    if (message.type === "openOptions") {
      try {
        if (chrome.runtime.openOptionsPage) await chrome.runtime.openOptionsPage();
        else if (chrome.tabs && chrome.tabs.create) await chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error && error.message ? error.message : "Settings could not be opened." };
      }
    }
    // Settings, lock, and reset operations are restricted to the extension's own
    // UI pages. Content scripts retain only state, pause, counting, and openOptions.
    if (message.type === "patchSettings" || message.type === "setPlatformEnabled" || message.type === "setSection"
      || message.type === "enableUltimate" || message.type === "releaseUltimate" || message.type === "resetStats") {
      if (!isExtensionPage(_sender)) return { ok: false, error: "Settings changes must come from ReelLess pages." };
    }
    if (message.type === "patchSettings") return { ...(await handlePatchSettings(message)), ok: true };
    if (message.type === "setPlatformEnabled") return { ...(await handleSetPlatformEnabled(message)), ok: true };
    if (message.type === "setSection") return { ...(await handleSetSection(message)), ok: true };
    if (message.type === "enableUltimate") return await handleEnableUltimate(message);
    if (message.type === "releaseUltimate") return await handleReleaseUltimate();
    if (message.type === "resetStats") return await handleResetStats();
    if (message.type === "dismissReview") {
      const stored = await chrome.storage.local.get(META_KEY);
      const meta = normalizeMeta(stored[META_KEY]);
      meta.reviewDismissed = true;
      await chrome.storage.local.set({ [META_KEY]: meta });
      return { ok: true };
    }
    return { ok: false };
  })();
  task.then(sendResponse).catch((error) => {
    console.error("ReelLess message failed", error);
    sendResponse({ ok: false, error: error.message });
  });
  return true;
});

readState().then(() => chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 1 })).then(applySettings).catch((error) => {
  console.error("ReelLess initialization failed", error);
});
