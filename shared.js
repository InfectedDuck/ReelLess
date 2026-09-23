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
  const SCHEMA_VERSION = 11;
  const CUSTOM_RULE_START = 10000;
  const MAX_CUSTOM_ENTRIES = 50;
  const CORE_PLATFORM_IDS = ["youtube", "instagram", "facebook", "tiktok"];
  // Store listing identities. Until a real listing URL is known the review action
  // stays hidden and only support is offered; never derive a review URL from a
  // runtime id (that is not a listing id, and Firefox ids must never build Chrome URLs).
  const DISTRIBUTION = {
    chrome: { listingId: null, reviewUrl: null, storeUrl: null },
    edge: { listingId: null, reviewUrl: null, storeUrl: null },
    firefox: { listingId: null, reviewUrl: null, storeUrl: null }
  };
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
      sections: [
        { id: "shorts", label: "Shorts", description: "Blocks Shorts shelves, cards, tabs, and direct Short visits (/shorts). Ordinary videos stay available.", shortform: true, paths: ["/shorts", "/feed/shorts"], patterns: [/^\/@[^/]+\/shorts(?:\/|$)/] },
        { id: "home", label: "Home feed", description: "Blocks the home page feed (/) entirely with a focus screen. Watch pages, subscriptions, and search stay available.", shortform: false, fullPage: true, paths: ["/"] },
        { id: "trending", label: "Trending", description: "Blocks the Trending page (/feed/trending) entirely with a focus screen. Subscriptions and search stay available.", shortform: false, fullPage: true, paths: ["/feed/trending", "/trending"] },
        { id: "subscriptions", label: "Subscriptions", description: "Blocks the Subscriptions feed (/feed/subscriptions) entirely with a focus screen. Watch pages and search stay available.", shortform: false, fullPage: true, paths: ["/feed/subscriptions"] },
        { id: "gaming", label: "Gaming", description: "Blocks the Gaming hub (/gaming) entirely with a focus screen. Ordinary videos and search stay available.", shortform: false, fullPage: true, paths: ["/gaming"] }
      ],
      surfaces: [
        { id: "homeFeed", label: "Home feed recommendations" },
        { id: "sidebar", label: "Up next sidebar" },
        { id: "comments", label: "Comments" },
        { id: "endScreen", label: "End screen suggestions" },
        { id: "games", label: "Games shelf", description: "Hides the Playables games shelf and game cards. Videos stay available." }
      ]
    },
    {
      id: "instagram", label: "Instagram", core: true, defaultMode: "shortform",
      homeUrl: "https://www.instagram.com/",
      hosts: ["instagram.com"],
      permissionPatterns: ["https://instagram.com/*", "https://www.instagram.com/*", "https://m.instagram.com/*"],
      sections: [
        { id: "reels", label: "Reels", description: "Blocks Reels pages and Reels links in feeds (/reel, /reels). Ordinary posts stay available.", shortform: true, paths: ["/reel", "/reels"], patterns: [/^\/[^/]+\/reels?(?:\/|$)/] },
        { id: "home", label: "Home feed", description: "Blocks the main home feed (/) entirely with a focus screen. Profiles, posts, Explore, and messages stay available unless blocked separately.", shortform: false, fullPage: true, paths: ["/"] },
        { id: "explore", label: "Explore", description: "Blocks the Explore discovery page (/explore) entirely with a focus screen. Search and profiles stay available.", shortform: false, fullPage: true, paths: ["/explore"] },
        { id: "stories", label: "Stories", description: "Blocks ephemeral Stories (/stories/) entirely with a focus screen. Home feed, Reels, Explore, and messages stay available unless blocked separately.", shortform: false, fullPage: true, paths: ["/stories", "/story"] }
      ]
    },
    {
      id: "facebook", label: "Facebook", core: true, defaultMode: "shortform",
      homeUrl: "https://www.facebook.com/",
      hosts: ["facebook.com", "fb.com", "fb.watch"],
      permissionPatterns: [
        "https://facebook.com/*", "https://www.facebook.com/*", "https://m.facebook.com/*",
        "https://fb.com/*", "https://www.fb.com/*", "https://fb.watch/*", "https://www.fb.watch/*"
      ],
      sections: [
        // "/share/r/" is how a Reel arrives when somebody sends one: Facebook resolves it to the
        // reel itself, so it has to be recognised here or a shared Reel opens and plays. The
        // pattern catches a page's Reels tab, which begins with an arbitrary page name.
        { id: "reels", label: "Reels", description: "Blocks Reels pages, the Reels tab, and Reel links in feeds. Ordinary posts stay available.", shortform: true, paths: ["/reel", "/reels", "/watch/reels", "/share/r"],
          patterns: [/^\/[^/]+\/reels?(?:\/|$)/] },
        // Watch is short-form for blocking purposes: Facebook autoplays feed videos in place
        // (like the recommended-post clips) and opens them in a dialog without changing the
        // address, so leaving Watch out of the default leaves the main video loop open. The
        // dedicated Watch page, video addresses, Live videos, fb.watch shares, and a page's
        // Videos tab therefore follow the default protection; Marketplace stays opt-in.
        // fb.watch exists only for video shares, so any route on it is Watch.
        { id: "watch", label: "Watch", description: "Blocks the Watch page, video and Live pages, and video posts in feeds. Ordinary posts stay available.", shortform: true, paths: ["/watch", "/videos", "/video.php", "/share/v", "/live"],
          patterns: [/^\/[^/]+\/videos(?:\/|$)/, /^\/[^/]+\/live(?:\/|$)/],
          hostPatterns: [{ hosts: ["fb.watch", "www.fb.watch"], pattern: /^\// }] },
        { id: "home", label: "Home feed", description: "Blocks the home feed (/) entirely with a focus screen. Groups, Watch, Marketplace, and messages stay available unless blocked separately.", shortform: false, fullPage: true, paths: ["/"] },
        { id: "groups", label: "Groups", description: "Blocks Groups pages and the groups tab (/groups) entirely with a focus screen. Home feed and messages stay available unless blocked separately.", shortform: false, fullPage: true, paths: ["/groups"] },
        { id: "stories", label: "Stories", description: "Blocks ephemeral Stories (/stories/) entirely with a focus screen. Home feed, Reels, Watch, Groups, and messages stay available unless blocked separately.", shortform: false, fullPage: true, paths: ["/stories", "/story", "/story.php"] },
        { id: "marketplace", label: "Marketplace", description: "Blocks Marketplace pages (/marketplace) entirely with a focus screen. Home feed, Watch, Groups, and messages stay available unless blocked separately.", shortform: false, fullPage: true, paths: ["/marketplace"] },
        { id: "events", label: "Events", description: "Blocks Events pages (/events) entirely with a focus screen. Home feed, Groups, and messages stay available unless blocked separately.", shortform: false, fullPage: true, paths: ["/events"] }
      ]
    },
    {
      id: "tiktok", label: "TikTok", core: true, defaultMode: "shortform",
      homeUrl: "https://www.tiktok.com/",
      hosts: ["tiktok.com"],
      permissionPatterns: ["https://tiktok.com/*", "https://www.tiktok.com/*", "https://m.tiktok.com/*"],
      sections: [
        { id: "feed", label: "For You / Following", description: "Blocks the main feed and front page (/). Utility sections stay available unless blocked separately.", shortform: true, paths: ["/", "/foryou", "/following", "/explore"] },
        { id: "videos", label: "Videos", description: "Blocks video and profile video pages (/video, /@handle). Utility sections stay available unless blocked separately.", shortform: true, paths: ["/video"], patterns: [/^\/@[^/]+(?:\/|$)/] },
        { id: "live", label: "LIVE", description: "Blocks TikTok LIVE streams and the LIVE page (/live) entirely with a focus screen. Recorded videos stay available unless blocked separately.", shortform: false, fullPage: true, paths: ["/live"] },
        { id: "messages", label: "Messages", description: "Blocks direct messages (/messages).", shortform: false, paths: ["/messages"] },
        { id: "upload", label: "Upload", description: "Blocks the upload page (/upload).", shortform: false, paths: ["/upload"] },
        { id: "settings", label: "Settings", description: "Blocks the settings pages (/settings).", shortform: false, paths: ["/setting", "/settings"] }
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
        { id: "home", label: "Block Home feed", description: "Blocks both For You and Following. Other pages stay available.", shortform: false, paths: ["/", "/home"] },
        { id: "explore", label: "Block Explore page", description: "Blocks the Explore discovery page (/explore and its tabs). Search (/search) stays available.", shortform: false, paths: ["/explore"] },
        { id: "notifications", label: "Block Notifications", description: "Blocks the Notifications page (/notifications). Timeline posts stay available.", shortform: false, paths: ["/notifications"] },
        { id: "messages", label: "Block Messages", description: "Blocks direct messages (/i/chat). Timeline posts stay available.", shortform: false, paths: ["/messages", "/i/chat"] },
        { id: "communities", label: "Block Communities", description: "Blocks Communities discovery and community pages (/i/communities). Timeline posts stay available.", shortform: false, paths: ["/i/communities"] },
        { id: "grok", label: "Block Grok", description: "Blocks the Grok AI assistant (/i/grok). Timeline posts stay available.", shortform: false, paths: ["/i/grok"] }
      ],
      surfaces: [
        { id: "xExplore", label: "Hide Explore recommendations", description: "Hides the discovery feed and topic tabs. Search stays available." },
        { id: "xSidebar", label: "Hide sidebar distractions", description: "Hides news, trending topics, and Who to follow. Search and Chat stay available." }
      ]
    },
    {
      id: "reddit", label: "Reddit", core: false, defaultMode: "off",
      homeUrl: "https://www.reddit.com/", hosts: ["reddit.com"],
      permissionPatterns: ["https://reddit.com/*", "https://www.reddit.com/*", "https://old.reddit.com/*"],
      sections: [
        { id: "home", label: "Block Home feed", description: "Blocks the general Home feed. Communities, posts, comments, and search stay available.", shortform: false,
          paths: ["/"], queries: [{ key: "feed", values: ["home", "following", "for-you", "foryou"] }] },
        { id: "discovery", label: "Block Popular, News, and Explore", description: "Blocks broad Reddit-wide discovery feeds, including the legacy All feed.", shortform: false,
          paths: ["/r/popular", "/r/all", "/news", "/explore"], queries: [{ key: "feed", values: ["popular", "all", "news", "explore"] }] },
        { id: "chat", label: "Block Chat", description: "Blocks Reddit chat (/chat). Communities, posts, comments, and search stay available.", shortform: false, paths: ["/chat"] },
        { id: "inbox", label: "Block Message inbox", description: "Blocks the private-message inbox (/message). Chat, communities, posts, and search stay available unless blocked separately.", shortform: false, paths: ["/message"] },
        { id: "notifications", label: "Block Notifications", description: "Blocks the notifications page (/notifications). Communities, posts, and search stay available.", shortform: false, paths: ["/notifications"] }
      ],
      surfaces: [
        { id: "redditSidebar", label: "Hide sidebar distractions", description: "Hides Reddit Games, Discover More, and similar promotional navigation. Recent communities and Custom Feeds stay available." }
      ]
    },
    {
      id: "snapchat", label: "Snapchat", core: false, defaultMode: "off",
      homeUrl: "https://www.snapchat.com/", hosts: ["snapchat.com"],
      permissionPatterns: ["https://snapchat.com/*", "https://www.snapchat.com/*", "https://web.snapchat.com/*"],
      sections: [
        { id: "spotlight", label: "Block Spotlight", description: "Blocks Snapchat's public short-video discovery feed. Chat and Home stay available; Stories can be blocked separately.", shortform: true, paths: ["/spotlight"] },
        { id: "stories", label: "Block Stories", description: "Blocks friends' and public Stories (/stories/). Spotlight, Chat, and Home stay available unless blocked separately.", shortform: false, paths: ["/stories", "/story"] }
      ]
    },
    {
      id: "twitch", label: "Twitch", core: false, defaultMode: "off",
      homeUrl: "https://www.twitch.tv/", hosts: ["twitch.tv"],
      permissionPatterns: [
        "https://twitch.tv/*", "https://www.twitch.tv/*", "https://m.twitch.tv/*", "https://clips.twitch.tv/*", "https://dashboard.twitch.tv/*"
      ],
      sections: [
        { id: "home", label: "Block recommended Home", description: "Blocks Twitch's front-page recommendations. Following, channels, and search stay available.", shortform: false, paths: ["/"], hosts: ["twitch.tv", "www.twitch.tv", "m.twitch.tv"] },
        { id: "directory", label: "Block Browse", description: "Blocks category and live-channel discovery pages.", shortform: false, paths: ["/directory"], hosts: ["twitch.tv", "www.twitch.tv", "m.twitch.tv"] },
        { id: "clips", label: "Block Clips", description: "Blocks short clips while preserving live channels and full channel archives.", shortform: true,
          paths: ["/clip", "/clips"], hosts: ["twitch.tv", "www.twitch.tv", "m.twitch.tv"], hostPatterns: [{ hosts: ["clips.twitch.tv"], pattern: /^\// }] },
        { id: "videos", label: "Block Videos (VODs)", description: "Blocks channel video archives and past broadcasts (/channel/videos). Live channels and Browse stay available unless blocked separately.", shortform: false,
          paths: ["/videos"], patterns: [/^\/[^/]+\/videos(?:\/|$)/], hosts: ["twitch.tv", "www.twitch.tv", "m.twitch.tv"] },
        { id: "drops", label: "Block Drops", description: "Blocks the Drops and rewards inventory (/drops) where watch-time campaigns live. Live channels and Browse stay available unless blocked separately.", shortform: false,
          paths: ["/drops"], hosts: ["twitch.tv", "www.twitch.tv", "m.twitch.tv"] }
      ]
    },
    {
      id: "pinterest", label: "Pinterest", core: false, defaultMode: "off",
      homeUrl: "https://www.pinterest.com/", hosts: ["pinterest.com"],
      permissionPatterns: ["https://pinterest.com/*", "https://www.pinterest.com/*"],
      sections: [
        { id: "home", label: "Block Home feed", description: "Blocks Pinterest's personalized feed. Search, boards, profiles, and individual Pins stay available.", shortform: false, paths: ["/"] },
        { id: "explore", label: "Block Explore", description: "Blocks Pinterest's curated trending-ideas page.", shortform: false, paths: ["/ideas", "/explore", "/today"] },
        { id: "search", label: "Block Search", description: "Blocks search results pages (/search). Boards, profiles, and individual Pins stay available.", shortform: false, paths: ["/search"] }
      ]
    },
    {
      id: "linkedin", label: "LinkedIn", core: false, defaultMode: "off",
      homeUrl: "https://www.linkedin.com/feed/", hosts: ["linkedin.com"],
      permissionPatterns: ["https://linkedin.com/*", "https://www.linkedin.com/*"],
      sections: [
        { id: "feed", label: "Block Feed", description: "Blocks the scrolling news feed. Jobs, messages, notifications, profiles, and search stay available.", shortform: false, paths: ["/feed"] },
        { id: "videos", label: "Block Videos", description: "Blocks native video post pages (/video). Jobs, messages, and profiles stay available.", shortform: false, paths: ["/video"] },
        { id: "notifications", label: "Block Notifications", description: "Blocks the notifications page (/notifications). Jobs, messages, and profiles stay available.", shortform: false, paths: ["/notifications"] },
        { id: "messaging", label: "Block Messaging", description: "Blocks direct messages (/messaging). Feed, jobs, and profiles stay available unless blocked separately.", shortform: false, paths: ["/messaging"] },
        { id: "network", label: "Block My Network", description: "Blocks the My Network invitations page (/mynetwork). Feed, jobs, and messages stay available unless blocked separately.", shortform: false, paths: ["/mynetwork"] }
      ]
    },
    {
      id: "threads", label: "Threads", core: false, defaultMode: "off",
      homeUrl: "https://www.threads.com/", hosts: ["threads.com", "threads.net"],
      permissionPatterns: ["https://threads.com/*", "https://www.threads.com/*", "https://threads.net/*", "https://www.threads.net/*"],
      sections: [
        { id: "feed", label: "Block Home feed", description: "Blocks the main feed. Search, profiles, individual threads, activity, saved posts, and custom feeds stay available.", shortform: false, paths: ["/"] },
        { id: "activity", label: "Block Activity", description: "Blocks the activity and notifications page (/activity). Search, profiles, and saved posts stay available.", shortform: false, paths: ["/activity"] }
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

  function defaultLastEnabledMode(platform) {
    // The mode to restore when a site is switched back on. Off has no enabled
    // mode, so fall back to the site's default; "all" is remembered as-is.
    return platform.defaultMode;
  }

  function defaultPlatformSettings() {
    return PLATFORMS.reduce((result, platform) => {
      result[platform.id] = { mode: platform.defaultMode, lastEnabledMode: defaultLastEnabledMode(platform), entryPoints: DEFAULT_ENTRY_POINTS, sections: sectionDefaults(platform), surfaces: surfaceDefaults(platform) };
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

  function normalizeLastEnabledMode(platform, value, mode) {
    const candidate = typeof value === "string" ? value : (value && typeof value === "object" ? value.lastEnabledMode : null);
    if (PLATFORM_MODES.some((item) => item.value === candidate) && candidate !== "off") return candidate;
    if (mode && mode !== "off" && PLATFORM_MODES.some((item) => item.value === mode)) return mode;
    return platform.defaultMode;
  }

  function normalizePlatformSetting(platform, value) {
    const defaults = { mode: platform.defaultMode, lastEnabledMode: defaultLastEnabledMode(platform), entryPoints: DEFAULT_ENTRY_POINTS, sections: sectionDefaults(platform), surfaces: surfaceDefaults(platform) };
    // Apply here so old Ultimate Lock snapshots migrate exactly like ordinary settings.
    // No video-only selection may silently turn into a broader feed restriction.
    if (platform.id === "x") {
      if (value === "shortform") value = "off";
      else if (value && typeof value === "object") {
        const rawSections = value.sections && typeof value.sections === "object" ? value.sections : {};
        const rawSurfaces = value.surfaces && typeof value.surfaces === "object" ? value.surfaces : {};
        // Schema 7 stored an "explore" section flag that meant recommendation hiding, not page
        // blocking. Settings written in the current shape always carry an explicit xExplore
        // surface choice, so only those may enable the Explore page section; older inputs map
        // explore onto the surface instead and must never broaden into a page block.
        const legacyExplore = typeof rawSurfaces.xExplore !== "boolean" && rawSections.explore === true;
        const sections = { ...rawSections };
        if (legacyExplore) delete sections.explore;
        value = { ...value, mode: value.mode === "shortform" ? "off" : value.mode,
          sections, surfaces: { ...rawSurfaces } };
        if (value.mode === "selected" && legacyExplore) value.surfaces.xExplore = true;
      }
    }
    if (platform.id === "reddit") {
      if (value === "shortform") value = "off";
      else if (value && typeof value === "object") {
        value = { ...value, mode: value.mode === "shortform" ? "off" : value.mode,
          sections: { ...value.sections }, surfaces: { ...value.surfaces } };
        if (value.mode === "selected" && (value.sections.popular === true || value.sections.all === true)
          && typeof value.sections.discovery !== "boolean") value.sections.discovery = true;
      }
    }
    if (["linkedin", "threads"].includes(platform.id)) {
      if (value === "shortform") value = "off";
      else if (value && typeof value === "object" && value.mode === "shortform") value = { ...value, mode: "off" };
    }
    if (platform.id === "pinterest") {
      if (value === "shortform") value = "off";
      else if (value && typeof value === "object") {
        value = { ...value, mode: value.mode === "shortform" ? "selected" : value.mode, sections: { ...value.sections } };
        if ((value.sections.watch === true || value.sections.ideas === true)
          && typeof value.sections.explore !== "boolean") value.sections.explore = true;
      }
    }
    if (typeof value === "string") {
      const mode = PLATFORM_MODES.some((item) => item.value === value) ? value : defaults.mode;
      return { mode, lastEnabledMode: normalizeLastEnabledMode(platform, null, mode), entryPoints: defaults.entryPoints, sections: defaults.sections, surfaces: defaults.surfaces };
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
    const mode = PLATFORM_MODES.some((item) => item.value === value.mode) ? value.mode : defaults.mode;
    return {
      mode,
      lastEnabledMode: normalizeLastEnabledMode(platform, value, mode),
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
    const raw = String(input || "").trim();
    if (!raw) return { ok: false, error: "Enter a domain or domain/path." };
    if (/\s/.test(raw)) return { ok: false, error: "Use a plain domain or path without spaces." };
    if (raw.includes("*")) return { ok: false, error: "Wildcards are not supported. Add the exact host, e.g. example.com." };
    if (raw.includes("?")) return { ok: false, error: "Queries are not supported. Add the domain or path without ? and parameters." };
    if (raw.includes("#")) return { ok: false, error: "Fragments are not supported. Add the domain or path without #." };
    if (/^http:\/\//i.test(raw)) return { ok: false, error: "Use an HTTPS host or a bare domain/path. Explicit http:// URLs are not accepted." };
    if (raw.includes("@")) return { ok: false, error: "Credentials are not supported. Add the domain without userinfo." };
    let withScheme = raw;
    if (!/^https:\/\//i.test(withScheme)) withScheme = `https://${withScheme}`;
    let parsed;
    try {
      parsed = new URL(withScheme);
    } catch (_error) {
      return { ok: false, error: "Use a domain like example.com/reels." };
    }
    if (parsed.username || parsed.password) return { ok: false, error: "Credentials are not supported. Add the domain without userinfo." };
    if (parsed.port) return { ok: false, error: "Ports are not supported. Add the domain without :port." };
    if (parsed.search && parsed.search !== "") return { ok: false, error: "Queries are not supported. Add the domain or path without ? and parameters." };
    if (parsed.hash && parsed.hash !== "") return { ok: false, error: "Fragments are not supported. Add the domain or path without #." };
    // Hostnames are case-insensitive: lowercase the host only. Paths are preserved
    // exactly (case-sensitive), and www.example.com is a distinct host from example.com.
    const host = parsed.hostname.toLowerCase();
    if (!host.includes(".") || !/^[a-z0-9.-]+$/.test(host)) return { ok: false, error: "Use a valid domain, such as example.com." };
    if (host.startsWith("-") || host.endsWith("-") || host.includes("..")) return { ok: false, error: "Use a valid domain, such as example.com." };
    const path = parsed.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "");
    // An empty path means the whole site: "example.com" blocks example.com/*.
    // Path case is preserved: /Private and /private are different boundaries.
    if (path && path !== "" && path !== "/") {
      if (!/^\/[A-Za-z0-9._~!$&'()+,;=:@%/-]*$/.test(path)) return { ok: false, error: "Use a simple URL path." };
      return { ok: true, value: `${host}${path}` };
    }
    return { ok: true, value: host };
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
    const host = url.hostname.toLowerCase();
    const byHostPattern = platform.sections.find((section) => (section.hostPatterns || []).some((rule) =>
      rule.hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`)) && rule.pattern.test(path)));
    if (byHostPattern) return byHostPattern;
    const candidates = platform.sections.filter((section) => !section.hosts || section.hosts.includes(host));
    const byQuery = candidates.find((section) => (section.queries || []).some((query) =>
      query.values.includes(String(url.searchParams.get(query.key) || "").toLowerCase())));
    if (byQuery) return byQuery;
    const byPattern = candidates.find((section) => (section.patterns || []).some((pattern) => pattern.test(path)));
    if (byPattern) return byPattern;
    return candidates.find((section) => section.paths.some((prefix) => prefix === "/" ? path === "/" : path === prefix || path.startsWith(`${prefix}/`))) || null;
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

  // Full-page sections: addictive pages (home feeds, Explore, Trending, Groups, ...) that
  // are blocked entirely with a focus screen instead of having entry points hidden in place.
  // Offered as one-click options on the main settings cards so they are not buried in Advanced.
  function fullPageSections(platform) {
    const definition = platformById(typeof platform === "string" ? platform : platform && platform.id);
    if (!definition) return [];
    return definition.sections.filter((section) => section.fullPage);
  }

  // Sets one section on or off, switching the platform to Selected sections mode when needed
  // so short-form defaults are preserved. Collapses back to Short-form only when the sections
  // again match exactly what that mode would produce. Unknown platforms or sections leave the
  // settings untouched. Always returns normalized settings.
  function setSectionBlocked(settings, platformId, sectionId, blocked) {
    const source = settings && settings.schemaVersion === SCHEMA_VERSION ? normalizeSettings(settings) : normalizeSettings(settings);
    const definition = platformById(platformId);
    const section = definition ? definition.sections.find((item) => item.id === sectionId) : null;
    if (!definition || !section) return source;
    const setting = source.platforms[definition.id];
    const want = Boolean(blocked);
    if (setting.mode !== "selected") {
      if (setting.mode === "off" && !want) return source;
      setting.mode = "selected";
      definition.sections.forEach((item) => { setting.sections[item.id] = Boolean(item.shortform); });
    }
    setting.sections[section.id] = want;
    if (definition.defaultMode === "shortform"
      && definition.sections.every((item) => setting.sections[item.id] === Boolean(item.shortform))) {
      setting.mode = "shortform";
    }
    return normalizeSettings(source);
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

  // Splits a validated custom entry ("host" or "host/path") into its parts.
  function splitCustomEntry(entry) {
    const checked = typeof entry === "string" ? validateEntry(entry) : { ok: false };
    if (!checked.ok) return null;
    const slash = checked.value.indexOf("/");
    return slash === -1
      ? { host: checked.value, path: "" }
      : { host: checked.value.slice(0, slash), path: checked.value.slice(slash) };
  }

  // True when a URL falls under a personal custom boundary: exact host match
  // (www.example.com and example.com are distinct) and the entry path is empty
  // or a case-sensitive path prefix of the URL.
  function matchCustomEntry(entry, input) {
    const parts = typeof entry === "string" ? splitCustomEntry(entry) : null;
    if (!parts) return false;
    let url;
    try { url = input instanceof URL ? input : new URL(input); } catch (_error) { return false; }
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (host !== parts.host) return false;
    if (!parts.path) return true;
    const path = url.pathname;
    return path === parts.path || path.startsWith(`${parts.path}/`);
  }

  function customEntryForUrl(entries, input) {
    return (Array.isArray(entries) ? entries : []).find((entry) => matchCustomEntry(entry, input)) || null;
  }

  // Whether a personal custom boundary blocks this URL right now. Custom entries honor the
  // same global schedule and pause state as platforms, but need no per-entry switches: adding
  // one means blocking it.
  function shouldBlockCustomUrl(settings, input, date) {
    const source = settings && settings.schemaVersion === SCHEMA_VERSION ? settings : normalizeSettings(settings);
    if (!isScheduleActive(source, date)) return { blocked: false, entry: null };
    if (!source.customEntries.length) return { blocked: false, entry: null };
    // Platform hosts stay under the platform checklists even if typed here.
    if (platformForUrl(input)) return { blocked: false, entry: null };
    const entry = customEntryForUrl(source.customEntries, input);
    return entry ? { blocked: true, entry } : { blocked: false, entry: null };
  }

  // Host-wide content-script match pattern for a custom entry. Guards register
  // across the whole granted host (not just the blocked path) so allowed pages
  // can hide/refuse blocked links and detect SPA navigation into the blocked path.
  // Chrome match patterns need a path starting with "/"; "/*" covers the host.
  function customScriptPattern(entry) {
    const parts = typeof entry === "string" ? splitCustomEntry(entry) : null;
    if (!parts) return null;
    return `https://${parts.host}/*`;
  }

  // Stable registration id per host: entries sharing one host share one guard.
  function customScriptId(entry) {
    const parts = typeof entry === "string" ? splitCustomEntry(entry) : null;
    const value = parts ? parts.host : String(entry || "");
    let hash = 5381;
    for (let index = 0; index < value.length; index += 1) {
      hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
    }
    return `reelless-custom-${hash.toString(36)}`;
  }

  function customHostForEntry(entry) {
    const parts = typeof entry === "string" ? splitCustomEntry(entry) : null;
    return parts ? parts.host : null;
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

  function reviewEligible(meta, stats, date) {
    const safeMeta = normalizeMeta(meta);
    const safeStats = normalizeStats(stats, date);
    // Deliberately not gated on blocked attempts. Those only accrue when someone tries to open
    // something, so the previous rule asked relapsing users for reviews and silently skipped
    // everyone the product was working for. Seven days of active protection is the evidence.
    return !safeMeta.reviewDismissed && !safeMeta.reviewShown && safeMeta.activeDayCount >= 7;
  }

  // Switch a platform off while remembering its last enabled mode, or switch it
  // back on by restoring that mode (falling back to the site default). Preserves
  // section/surface/entry choices so Off -> On never resets to Short-form only.
  function setPlatformEnabled(settings, platformId, enabled) {
    const source = normalizeSettings(settings);
    const definition = platformById(platformId);
    if (!definition) return source;
    const setting = source.platforms[definition.id];
    if (enabled) {
      if (setting.mode !== "off") return source;
      const restore = setting.lastEnabledMode && setting.lastEnabledMode !== "off"
        ? setting.lastEnabledMode : definition.defaultMode;
      setting.mode = PLATFORM_MODES.some((item) => item.value === restore) ? restore : definition.defaultMode;
    } else {
      if (setting.mode === "off") return source;
      setting.lastEnabledMode = setting.mode;
      setting.mode = "off";
    }
    return normalizeSettings(source);
  }

  // Single effective protection state for status UI. Ultimate Lock is a separate
  // indicator, not proof any site is protected. Order matters: off beats paused,
  // paused beats schedule, schedule beats empty selections.
  function getEffectiveStatus(settings, date) {
    const source = settings && settings.schemaVersion === SCHEMA_VERSION ? settings : normalizeSettings(settings);
    const now = date instanceof Date ? date : new Date(date || Date.now());
    if (source.ultimate && source.ultimate.enabled) {
      const active = isScheduleActive(source, now);
      return { key: active ? "locked-active" : "locked-paused", active, locked: true };
    }
    if (!source.protectionEnabled) return { key: "off", active: false, locked: false };
    if (source.pausedUntil && Date.parse(source.pausedUntil) > now.getTime()) {
      return { key: "paused", active: false, locked: false, pausedUntil: source.pausedUntil };
    }
    if (!isScheduleActive(source, now)) return { key: "outside-schedule", active: false, locked: false };
    const anyEnabled = PLATFORMS.some((platform) => {
      const setting = source.platforms[platform.id];
      if (!setting || setting.mode === "off") return false;
      if (setting.mode === "all") return true;
      if (setting.mode === "shortform") return platform.sections.some((section) => section.shortform);
      return platform.sections.some((section) => setting.sections[section.id]);
    }) || (source.customEntries && source.customEntries.length > 0);
    if (!anyEnabled) return { key: "no-selections", active: false, locked: false };
    return { key: "active", active: true, locked: false };
  }

  function statusText(status, formatTime) {
    const fmt = typeof formatTime === "function" ? formatTime : (value) => String(value);
    switch (status.key) {
      case "off": return "Protection is off";
      case "paused": return `Paused until ${fmt(status.pausedUntil)}`;
      case "outside-schedule": return "Outside your schedule";
      case "no-selections": return "Nothing selected to block";
      case "locked-active": return "Ultimate Lock is active";
      case "locked-paused": return "Ultimate Lock is active";
      case "active": return "Protection is active";
      default: return "Protection is active";
    }
  }

  function getReviewUrl(browser) {
    const key = browser === "firefox" || browser === "edge" ? browser : "chrome";
    const entry = DISTRIBUTION[key];
    return entry && entry.reviewUrl ? entry.reviewUrl : null;
  }

  function getSupportUrl() {
    return "https://github.com/InfectedDuck/Google-Chrome-Safe-Short-Video-content-blocker/issues";
  }

  // User-initiated diagnostics only: version, browser, effective state, per-site
  // modes and access flags. Never includes URLs, custom entries, page content,
  // or lock reflections, and never submits automatically.
  function buildDiagnostics(info) {
    const source = info || {};
    const lines = [
      `ReelLess ${source.version || "unknown"}`,
      `Browser: ${source.browser || "unknown"}`,
      `Status: ${source.status || "unknown"}`,
      `Schedule: ${source.schedule || "unknown"}`,
      `Ultimate Lock: ${source.locked ? "active" : "off"}`
    ];
    (source.platforms || []).forEach((item) => {
      lines.push(`${item.id}: ${item.mode}${item.access ? ` (${item.access})` : ""}`);
    });
    if (source.limitation) lines.push(`Note: ${source.limitation}`);
    return lines.join("\n");
  }

  const api = {
    SETTINGS_KEY, LEGACY_SETTINGS_KEY, STATS_KEY, META_KEY, SCHEMA_VERSION,
    CUSTOM_RULE_START, MAX_CUSTOM_ENTRIES, CORE_PLATFORM_IDS, DISTRIBUTION,
    SCHEDULE_PRESETS, PLATFORM_MODES, ENTRY_POINT_MODES, APPEARANCE_MODES, ULTIMATE_PROFILES, PLATFORMS,
    platformById, getDefaultSettings, normalizeSettings, normalizeStats, normalizeMeta,
    validateEntry, permissionPatternForEntry, localDay, isScheduleActive,
    platformForUrl, sectionForUrl, shouldBlockUrl, sectionBlocked, fullPageSections, setSectionBlocked, setPlatformEnabled,
    getEffectiveStatus, statusText, getReviewUrl, getSupportUrl, buildDiagnostics,
    hidesEntryPoints, activeSurfaces, buildDynamicRules,
    matchCustomEntry, customEntryForUrl, shouldBlockCustomUrl, customScriptPattern, customScriptId, customHostForEntry, splitCustomEntry,
    createUltimateSettings, releaseUltimateSettings, pauseUntil, reviewEligible
  };

  root.ReelLess = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
