(function (root) {
  "use strict";

  // Firefox exposes both namespaces, but only browser.* returns promises. Its chrome.* is
  // callback-only, so every `await chrome.storage.local.get(...)` in this extension would resolve
  // to undefined without throwing, and the guard would silently run on defaults forever. shared.js
  // is the first script in every context, so aliasing here fixes all call sites at once.
  if (typeof browser !== "undefined" && browser.runtime && browser.runtime.id) {
    root.chrome = browser;
  }

  const SETTINGS_KEY = "settingsV2";
  const LEGACY_SETTINGS_KEY = "settings";
  const STATS_KEY = "statsV1";
  const META_KEY = "metaV1";
  const SCHEMA_VERSION = 7;
  const CUSTOM_RULE_START = 10000;
  const MAX_CUSTOM_ENTRIES = 50;
  const CORE_PLATFORM_IDS = ["youtube", "instagram", "facebook", "tiktok"];
  const ULTIMATE_PROFILES = [
    { value: "block_shortform", label: "Block all core short-form content" },
    { value: "keep_current", label: "Keep my current platform choices" }
  ];

  const SCHEDULE_PRESETS = [
    { value: "always", label: "Always on", start: "00:00", end: "00:00" },
    { value: "work_hours", label: "Work hours", start: "09:00", end: "17:00" },
    { value: "sleep", label: "Sleep time", start: "22:00", end: "07:00" },
    { value: "study", label: "School / study", start: "08:00", end: "15:00" },
    { value: "evening", label: "Evening focus", start: "18:00", end: "22:00" },
    { value: "custom", label: "Custom", start: "09:00", end: "17:00" }
  ];

  const PLATFORM_MODES = [
    { value: "shortform", label: "Short-form only" },
    { value: "selected", label: "Selected sections" },
    { value: "all", label: "Block all" },
    { value: "off", label: "Off" }
  ];
  // How blocked entry points (Shorts shelves, Reel cards, feed links) are treated inside pages that
  // remain available. "hide" removes them from feeds; "keep" leaves them visible but stops them opening.
  const ENTRY_POINT_MODES = [
    { value: "hide", label: "Hidden" },
    { value: "keep", label: "Visible, can't be opened" }
  ];
  const DEFAULT_ENTRY_POINTS = "hide";
  const APPEARANCE_MODES = ["dark", "light", "system"];

  const PLATFORMS = [
    {
      id: "youtube", label: "YouTube", core: true, defaultMode: "shortform",
      homeUrl: "https://www.youtube.com/",
      hosts: ["youtube.com"],
      permissionPatterns: ["https://youtube.com/*", "https://www.youtube.com/*", "https://m.youtube.com/*"],
      sections: [{ id: "shorts", label: "Shorts", shortform: true, paths: ["/shorts", "/feed/shorts"], patterns: [/^\/@[^/]+\/shorts(?:\/|$)/] }],
      surfaces: [
        { id: "homeFeed", label: "Home feed recommendations" },
        { id: "sidebar", label: "Up next sidebar" },
        { id: "comments", label: "Comments" },
        { id: "endScreen", label: "End screen suggestions" }
      ]
    },
    {
      id: "instagram", label: "Instagram", core: true, defaultMode: "shortform",
      homeUrl: "https://www.instagram.com/",
      hosts: ["instagram.com"],
      permissionPatterns: ["https://instagram.com/*", "https://www.instagram.com/*", "https://m.instagram.com/*"],
      sections: [
        { id: "reels", label: "Reels", shortform: true, paths: ["/reel", "/reels"], patterns: [/^\/[^/]+\/reels?(?:\/|$)/] },
        { id: "explore", label: "Explore", shortform: false, paths: ["/explore"] }
      ]
    },
    {
      id: "facebook", label: "Facebook", core: true, defaultMode: "shortform",
      homeUrl: "https://www.facebook.com/",
      hosts: ["facebook.com"],
      permissionPatterns: [
        "https://facebook.com/*", "https://www.facebook.com/*", "https://m.facebook.com/*"
      ],
      sections: [
        { id: "reels", label: "Reels", shortform: true, paths: ["/reel", "/reels", "/watch/reels"] },
        { id: "watch", label: "Watch", shortform: false, paths: ["/watch"], patterns: [/^\/[^/]+\/videos(?:\/|$)/] },
        { id: "marketplace", label: "Marketplace", shortform: false, paths: ["/marketplace"] }
      ]
    },
    {
      id: "tiktok", label: "TikTok", core: true, defaultMode: "all",
      homeUrl: "https://www.tiktok.com/",
      hosts: ["tiktok.com"],
      permissionPatterns: ["https://tiktok.com/*", "https://www.tiktok.com/*", "https://m.tiktok.com/*"],
      sections: [
        { id: "feed", label: "For You / Following", shortform: true, paths: ["/", "/foryou", "/following", "/explore"] },
        { id: "videos", label: "Videos", shortform: true, paths: ["/video"], patterns: [/^\/@[^/]+(?:\/|$)/] },
        { id: "messages", label: "Messages", shortform: false, paths: ["/messages"] },
        { id: "upload", label: "Upload", shortform: false, paths: ["/upload"] },
        { id: "settings", label: "Settings", shortform: false, paths: ["/setting", "/settings"] }
      ]
    },
    {
      id: "x", label: "X / Twitter", core: false, defaultMode: "off",
      homeUrl: "https://x.com/home", hosts: ["x.com", "twitter.com"],
      permissionPatterns: [
        "https://x.com/*", "https://www.x.com/*", "https://twitter.com/*",
        "https://www.twitter.com/*", "https://mobile.twitter.com/*"
      ],
      sections: [
        { id: "home", label: "Home feed", shortform: false, paths: ["/home"] },
        { id: "explore", label: "Explore", shortform: false, paths: ["/explore"] },
        { id: "video", label: "Video", shortform: true, paths: ["/i/status", "/video"] }
      ]
    },
    {
      id: "reddit", label: "Reddit", core: false, defaultMode: "off",
      homeUrl: "https://www.reddit.com/", hosts: ["reddit.com"],
      permissionPatterns: ["https://reddit.com/*", "https://www.reddit.com/*", "https://old.reddit.com/*"],
      sections: [
        { id: "popular", label: "Popular", shortform: false, paths: ["/r/popular"] },
        { id: "all", label: "All", shortform: false, paths: ["/r/all"] },
        { id: "shorts", label: "Short video communities", shortform: true, paths: ["/r/shorts", "/r/videos"] }
      ]
    },
    {
      id: "snapchat", label: "Snapchat", core: false, defaultMode: "off",
      homeUrl: "https://www.snapchat.com/", hosts: ["snapchat.com"],
      permissionPatterns: ["https://snapchat.com/*", "https://www.snapchat.com/*", "https://web.snapchat.com/*"],
      sections: [
        { id: "spotlight", label: "Spotlight", shortform: true, paths: ["/spotlight"] },
        { id: "stories", label: "Stories", shortform: false, paths: ["/stories"] }
      ]
    },
    {
      id: "twitch", label: "Twitch", core: false, defaultMode: "off",
      homeUrl: "https://www.twitch.tv/", hosts: ["twitch.tv"],
      permissionPatterns: [
        "https://twitch.tv/*", "https://www.twitch.tv/*", "https://m.twitch.tv/*", "https://dashboard.twitch.tv/*"
      ],
      sections: [
        { id: "directory", label: "Browse", shortform: false, paths: ["/directory"] },
        { id: "clips", label: "Clips", shortform: true, paths: ["/clip", "/clips"] },
        { id: "videos", label: "Videos", shortform: false, paths: ["/videos"] }
      ]
    },
    {
      id: "pinterest", label: "Pinterest", core: false, defaultMode: "off",
      homeUrl: "https://www.pinterest.com/", hosts: ["pinterest.com"],
      permissionPatterns: ["https://pinterest.com/*", "https://www.pinterest.com/*"],
      sections: [
        { id: "watch", label: "Watch", shortform: true, paths: ["/watch"] },
        { id: "ideas", label: "Ideas", shortform: true, paths: ["/ideas"] },
        { id: "pins", label: "Pins", shortform: false, paths: ["/pin"] }
      ]
    },
    {
      id: "linkedin", label: "LinkedIn", core: false, defaultMode: "off",
      homeUrl: "https://www.linkedin.com/feed/", hosts: ["linkedin.com"],
      permissionPatterns: ["https://linkedin.com/*", "https://www.linkedin.com/*"],
      sections: [
        { id: "feed", label: "Feed", shortform: false, paths: ["/feed"] },
        { id: "video", label: "Video", shortform: true, paths: ["/video"] },
        { id: "jobs", label: "Jobs", shortform: false, paths: ["/jobs"] }
      ]
    },
    {
      id: "threads", label: "Threads", core: false, defaultMode: "off",
      homeUrl: "https://www.threads.net/", hosts: ["threads.net"],
      permissionPatterns: ["https://threads.net/*", "https://www.threads.net/*"],
      sections: [
        { id: "feed", label: "Feed", shortform: false, paths: ["/"] },
        { id: "search", label: "Search", shortform: false, paths: ["/search"] },
        { id: "media", label: "Media", shortform: true, paths: ["/media"] }
      ]
    }
  ];

  function unique(values) {
    return Array.from(new Set(values));
  }

  function platformById(id) {
    return PLATFORMS.find((platform) => platform.id === id) || null;
  }

  // Every surface starts off. They are opt-in because hiding more of a page is also the most
  // common way an extension in this category breaks something the person wanted.
  function surfaceDefaults(platform) {
    return (platform.surfaces || []).reduce((result, surface) => {
      result[surface.id] = false;
      return result;
    }, {});
  }

  function sectionDefaults(platform) {
    return platform.sections.reduce((result, section) => {
      result[section.id] = Boolean(section.shortform);
      return result;
    }, {});
  }

  function defaultPlatformSettings() {
    return PLATFORMS.reduce((result, platform) => {
      result[platform.id] = { mode: platform.defaultMode, entryPoints: DEFAULT_ENTRY_POINTS, sections: sectionDefaults(platform), surfaces: surfaceDefaults(platform) };
      return result;
    }, {});
  }

  function normalizeEntryPoints(value) {
    return ENTRY_POINT_MODES.some((mode) => mode.value === value) ? value : DEFAULT_ENTRY_POINTS;
  }

  function getDefaultSettings() {
    return {
      schemaVersion: SCHEMA_VERSION,
      protectionEnabled: true,
      pausedUntil: null,
      schedulePreset: "always",
      customStart: "09:00",
      customEnd: "17:00",
      appearance: "dark",
      platforms: defaultPlatformSettings(),
      customEntries: [],
      ultimate: {
        enabled: false,
        profile: null,
        lockedPlatforms: null
      }
    };
  }

  function normalizeTime(value, fallback) {
    return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
  }

  function normalizePausedUntil(value) {
    const stamp = typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isFinite(stamp) ? new Date(stamp).toISOString() : null;
  }

  function normalizePlatformSetting(platform, value) {
    const defaults = { mode: platform.defaultMode, entryPoints: DEFAULT_ENTRY_POINTS, sections: sectionDefaults(platform), surfaces: surfaceDefaults(platform) };
    if (typeof value === "string") {
      return { mode: PLATFORM_MODES.some((mode) => mode.value === value) ? value : defaults.mode, entryPoints: defaults.entryPoints, sections: defaults.sections, surfaces: defaults.surfaces };
    }
    if (!value || typeof value !== "object") {
      return defaults;
    }
    const rawSections = value.sections && typeof value.sections === "object" ? value.sections : {};
    const sections = platform.sections.reduce((result, section) => {
      result[section.id] = typeof rawSections[section.id] === "boolean" ? rawSections[section.id] : defaults.sections[section.id];
      return result;
    }, {});
    const rawSurfaces = value.surfaces && typeof value.surfaces === "object" ? value.surfaces : {};
    const surfaces = (platform.surfaces || []).reduce((result, surface) => {
      result[surface.id] = typeof rawSurfaces[surface.id] === "boolean" ? rawSurfaces[surface.id] : defaults.surfaces[surface.id];
      return result;
    }, {});
    return {
      mode: PLATFORM_MODES.some((mode) => mode.value === value.mode) ? value.mode : defaults.mode,
      entryPoints: normalizeEntryPoints(value.entryPoints),
      sections,
      surfaces
    };
  }

  function clonePlatformSettings(source) {
    return PLATFORMS.reduce((result, platform) => {
      result[platform.id] = normalizePlatformSetting(platform, source && source[platform.id]);
      return result;
    }, {});
  }

  function normalizeUltimate(value, platformSettings) {
    const source = value && typeof value === "object" ? value : {};
    const enabled = Boolean(source.enabled);
    const profile = ULTIMATE_PROFILES.some((item) => item.value === source.profile) ? source.profile : null;
    return {
      enabled,
      profile: enabled ? (profile || "keep_current") : null,
      lockedPlatforms: enabled ? clonePlatformSettings(source.lockedPlatforms || platformSettings) : null
    };
  }

  function validateEntry(input) {
    const raw = String(input || "").trim().toLowerCase();
    if (!raw) return { ok: false, error: "Enter a domain or domain/path." };
    if (/\s|\*|[?#]/.test(raw)) return { ok: false, error: "Use a plain domain or path without spaces, wildcards, queries, or hashes." };
    let parsed;
    try {
      parsed = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
    } catch (_error) {
      return { ok: false, error: "Use a domain like example.com/reels." };
    }
    const host = parsed.hostname.replace(/^www\./, "");
    if (!host.includes(".") || !/^[a-z0-9.-]+$/.test(host)) return { ok: false, error: "Use a valid domain, such as example.com." };
    const path = parsed.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "");
    if (!/^\/[a-z0-9._~!$&'()+,;=:@%/-]*$/i.test(path)) return { ok: false, error: "Use a simple URL path." };
    return { ok: true, value: `${host}${path === "/" ? "" : path}` };
  }

  function normalizeSettings(raw) {
    const defaults = getDefaultSettings();
    const source = raw && typeof raw === "object" ? raw : {};
    const legacySchedule = source.schedule && typeof source.schedule === "object" ? source.schedule : {};
    let schedulePreset = source.schedulePreset || legacySchedule.mode;
    if (!SCHEDULE_PRESETS.some((item) => item.value === schedulePreset)) schedulePreset = "always";
    const globalMode = typeof source.globalMode === "string" ? source.globalMode : null;
    let platforms = PLATFORMS.reduce((result, platform) => {
      result[platform.id] = normalizePlatformSetting(platform, source.platforms && source.platforms[platform.id]);
      if (globalMode === "social") result[platform.id].mode = "all";
      if (globalMode === "pause") result[platform.id].mode = result[platform.id].mode;
      return result;
    }, {});
    const entries = Array.isArray(source.customEntries)
      ? source.customEntries.map(validateEntry).filter((item) => item.ok).map((item) => item.value)
      : [];
    const ultimate = normalizeUltimate(source.ultimate, platforms);
    if (ultimate.enabled) platforms = clonePlatformSettings(ultimate.lockedPlatforms);
    return {
      schemaVersion: SCHEMA_VERSION,
      protectionEnabled: ultimate.enabled ? true : (typeof source.protectionEnabled === "boolean" ? source.protectionEnabled : globalMode !== "pause"),
      pausedUntil: ultimate.enabled ? null : normalizePausedUntil(source.pausedUntil),
      schedulePreset: ultimate.enabled ? "always" : schedulePreset,
      customStart: normalizeTime(source.customStart || legacySchedule.customStart, defaults.customStart),
      customEnd: normalizeTime(source.customEnd || legacySchedule.customEnd, defaults.customEnd),
      appearance: APPEARANCE_MODES.includes(source.appearance) ? source.appearance : defaults.appearance,
      platforms,
      customEntries: unique(entries).slice(0, MAX_CUSTOM_ENTRIES),
      ultimate
    };
  }

  function localDay(date) {
    const value = date instanceof Date ? date : new Date(date || Date.now());
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function normalizeStats(raw, date) {
    const source = raw && typeof raw === "object" ? raw : {};
    const currentDay = localDay(date);
    return {
      localDay: currentDay,
      todayCount: source.localDay === currentDay && Number.isFinite(source.todayCount) ? Math.max(0, Math.floor(source.todayCount)) : 0,
      totalCount: Number.isFinite(source.totalCount) ? Math.max(0, Math.floor(source.totalCount)) : 0
    };
  }

  function normalizeMeta(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
      installedAt: Number.isFinite(source.installedAt) ? source.installedAt : Date.now(),
      activeDayCount: Number.isFinite(source.activeDayCount) ? Math.max(0, Math.floor(source.activeDayCount)) : 0,
      lastActiveDay: typeof source.lastActiveDay === "string" ? source.lastActiveDay : null,
      reviewDismissed: Boolean(source.reviewDismissed),
      reviewShown: Boolean(source.reviewShown)
    };
  }

  function minutes(value) {
    const parts = String(value).split(":").map(Number);
    return parts[0] * 60 + parts[1];
  }

  function isScheduleActive(settings, date) {
    const source = settings && settings.schemaVersion === SCHEMA_VERSION ? settings : normalizeSettings(settings);
    const now = date instanceof Date ? date : new Date(date || Date.now());
    if (!source.protectionEnabled) return false;
    if (source.pausedUntil && Date.parse(source.pausedUntil) > now.getTime()) return false;
    if (source.schedulePreset === "always") return true;
    const preset = SCHEDULE_PRESETS.find((item) => item.value === source.schedulePreset) || SCHEDULE_PRESETS[0];
    const start = minutes(source.schedulePreset === "custom" ? source.customStart : preset.start);
    const end = minutes(source.schedulePreset === "custom" ? source.customEnd : preset.end);
    const current = now.getHours() * 60 + now.getMinutes();
    if (start === end) return true;
    return start < end ? current >= start && current < end : current >= start || current < end;
  }

  function hostMatches(hostname, platform) {
    const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
    return platform.hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
  }

  function platformForUrl(input) {
    let url;
    try { url = input instanceof URL ? input : new URL(input); } catch (_error) { return null; }
    return PLATFORMS.find((platform) => hostMatches(url.hostname, platform)) || null;
  }

  // Some entry points cannot be written as a path prefix, because they begin with an arbitrary
  // handle: a channel's Shorts tab, a profile's Reels tab, a TikTok profile. Those sections carry
  // regexes, which are tried before the prefix list so a handle route wins over a generic prefix.
  function sectionForUrl(platform, input) {
    let url;
    try { url = input instanceof URL ? input : new URL(input); } catch (_error) { return null; }
    const path = url.pathname.toLowerCase();
    const byPattern = platform.sections.find((section) => (section.patterns || []).some((pattern) => pattern.test(path)));
    if (byPattern) return byPattern;
    return platform.sections.find((section) => section.paths.some((prefix) => prefix === "/" ? path === "/" : path === prefix || path.startsWith(`${prefix}/`))) || null;
  }

  function shouldBlockUrl(settings, input, date) {
    const source = settings && settings.schemaVersion === SCHEMA_VERSION ? settings : normalizeSettings(settings);
    if (!isScheduleActive(source, date)) return { blocked: false, platform: null, section: null };
    const platform = platformForUrl(input);
    if (!platform) return { blocked: false, platform: null, section: null };
    const platformSetting = source.platforms[platform.id];
    const section = sectionForUrl(platform, input);
    if (!platformSetting || platformSetting.mode === "off") return { blocked: false, platform, section };
    if (platformSetting.mode === "all") return { blocked: true, platform, section, reason: "all" };
    if (!section) return { blocked: false, platform, section };
    if (platformSetting.mode === "shortform") return { blocked: Boolean(section.shortform), platform, section, reason: "shortform" };
    return { blocked: Boolean(platformSetting.sections[section.id]), platform, section, reason: "selected" };
  }

  // Whether one section of a platform is blocked under these settings, asked without a URL. It
  // applies the same mode rules as shouldBlockUrl. The stylesheet gate needs this form: a rule
  // hides a section's entry points wholesale, so it has to know whether the section is blocked at
  // all, which hidesEntryPoints cannot say because it never looks at per-section choices.
  function sectionBlocked(settings, platform, sectionId) {
    const source = settings && settings.schemaVersion === SCHEMA_VERSION ? settings : normalizeSettings(settings);
    const definition = platformById(typeof platform === "string" ? platform : platform && platform.id);
    const setting = definition ? source.platforms[definition.id] : null;
    const section = definition ? definition.sections.find((item) => item.id === sectionId) : null;
    if (!setting || !section || setting.mode === "off") return false;
    if (setting.mode === "all") return true;
    if (setting.mode === "shortform") return Boolean(section.shortform);
    return Boolean(setting.sections[section.id]);
  }

  // True when blocked entry points on this platform should be removed from pages that stay available.
  // In "keep" mode the click and navigation guards still stop them from opening.
  function hidesEntryPoints(settings, platform) {
    const source = settings && settings.schemaVersion === SCHEMA_VERSION ? settings : normalizeSettings(settings);
    const id = typeof platform === "string" ? platform : platform && platform.id;
    const platformSetting = source.platforms[id];
    return Boolean(platformSetting) && platformSetting.mode !== "off" && platformSetting.entryPoints !== "keep";
  }

  // The surfaces switched on for a platform right now, or none when it is off or out of schedule.
  function activeSurfaces(settings, platform) {
    const source = settings && settings.schemaVersion === SCHEMA_VERSION ? settings : normalizeSettings(settings);
    const id = typeof platform === "string" ? platform : platform && platform.id;
    const definition = platformById(id);
    const setting = source.platforms[id];
    if (!definition || !setting || setting.mode === "off" || !isScheduleActive(source)) return [];
    return (definition.surfaces || []).filter((surface) => setting.surfaces[surface.id]).map((surface) => surface.id);
  }

  function createUltimateSettings(settings, profile) {
    const source = normalizeSettings(settings);
    const selectedProfile = ULTIMATE_PROFILES.some((item) => item.value === profile) ? profile : "keep_current";
    const lockedPlatforms = clonePlatformSettings(source.platforms);
    if (selectedProfile === "block_shortform") {
      CORE_PLATFORM_IDS.forEach((id) => {
        const platform = platformById(id);
        lockedPlatforms[id].mode = platform.defaultMode;
      });
    }
    return normalizeSettings({
      ...source,
      protectionEnabled: true,
      pausedUntil: null,
      schedulePreset: "always",
      platforms: lockedPlatforms,
      ultimate: { enabled: true, profile: selectedProfile, lockedPlatforms }
    });
  }

  function releaseUltimateSettings(settings) {
    const source = normalizeSettings(settings);
    return normalizeSettings({
      ...source,
      ultimate: { enabled: false, profile: null, lockedPlatforms: null }
    });
  }

  function permissionPatternForEntry(entry) {
    const checked = validateEntry(entry);
    if (!checked.ok) return null;
    const host = checked.value.split("/")[0];
    return `https://${host}/*`;
  }

  function buildDynamicRules(settings, permittedEntries, date) {
    const source = settings && settings.schemaVersion === SCHEMA_VERSION ? settings : normalizeSettings(settings);
    if (!isScheduleActive(source, date)) return [];
    const permitted = new Set((permittedEntries || []).map((entry) => validateEntry(entry)).filter((item) => item.ok).map((item) => item.value));
    return source.customEntries.filter((entry) => permitted.has(entry)).map((entry, index) => {
      const slash = entry.indexOf("/");
      const host = slash === -1 ? entry : entry.slice(0, slash);
      const path = slash === -1 ? "" : entry.slice(slash);
      return {
        id: CUSTOM_RULE_START + index,
        priority: 1,
        action: { type: "block" },
        condition: {
          regexFilter: `^https://${host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[/?#]|$)`,
          resourceTypes: ["main_frame", "sub_frame"]
        }
      };
    });
  }

  function pauseUntil(duration, date) {
    const now = date instanceof Date ? new Date(date.getTime()) : new Date(date || Date.now());
    if (duration === "tomorrow") {
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
      return tomorrow.toISOString();
    }
    const amount = Number(duration);
    return new Date(now.getTime() + (Number.isFinite(amount) ? amount : 15) * 60000).toISOString();
  }

  function youtubeWatchUrl(input) {
    let url;
    try { url = input instanceof URL ? input : new URL(input); } catch (_error) { return null; }
    const match = url.pathname.match(/^\/shorts\/([^/?#]+)/i);
    if (!match) return null;
    return `${url.origin}/watch?v=${encodeURIComponent(decodeURIComponent(match[1]))}`;
  }

  function reviewEligible(meta, stats, date) {
    const safeMeta = normalizeMeta(meta);
    const safeStats = normalizeStats(stats, date);
    // Deliberately not gated on blocked attempts. Those only accrue when someone tries to open
    // something, so the previous rule asked relapsing users for reviews and silently skipped
    // everyone the product was working for. Seven days of active protection is the evidence.
    return !safeMeta.reviewDismissed && !safeMeta.reviewShown && safeMeta.activeDayCount >= 7;
  }

  const api = {
    SETTINGS_KEY, LEGACY_SETTINGS_KEY, STATS_KEY, META_KEY, SCHEMA_VERSION,
    CUSTOM_RULE_START, MAX_CUSTOM_ENTRIES, CORE_PLATFORM_IDS,
    SCHEDULE_PRESETS, PLATFORM_MODES, ENTRY_POINT_MODES, APPEARANCE_MODES, ULTIMATE_PROFILES, PLATFORMS,
    platformById, getDefaultSettings, normalizeSettings, normalizeStats, normalizeMeta,
    validateEntry, permissionPatternForEntry, localDay, isScheduleActive,
    platformForUrl, sectionForUrl, shouldBlockUrl, sectionBlocked, hidesEntryPoints, activeSurfaces, buildDynamicRules,
    createUltimateSettings, releaseUltimateSettings, pauseUntil, youtubeWatchUrl, reviewEligible
  };

  root.ReelLess = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
