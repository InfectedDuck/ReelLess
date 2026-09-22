(function () {
  "use strict";

  if (globalThis.__reellessGuardLoaded) return;
  globalThis.__reellessGuardLoaded = true;

  const R = globalThis.ReelLess;
  if (!R || !globalThis.chrome || !chrome.storage) return;

  const HIDDEN_ATTR = "data-reelless-hidden";
  const HIDDEN_SELECTOR = `[${HIDDEN_ATTR}]`;
  const FULL_SCAN_LIMIT = 4000;
  const FULL_SCAN_INTERVAL = 1000;
  // Shelves that carry a Shorts heading above their cards. Hiding the shelf takes the heading with
  // it, instead of leaving an orphaned "Shorts" title above an empty band. grid-shelf-view-model
  // backs the search-results shelf but also non-Shorts grids, so it is checked before it is used.
  const YOUTUBE_SHORTS_SHELVES = "ytd-reel-shelf-renderer, ytd-rich-shelf-renderer[is-shorts], grid-shelf-view-model";
  // Individual cards, tabs, and menu entries that can wrap a single Shorts link.
  // Guide anchors also carry title="Shorts" (mini entry aria-label="Shorts"); the href may
  // resolve late, so those wrappers are listed even though blockedEntry additionally treats
  // the label itself as a Shorts entry while the Shorts section is blocked. Chip and lockup
  // view-models cover the filter chip and the July-2026 desktop card refresh; the pivot bar
  // covers mobile bottom navigation.
  const YOUTUBE_ITEMS = "ytd-reel-item-renderer, ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model, yt-lockup-view-model, yt-chip-cloud-chip-renderer, ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer, ytm-pivot-bar-item-renderer, tp-yt-paper-tab, yt-tab-shape";

  // Platforms whose entry points are hidden by the rules in site_guard.css, with the sections those
  // rules cover. On these the script does no hiding at all, which is what removes the scanning cost
  // while scrolling: a card the style engine never lays out cannot shift anything when it goes.
  // The stylesheet only knows short-form entry points, so somebody in Selected sections mode who
  // also blocks Explore, Watch or Marketplace still gets the script path for those links.
  const CSS_COVERED = new Map([
    ["youtube", ["shorts"]],
    ["instagram", ["reels"]],
    ["facebook", ["reels"]]
  ]);
  const CSS_HAS_SUPPORT = typeof CSS !== "undefined" && typeof CSS.supports === "function"
    && CSS.supports("selector(:has(a))");
  // Conversations are never modified: Instagram Direct and Facebook Messenger. Nothing in a thread
  // is hidden, whatever it links to. Opening a Reel from one is still refused, because the click
  // and navigation guards look at the destination rather than the page.
  const CONVERSATION_PATHS = { instagram: /^\/direct(?:\/|$)/i, facebook: /^\/messages(?:\/|$)/i };
  // Locale-independent signals for a Facebook video player. The aria-label substrings are
  // English-only and miss localised renderings (e.g. ?locale=ru_RU, where Play/Video labels are
  // Russian), so the seek bar roles and video/player test ids are matched too: every Facebook
  // video renders a seek control and player chrome whatever language the page is in.
  const FB_VIDEO_UI = 'video, [aria-label*="Play"], [aria-label*="play"], [aria-label*="Video"], [aria-label*="video"], [role="slider"], [role="progressbar"], [data-testid*="video"], [data-testid*="Video"], [data-testid*="player"], [data-testid*="Player"]';
  // Facebook opens a feed video in a theater overlay without changing the address. It is usually
  // div[role="dialog"], but the role is not contractual: aria-modal overlays and unlabelled
  // portals render the same theater, so all three are treated as a dialog here.
  const FB_DIALOG_SELECTOR = 'div[role="dialog"], div[aria-modal="true"], div[role="alertdialog"]';

  function isConversationPage(platform) {
    const pattern = platform ? CONVERSATION_PATHS[platform.id] : null;
    return Boolean(pattern) && pattern.test(location.pathname);
  }

  let settings = R.getDefaultSettings();
  let lastHandled = "";
  let lastHref = location.href;
  // Captured once: mutation callbacks can run without the window global in scope (jsdom does
  // this), so a bare `location` inside handleMutations throws even though it resolves everywhere
  // else in the guard. The Location object itself stays live across same-document navigations.
  const pageLocation = location;
  // A fallback redirect (a Reel visit -> home page) that was issued but hasn't unloaded the
  // page yet. Retried on a bounded schedule if the page is somehow still here, then abandoned
  // in favour of the focus overlay rather than leaving a blocked page unguarded.
  let pendingRedirectUrl = null;
  let pendingRedirectAt = 0;
  let pendingRedirectTries = 0;
  const REDIRECT_RETRY_MS = 2500;
  const REDIRECT_MAX_TRIES = 3;
  let lastActive = null;
  let lastMode = null;
  let lastSurfaces = null;
  // The most recent address on this document that was allowed, and whether the first navigation
  // check has run. Together they tell an initial page load apart from a single-page-app rewrite.
  let lastAllowedHref = null;
  let initialNavigationDone = false;
  // When the reader last touched the page. It separates an address the site rewrote on its own
  // while scrolling from one that changed because somebody opened something.
  let lastGestureAt = 0;
  let lastScrollAt = 0;
  let screenPinned = false;
  // A focus screen raised for a theater overlay belongs to the overlay, not the address: the
  // page underneath stays allowed, so the navigation guard must not clear it on every pass
  // (that remove/re-add loop flickered the screen and counted a new visit each time). It is
  // cleared when the theater closes or the address moves.
  let theaterScreen = false;
  let observer = null;

  // Links already evaluated against the current settings. Keeping this off the DOM means busy feeds
  // never pay for attribute writes on thousands of links, and nothing needs to be cleared per mutation.
  let checked = new WeakSet();
  // Videos already paused and hidden. Unlike links there are only ever a few dozen, but without a
  // set every pass would redo ancestor walks for all of them while scrolling.
  let checkedVideos = new WeakSet();
  // Elements inserted since the last pass (plus links whose href actually changed).
  const pendingRoots = new Set();
  // Parents of changed nodes. Any that sit inside a hidden container mark it for re-evaluation, so a
  // recycled card that no longer holds a blocked link is shown again.
  const pendingParents = new Set();
  let fullScanDue = true;
  let scanScheduled = false;
  let scanFrame = 0;
  let scanTimer = null;

  // Was this address change somebody opening something, or the site rewriting its own address while
  // a feed scrolled past? Getting this wrong is expensive: a history traversal restores the saved
  // scroll offset of the entry it lands on, which throws a reader back up the feed. So the bar is
  // deliberately high. Somebody mid-scroll is reading, whatever they pressed a moment ago.
  function userDriven() {
    const now = Date.now();
    if (now - lastScrollAt < 700) return false;
    return now - lastGestureAt < 800;
  }

  function eventId(kind) {
    return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function record(kind) {
    chrome.runtime.sendMessage({ type: "recordBlockAttempt", eventId: eventId(kind) }).catch(() => {});
  }

  function removeFocusScreen() {
    const screen = document.getElementById("reelless-focus-screen");
    if (screen) screen.remove();
  }

  // A screen pinned by a blocked click belongs to that moment only; it goes away with the page state.
  function unpinFocusScreen() {
    if (!screenPinned) return;
    screenPinned = false;
    removeFocusScreen();
  }

  // Tells the stylesheet which of the two modes is in force. Absent means hide, so protection is
  // the default until the settings say otherwise.
  function currentMode() {
    const platform = R.platformForUrl(location.href);
    if (!platform || !R.isScheduleActive(settings, new Date())) return "off";
    const setting = settings.platforms[platform.id];
    if (!setting || setting.mode === "off") return "off";
    // A stylesheet cannot read the address, so this is where a conversation is excused from it.
    if (isConversationPage(platform)) return "off";
    if (!R.hidesEntryPoints(settings, platform)) return "keep";
    // The rules hide a section's entry points wholesale, so they are only armed while that section
    // is blocked. hidesEntryPoints does not look at per-section choices; without this, somebody in
    // Selected sections mode who deliberately left Reels unchecked would lose them anyway.
    const covered = CSS_COVERED.get(platform.id);
    if (!covered) return "hide";
    return covered.some((sectionId) => R.sectionBlocked(settings, platform, sectionId)) ? "hide" : "keep";
  }

  function applyModeAttribute() {
    const element = document.documentElement;
    if (!element) return;
    // Keep feed-card geometry on Instagram Home. Collapsing a run of Reels can leave
    // the feed's loading sentinel on screen and repeatedly trigger more loading.
    const modePlatform = R.platformForUrl(location.href);
    const instagramFeed = modePlatform?.id === "instagram"
      && location.pathname === "/";
    if (element.hasAttribute("data-reelless-instagram-feed") !== instagramFeed) {
      element.toggleAttribute("data-reelless-instagram-feed", instagramFeed);
    }
    // Facebook feed posts keep their geometry as a compact "Video blocked" / "Reel blocked"
    // placeholder (like Instagram Home), so collapsing a run of videos never yanks the reader
    // up the feed. The attribute simply marks Facebook surfaces where that placeholder applies;
    // conversations are excluded and never touched.
    const facebookFeed = modePlatform?.id === "facebook" && !isConversationPage(modePlatform);
    if (element.hasAttribute("data-reelless-facebook-feed") !== facebookFeed) {
      element.toggleAttribute("data-reelless-facebook-feed", facebookFeed);
    }
    const next = currentMode();
    // Only write on a real change. This attribute gates the :has() rules, so touching it forces the
    // style engine to re-resolve them across the whole document; rewriting it every pass cost more
    // than the scanning it replaced.
    if (lastMode !== next) {
      lastMode = next;
      element.dataset.reellessMode = next;
    }
    applySurfaceAttribute(element);
  }

  // Space separated ids, matched in the stylesheet with ~=. Written only on change, for the same
  // reason as the mode attribute: touching it re-resolves every rule it gates.
  function applySurfaceAttribute(element) {
    const platform = R.platformForUrl(location.href);
    const ids = platform ? R.activeSurfaces(settings, platform).filter((id) =>
      id !== "xExplore" || /^\/explore(?:\/|$)/i.test(location.pathname)) : [];
    // Facebook opens a video from the feed in a dialog and never changes the address, so there is
    // no navigation for the guard to refuse and nothing the click guard can recognise: the target
    // is not a link. Honouring a blocked Watch section in the feed therefore means taking the
    // video posts out of it, which the stylesheet does from this token. Entry-point "keep" mode
    // deliberately does not qualify, since keeping something visible but unopenable is exactly
    // what cannot be delivered here.
    if (platform && platform.id === "facebook" && !isConversationPage(platform)
      && R.isScheduleActive(settings, new Date())
      && R.hidesEntryPoints(settings, platform)
      && R.sectionBlocked(settings, platform, "watch")) {
      ids.push("videoPosts");
    }
    const next = ids.join(" ");
    if (lastSurfaces === next) return;
    lastSurfaces = next;
    if (next) element.dataset.reellessSurfaces = next;
    else element.removeAttribute("data-reelless-surfaces");
  }

  // True when the stylesheet is already hiding everything this platform needs hidden: every section
  // blocked right now is one its rules cover. Off has nothing to hide, and Block all puts the focus
  // screen over every page, so neither needs the script either.
  function cssIsHandlingHiding(platform) {
    if (!CSS_HAS_SUPPORT) return false;
    const covered = platform ? CSS_COVERED.get(platform.id) : null;
    if (!covered) return false;
    const setting = settings.platforms[platform.id];
    if (!setting || setting.mode === "off" || setting.mode === "all") return true;
    return platform.sections.every((section) => covered.includes(section.id) || !R.sectionBlocked(settings, platform, section.id));
  }

  // A personal custom boundary blocks its page right now (schedule-aware).
  function customActiveNow(when) {
    return settings.customEntries.length > 0
      && R.shouldBlockCustomUrl(settings, location.href, when || new Date()).blocked;
  }

  // Whether the script has any hiding to do on this page. Nothing on a conversation, and nothing
  // where the stylesheet already covers it. Custom-boundary pages have no platform, so they are
  // watched while their boundary is active.
  function scriptHidesHere() {
    const platform = R.platformForUrl(location.href);
    if (platform) return !isConversationPage(platform) && !cssIsHandlingHiding(platform);
    return customActiveNow();
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(handleMutations);
    observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["href", "title", "aria-label"], attributeOldValue: true
    });
  }

  function stopObserver() {
    if (!observer) return;
    observer.disconnect();
    observer = null;
    pendingRoots.clear();
    pendingParents.clear();
  }

  // Watching the DOM is only worth its cost where the script itself has hiding to do.
  function syncObserver() {
    if (!scriptHidesHere()) {
      if (observer) {
        stopObserver();
        // Drop anything the script hid before the stylesheet took over, or before the page became
        // a conversation.
        document.querySelectorAll(HIDDEN_SELECTOR).forEach((node) => node.removeAttribute(HIDDEN_ATTR));
      }
      return;
    }
    startObserver();
  }

  function clearMarkers() {
    checked = new WeakSet();
    checkedVideos = new WeakSet();
    pendingRoots.clear();
    pendingParents.clear();
    document.querySelectorAll(HIDDEN_SELECTOR).forEach((node) => node.removeAttribute(HIDDEN_ATTR));
  }

  // X recommendation markup is not a stable public interface. Only hide containers we can
  // identify positively, never the primary/sidebar column itself or anything containing search.
  function syncXSurfaces() {
    const marks = new Map();
    const tokens = new Set((document.documentElement.dataset.reellessSurfaces || "").split(" "));
    const protectedControls = 'input, textarea, [role="search"], [role="searchbox"], [role="combobox"], [data-testid="SearchBox_Search_Input"], [data-testid="DMDrawer"], [data-testid="chat-drawer"], nav, [role="navigation"]';
    if (R.platformForUrl(location.href)?.id === "x") {
      const primary = document.querySelector('[data-testid="primaryColumn"]');
      if (primary && tokens.has("xExplore")) {
        // Search sits above these regions. Search suggestions and /search results are untouched.
        primary.querySelectorAll('[role="region"], [role="tablist"]').forEach((node) => {
          const identified = node.matches('[role="tablist"]')
            || node.querySelector('[data-testid="cellInnerDiv"], [data-testid="trend"], article');
          if (identified && !node.querySelector(protectedControls)) marks.set(node, "xExplore");
        });
      }
      const sidebar = document.querySelector('[data-testid="sidebarColumn"]');
      if (sidebar && tokens.has("xSidebar")) {
        sidebar.querySelectorAll('[data-testid="trend"], [data-testid="UserCell"], a[href^="/i/news/"], a[href^="/i/events/"]').forEach((marker) => {
          // The smallest headed module takes its title and "Show more" link with its cards.
          for (let node = marker.parentElement; node && node !== sidebar; node = node.parentElement) {
            if (node.querySelector(protectedControls) || node.matches('main, [role="main"]')) break;
            if (node.querySelector('h2, h3, [role="heading"]')) {
              marks.set(node, "xSidebar");
              break;
            }
          }
        });
      }
    }
    document.querySelectorAll('[data-reelless-x-hidden]').forEach((node) => {
      if (!marks.has(node)) node.removeAttribute("data-reelless-x-hidden");
    });
    marks.forEach((surface, node) => {
      if (node.dataset.reellessXHidden !== surface) node.dataset.reellessXHidden = surface;
    });

    const redditMarks = new Set();
    if (R.platformForUrl(location.href)?.id === "reddit" && tokens.has("redditSidebar")) {
      // Reddit uses web-component names and hrefs more consistently than classes. Start from a
      // known promotional destination and take only its local expandable section.
      const promotional = [
        'a[href^="/games"]', 'a[href*="reddit.com/games"]',
        'a[href^="/best/communities"]', 'a[href^="/topics"]',
        'a[href^="/explore/communities"]'
      ].join(", ");
      document.querySelectorAll(promotional).forEach((marker) => {
        const group = marker.closest("faceplate-expandable-section-helper, details, section, [role='group']");
        if (!group || group.matches("main, [role='main']") || group.querySelector("search, [role='search']")) return;
        // Never take a container that also owns intentional navigation or a user's own lists.
        if (group.querySelector('a[href^="/notifications"], a[href^="/message"], a[href^="/chat"], a[href^="/user"], a[href^="/settings"], a[href^="/submit"]')) return;
        redditMarks.add(group);
      });
    }
    document.querySelectorAll('[data-reelless-reddit-hidden]').forEach((node) => {
      if (!redditMarks.has(node)) node.removeAttribute("data-reelless-reddit-hidden");
    });
    redditMarks.forEach((node) => { node.dataset.reellessRedditHidden = "sidebar"; });
  }

  // Pseudo-platform identifying a personal custom boundary on pages no platform owns.
  const CUSTOM_PLATFORM = { id: "custom", label: "Custom site" };

  function focusCopy(platform, section) {
    if (platform.id === "custom") {
      return {
        title: "This page is outside your focus plan",
        body: `ReelLess is keeping ${section && section.id ? section.id : "this custom page"} out of this session. You can change your boundary when you mean to.`
      };
    }
    if (platform.id === "tiktok") {
      return {
        title: "TikTok is outside your focus plan",
        body: "ReelLess is keeping TikTok feed and video pages out of this session. You can change your boundary when you mean to."
      };
    }
    if (platform.id === "facebook" && section && section.id === "watch") {
      return {
        title: "This video is outside your focus plan",
        body: "ReelLess is keeping Facebook videos out of this session. You can change your boundary when you mean to."
      };
    }
    return {
      title: "This section is outside your focus plan",
      body: `${platform.label} matches a boundary you chose in ReelLess.`
    };
  }

  // Use real landing pages: section matchers can also be incomplete routes such as /i/status.
  const FOCUS_DESTINATIONS = {
    youtube: [["Home", "/"], ["Subscriptions", "/feed/subscriptions"], ["History", "/feed/history"]],
    instagram: [["Home", "/"], ["Messages", "/direct/inbox/"], ["Explore", "/explore/"]],
    facebook: [["Home", "/"], ["Messages", "/messages/"], ["Groups", "/groups/"], ["Marketplace", "/marketplace/"]],
    tiktok: [["Home", "/"], ["Messages", "/messages"], ["Upload", "/upload"], ["Settings", "/setting"]],
    x: [["Home", "/home"], ["Explore", "/explore"], ["Notifications", "/notifications"], ["Chat", "/messages"], ["Bookmarks", "/i/bookmarks"]],
    reddit: [["Home", "/"], ["Search", "/search/"], ["Notifications", "/notifications"], ["Chat", "/chat"], ["Saved", "/user/me/saved/"]],
    snapchat: [["Home", "/"], ["Stories", "/stories"], ["Chat", "/web"]],
    twitch: [["Home", "/"], ["Following", "/directory/following"], ["Browse", "/directory"]],
    pinterest: [["Home", "/"], ["Explore", "/ideas/"], ["Search", "/search/pins/"]],
    linkedin: [["Feed", "/feed/"], ["Messages", "/messaging/"], ["Jobs", "/jobs/"]],
    threads: [["Home", "/"], ["Search", "/search"], ["Activity", "/activity"], ["Saved", "/saved"]]
  };

  function focusDestinations(platform) {
    const customRules = R.buildDynamicRules(settings, settings.customEntries, new Date());
    return (FOCUS_DESTINATIONS[platform.id] || []).map(([label, path]) => ({
      label: platform.id === "x" && path === "/explore" && R.activeSurfaces(settings, platform).includes("xExplore") ? "Search" : label,
      url: new URL(path, location.origin)
    })).filter(({ url }) => url.pathname !== location.pathname
      && !R.shouldBlockUrl(settings, url, new Date()).blocked
      && !customRules.some((rule) => new RegExp(rule.condition.regexFilter, "i").test(url.href)));
  }

  function showFocusScreen(platform, pinned, section) {
    if (document.getElementById("reelless-focus-screen")) return;
    const mount = () => {
      if (!document.documentElement || document.getElementById("reelless-focus-screen")) return;
      const copy = focusCopy(platform, section);
      const screen = document.createElement("section");
      screen.id = "reelless-focus-screen";
      screen.dataset.theme = settings.appearance === "system"
        ? (globalThis.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : settings.appearance;
      screen.setAttribute("role", "dialog");
      screen.setAttribute("aria-modal", "true");
      screen.setAttribute("aria-labelledby", "reelless-focus-title");
      screen.innerHTML = `
        <div class="reelless-card">
          <div class="reelless-mark" aria-hidden="true">ReelLess</div>
          <h1 id="reelless-focus-title"></h1>
          <p></p>
          <nav class="reelless-destinations" aria-label="Allowed pages">
            <p>Go to an allowed page</p>
            <div class="reelless-links"></div>
          </nav>
          <div class="reelless-actions">
            <button type="button" data-action="pause">Pause for 15 minutes</button>
            <button type="button" data-action="settings">Open settings</button>
            <button type="button" data-action="dismiss">Stay here</button>
          </div>
        </div>`;
      screen.querySelector("h1").textContent = copy.title;
      screen.querySelector("p").textContent = settings.ultimate.enabled ? `${copy.body} Ultimate Lock is active, so pausing is unavailable.` : copy.body;
      const destinations = focusDestinations(platform);
      const navigation = screen.querySelector(".reelless-destinations");
      if (!destinations.length) navigation.remove();
      for (const { label, url } of destinations) {
        const link = document.createElement("a");
        link.href = url.href;
        link.textContent = label;
        navigation.querySelector(".reelless-links").appendChild(link);
      }
      const pauseButton = screen.querySelector('[data-action="pause"]');
      if (settings.ultimate.enabled) {
        pauseButton.remove();
      } else {
        pauseButton.addEventListener("click", async () => {
          const response = await chrome.runtime.sendMessage({ type: "pause", duration: 15 }).catch(() => null);
          if (response && response.locked) return;
          screenPinned = false;
          removeFocusScreen();
          requestFullScan();
        });
      }
      screen.querySelector('[data-action="settings"]').addEventListener("click", () => {
        chrome.runtime.openOptionsPage();
      });
      const dismissButton = screen.querySelector('[data-action="dismiss"]');
      if (pinned) {
        // A blocked click leaves the visitor on a page that is still allowed, so they can simply stay.
        dismissButton.addEventListener("click", () => {
          screenPinned = false;
          removeFocusScreen();
          requestFullScan();
        });
      } else {
        dismissButton.remove();
      }
      document.documentElement.appendChild(screen);
    };
    if (document.documentElement) mount();
    else document.addEventListener("DOMContentLoaded", mount, { once: true });
  }

  // A "fallback" is somewhere to send the visitor instead of a blocked page: a profile or
  // page they were already on, or the site's home. YouTube Shorts deliberately have none:
  // YouTube plays Shorts videos on /watch pages too, so converting a Short to its watch URL
  // leaves it fully watchable. A blocked Short is therefore always stopped in place with the
  // focus screen, which carries links to allowed pages.
  function redirectPlan(decision, url) {
    if (decision.reason === "all") return null;
    const section = decision.section;
    if (decision.platform.id === "instagram" && section && section.id === "reels") {
      // Coming from a profile's Reels tab, the profile itself is a less disorienting landing than the feed.
      const profile = url.pathname.match(/^\/([^/]+)\/reels?(?:\/|$)/i);
      return { url: profile ? `${url.origin}/${profile[1]}/` : decision.platform.homeUrl, kind: "fallback" };
    }
    if (decision.platform.id === "facebook" && section && section.id === "reels") {
      // Coming from a page's Reels tab, the page itself is a less disorienting landing than the
      // feed. The first segment of a route like /watch/reels/ is not a page name, so those and a
      // bare /reel/{id} fall back to the feed instead.
      const named = url.pathname.match(/^\/([^/]+)\/reels?(?:\/|$)/i);
      const handle = named ? named[1] : null;
      const route = handle && ["watch", "reel", "reels", "share", "marketplace", "groups", "stories"].includes(handle.toLowerCase());
      return { url: handle && !route ? `${url.origin}/${handle}/` : decision.platform.homeUrl, kind: "fallback" };
    }
    return null;
  }

  // Retries deliberately do not recount: the visit was already counted when the redirect
  // was first issued, and a slow unload must not inflate the stats.
  function issueRedirect(url, count) {
    pendingRedirectUrl = url;
    pendingRedirectAt = Date.now();
    pendingRedirectTries += 1;
    if (count !== false) record("navigation");
    try {
      location.replace(url);
    } catch (_error) {
      // The page stays put, so the passes below retry on a bounded schedule.
    }
  }

  function handleCurrentNavigation() {
    const decision = R.shouldBlockUrl(settings, location.href, new Date());
    const wasInitialCheck = !initialNavigationDone;
    initialNavigationDone = true;
    if (!decision.blocked) {
      // No platform rule matched: a personal custom boundary may still block this page.
      // Custom pages stop in place like any blocked page (no fallback destination exists).
      const custom = R.shouldBlockCustomUrl(settings, location.href, new Date());
      if (custom.blocked) {
        if (theaterScreen) {
          theaterScreen = false;
          removeFocusScreen();
        }
        const customKey = `${location.href}|custom|${custom.entry}`;
        if (customKey === lastHandled) {
          if (!document.getElementById("reelless-focus-screen")) {
            screenPinned = false;
            showFocusScreen(CUSTOM_PLATFORM, false, { id: custom.entry });
          }
          return;
        }
        lastHandled = customKey;
        lastAllowedHref = location.href;
        pendingRedirectUrl = null;
        pendingRedirectTries = 0;
        if (!document.getElementById("reelless-focus-screen")) record("navigation");
        screenPinned = false;
        showFocusScreen(CUSTOM_PLATFORM, false, { id: custom.entry });
        return;
      }
      lastAllowedHref = location.href;
      lastHandled = "";
      pendingRedirectUrl = null;
      pendingRedirectTries = 0;
      if (theaterScreen) {
        // A theater screen belongs to the overlay, not the address. Keep it while the
        // theater is still open; clear it once the theater closes so the feed returns.
        if (!findFacebookTheater()) {
          theaterScreen = false;
          if (!screenPinned) removeFocusScreen();
        }
      } else if (!screenPinned) {
        removeFocusScreen();
      }
      return;
    }
    // A blocked address replaces any theater overlay: the old theater screen belongs to
    // the previous overlay, so drop it and let the navigation screen take over.
    if (theaterScreen) {
      theaterScreen = false;
      removeFocusScreen();
    }
    const key = `${location.href}|${decision.platform.id}|${decision.reason}`;
    const plan = redirectPlan(decision, new URL(location.href));
    if (key === lastHandled) {
      // Already handled, but nothing here is self-healing on its own. A late render (YouTube's
      // player boot on /shorts does exactly this) can drop the focus overlay, and a fallback
      // redirect can fail to unload the page. Either way the reader would be left on a blocked
      // page with no guard, so restore one without counting a second visit.
      if (plan && plan.url !== location.href) {
        if (pendingRedirectUrl === plan.url && pendingRedirectTries > REDIRECT_MAX_TRIES) {
          // Redirecting is not getting us off this page; block it in place instead.
          pendingRedirectUrl = null;
        } else if (pendingRedirectUrl !== plan.url || Date.now() - pendingRedirectAt > REDIRECT_RETRY_MS) {
          issueRedirect(plan.url, false);
          return;
        } else {
          // A redirect is already in flight; wait for the unload.
          return;
        }
      }
      if (!document.getElementById("reelless-focus-screen")) {
        screenPinned = false;
        showFocusScreen(decision.platform, false, decision.section);
      }
      return;
    }
    lastHandled = key;

    // Instagram rewrites its address as reels scroll past the viewport, without loading anything.
    // Answering that with a real navigation reloads the feed and throws the reader back to the top,
    // repeatedly, which makes the page impossible to read. When the page we are already on was
    // allowed and the redirect would only be a fallback destination, put the address back instead.
    // This is deliberately not counted: nobody asked to go anywhere.
    if (!wasInitialCheck && plan && plan.kind === "fallback" && lastAllowedHref && lastAllowedHref !== location.href) {
      try {
        const state = history.state;
        history.replaceState(state, "", lastAllowedHref);
        lastHref = location.href;
        lastHandled = "";
        // Deliberately never history.back(). A history traversal restores the scroll offset saved
        // on the entry it lands on, which throws the reader back up the feed; that was measured at
        // up to four screens per reel. Replacing the address moves nothing. Some viewers are opened
        // by the page rather than its router and only close when they hear the address move, so
        // when somebody actually opened something, tell them it moved without traversing.
        if (userDriven()) {
          record("navigation");
          globalThis.dispatchEvent(new PopStateEvent("popstate", { state }));
        }
        return;
      } catch (_error) {
        // History is unavailable, so fall through to the ordinary handling below.
      }
    }

    if (plan && plan.url !== location.href) {
      pendingRedirectTries = 0;
      issueRedirect(plan.url);
      return;
    }
    // Re-checks after a settings change must not count the same visit twice.
    if (!document.getElementById("reelless-focus-screen")) record("navigation");
    screenPinned = false;
    showFocusScreen(decision.platform, false, decision.section);
  }

  function safeContainer(anchor, platform) {
    let candidate = anchor;
    if (platform && platform.id === "youtube") {
      const shelf = anchor.closest(YOUTUBE_SHORTS_SHELVES);
      // Only take the whole shelf when nothing ordinary is inside it, so a mixed grid loses its
      // Shorts cards rather than the videos next to them.
      const shelfIsAllShorts = shelf && !shelf.querySelector('a[href*="/watch"]');
      candidate = shelfIsAllShorts ? (shelf.closest("ytd-rich-section-renderer") || shelf) : (anchor.closest(YOUTUBE_ITEMS) || anchor);
    } else if (platform && (platform.id === "instagram" || platform.id === "facebook")) {
      const selector = platform.id === "facebook"
        ? "div[aria-posinset], article, section, [role='article'], li, [role='listitem'], div[data-pagelet]"
        : "article, [role='article'], li, [role='listitem']";
      const nested = platform.id === "facebook"
        ? "article, [role='article'], li, [role='listitem'], div[aria-posinset], div[data-pagelet]"
        : "article, [role='article'], li, [role='listitem']";
      const card = anchor.closest(selector);
      if (card && !card.querySelector(nested)
        && card.querySelectorAll("a[href]").length <= 8) candidate = card;
    } else {
      const card = anchor.closest("article, li, [role='listitem']");
      if (card && card.querySelectorAll("a[href]").length <= 8) candidate = card;
    }
    if (!candidate || candidate === document.body || candidate === document.documentElement) return anchor;
    if (candidate.matches("main, [role='main'], header") || candidate.querySelector("main, [role='main']")) return anchor;
    return candidate;
  }

  function anchorUrl(anchor) {
    const href = typeof anchor.href === "string" ? anchor.href : anchor.getAttribute("href");
    try { return new URL(href, location.href); } catch (_error) { return null; }
  }

  // YouTube's sidebar entries also label the anchor title="Shorts" (mini entry
  // aria-label="Shorts"), and the href can resolve after first paint. While the Shorts
  // section is blocked such a label is a Shorts entry on its own, so the nav row is hidden
  // even before any href is present.
  function isShortsNavLabel(anchor, platform) {
    if (!platform || platform.id !== "youtube") return false;
    if (!R.sectionBlocked(settings, platform, "shorts")) return false;
    if (typeof anchor.closest !== "function") return false;
    const wrapper = anchor.closest("ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer, ytm-pivot-bar-item-renderer");
    if (!wrapper) return false;
    if (anchor.getAttribute("title") === "Shorts") return true;
    if (anchor.getAttribute("aria-label") === "Shorts") return true;
    if (wrapper.getAttribute("aria-label") === "Shorts") return true;
    return false;
  }

  function blockedEntry(anchor, platform, now) {
    if (isShortsNavLabel(anchor, platform)) return true;
    const url = anchorUrl(anchor);
    if (!url) return false;
    if (platform) {
      const decision = R.shouldBlockUrl(settings, url, now);
      if (decision.blocked && decision.platform && decision.platform.id === platform.id && decision.section) return true;
    }
    // Personal custom boundaries hide their links wherever the guard runs, on platform pages
    // and custom pages alike.
    return R.shouldBlockCustomUrl(settings, url, now).blocked;
  }

  function evaluateAnchor(anchor, platform, now) {
    checked.add(anchor);
    if (!blockedEntry(anchor, platform, now)) return;
    let container = safeContainer(anchor, platform);
    // A Watch link in renamed markup matches no strict post selector, and hiding the bare link
    // leaves the thumbnail and player visible. Take the post-sized wrapper instead.
    if (container === anchor && platform && platform.id === "facebook" && facebookWatchBlocked(now)) {
      container = facebookFallbackPost(anchor) || anchor;
    }
    if (!container.hasAttribute(HIDDEN_ATTR)) container.setAttribute(HIDDEN_ATTR, "true");
  }

  function evaluateWithin(root, platform, now, fbVideoHiding) {
    if (root.matches && (root.matches("a[href]") || root.matches('a[title="Shorts"]')) && !checked.has(root)) evaluateAnchor(root, platform, now);
    const anchors = root.querySelectorAll ? root.querySelectorAll('a[href], a[title="Shorts"]') : [];
    for (let index = 0; index < anchors.length; index += 1) {
      if (!checked.has(anchors[index])) evaluateAnchor(anchors[index], platform, now);
    }
    // The Watch-hiding decision is computed once per pass by the caller: feeds can add dozens of
    // roots per scroll tick and the check parses the URL and schedule on every call.
    if (fbVideoHiding) {
      evaluateVideosWithin(root);
    }
  }

  // True while opening a Facebook video would be blocked right now: the Watch section is
  // blocked and this is not a Messenger conversation (which is never touched). Like anchor
  // clicks, this holds in both entry-point modes: Hidden removes the posts, Keep leaves them
  // visible but still stops them from opening.
  function facebookWatchOpenBlocked(now) {
    const platform = R.platformForUrl(location.href);
    if (!platform || platform.id !== "facebook") return false;
    if (isConversationPage(platform)) return false;
    const when = now instanceof Date ? now : new Date();
    return R.isScheduleActive(settings, when)
      && R.sectionBlocked(settings, platform, "watch");
  }

  // True while Facebook video posts should also be hidden: opening is blocked and entry points
  // are set to Hidden. Keep mode deliberately does not qualify for hiding, matching the
  // stylesheet token.
  function facebookWatchBlocked(now) {
    const platform = R.platformForUrl(location.href);
    if (!platform || platform.id !== "facebook") return false;
    return facebookWatchOpenBlocked(now) && R.hidesEntryPoints(settings, platform);
  }

  function facebookWatchSection() {
    const platform = R.platformForUrl(location.href);
    if (!platform) return null;
    return (platform.sections || []).find((section) => section.id === "watch") || { id: "watch" };
  }

  // True when a node sits inside a Reel post (carries a Reel link). Used so blocking Watch
  // while keeping Reels leaves Reel players alone.
  function facebookReelPost(node) {
    if (!node || typeof node.closest !== "function") return false;
    const holder = node.closest("div[aria-posinset], article, section, [role='article'], li, [role='listitem'], div[data-pagelet]");
    const scope = holder || (node.parentElement ? node.parentElement : null);
    if (!scope || typeof scope.querySelector !== "function") return false;
    return Boolean(scope.querySelector("a[href*=\"/reel/\"], a[href*=\"/reels/\"], a[href*=\"/share/r/\"]"));
  }

  function facebookReelsAllowed() {
    const platform = R.platformForUrl(location.href);
    if (!platform || platform.id !== "facebook") return false;
    return !R.sectionBlocked(settings, platform, "reels");
  }

  // The feed post around a video element. Facebook renders feed posts as div[aria-posinset];
  // article and div[data-pagelet] cover older and newer renderings, section covers post-level
  // landmarks in newer markup. Never take a wrapper holding another post or main.
  function facebookVideoContainer(video) {
    if (!video || typeof video.closest !== "function") return null;
    const SELECTOR = "div[aria-posinset], article, section, [role='article'], li, [role='listitem'], div[data-pagelet]";
    const NESTED = "div[aria-posinset], article, [role='article'], li, [role='listitem'], div[data-pagelet]";
    const card = video.closest(SELECTOR);
    if (card) {
      if (card.querySelector(NESTED)) {
        // The video sits in a wrapper around other posts; fall back to the closest inner post that
        // directly holds it, if any.
        let inner = video;
        while (inner && inner !== card) {
          if (inner.matches && inner.matches(SELECTOR)) return inner;
          inner = inner.parentElement;
        }
        return null;
      }
      if (card === document.body || card === document.documentElement) return null;
      if (card.matches("main, [role='main'], header") || card.querySelector("main, [role='main']")) return null;
      return card;
    }
    // Newer markup the selectors don't know yet: walk up a bounded number of levels for a
    // post-sized wrapper (a few links at most; the feed itself holds hundreds), so the post is
    // hidden rather than just its player.
    return facebookFallbackPost(video);
  }

  // Markup-agnostic post wrapper: walks up a bounded number of levels for a post-sized block
  // (a few links at most; the feed itself holds hundreds). Used wherever the strict post
  // selectors miss — renamed containers, plain divs — so a feed video post is hidden rather
  // than left visible with only its link or control taken. Never takes main, header, or a
  // wrapper holding another post or main.
  function facebookFallbackPost(node) {
    if (!node) return null;
    const NESTED = "div[aria-posinset], article, [role='article'], li, [role='listitem'], div[data-pagelet]";
    let current = node.parentElement;
    for (let depth = 0; depth < 6 && current; depth += 1) {
      if (current === document.body || current === document.documentElement) return null;
      if (current.matches && current.matches("main, [role='main'], header")) return null;
      if (current.querySelector && (current.querySelector("main, [role='main']") || current.querySelector(NESTED))) {
        current = current.parentElement;
        continue;
      }
      if (current.matches && current.matches("div, section") && current.querySelectorAll
        && current.querySelectorAll("a[href]").length <= 8) return current;
      current = current.parentElement;
    }
    return null;
  }

  function pauseVideo(video) {
    try {
      if (video && typeof video.pause === "function" && !video.paused) video.pause();
    } catch (_error) {
      // Pausing must never break the guard.
    }
    try {
      if (video) {
        video.removeAttribute("autoplay");
        if ("preload" in video) video.preload = "none";
      }
    } catch (_error) {
      // Attribute cleanup is best-effort only.
    }
  }

  // Pauses a video and hides its post (or the video itself when no post container matches,
  // e.g. newer markup the selectors don't know yet). Skipped for Reel players while Reels stay
  // allowed. Each video is fully processed once (checkedVideos); later passes only re-pause it
  // if it started playing again, which keeps every scroll-tick pass cheap.
  function processFacebookVideo(video, reelsAllowed) {
    if (!video) return;
    if (video.closest && video.closest('[data-reelless-hidden], #reelless-focus-screen')) return;
    if (reelsAllowed && facebookReelPost(video)) return;
    pauseVideo(video);
    if (checkedVideos.has(video)) return;
    checkedVideos.add(video);
    const container = facebookVideoContainer(video);
    if (container && !container.hasAttribute(HIDDEN_ATTR)) container.setAttribute(HIDDEN_ATTR, "true");
    else if (!container && !video.hasAttribute(HIDDEN_ATTR)) video.setAttribute(HIDDEN_ATTR, "true");
  }

  function evaluateVideosWithin(root) {
    const videos = [];
    if (root.matches && root.matches("video")) videos.push(root);
    if (root.querySelectorAll) {
      const found = root.querySelectorAll("video");
      for (let index = 0; index < found.length; index += 1) videos.push(found[index]);
    }
    // Thumbnail-only posts (a play control before any <video> exists) are hidden here only
    // within the newly inserted subtree: bounded work, unlike the old document-wide
    // attribute-substring sweep that stalled scrolling. The stylesheet covers the rest.
    // FB_VIDEO_UI is locale-independent: English aria-labels miss localised renderings, while
    // every player still carries a seek control and player chrome.
    const controls = [];
    if (root.matches && root.matches(FB_VIDEO_UI) && !(root.matches("video"))) controls.push(root);
    if (root.querySelectorAll) {
      const found = root.querySelectorAll(FB_VIDEO_UI);
      for (let index = 0; index < found.length; index += 1) {
        if (found[index].matches && found[index].matches("video")) continue;
        controls.push(found[index]);
      }
    }
    if (!videos.length && !controls.length) return;
    const reelsAllowed = facebookReelsAllowed();
    for (const video of videos) processFacebookVideo(video, reelsAllowed);
    for (const control of controls) processFacebookControl(control, reelsAllowed);
  }

  // Hides the post around a thumbnail-only play control (no <video> rendered yet). Skipped for
  // Reel players while Reels stay allowed.
  function processFacebookControl(control, reelsAllowed) {
    if (!control) return;
    if (control.closest && control.closest('[data-reelless-hidden], #reelless-focus-screen, a[href]')) return;
    if (reelsAllowed && facebookReelPost(control)) return;
    const strict = control.closest ? control.closest("div[aria-posinset], article, section, [role='article'], li, [role='listitem'], div[data-pagelet]") : null;
    const usable = strict && !strict.querySelector("div[aria-posinset], article, [role='article'], li, [role='listitem'], div[data-pagelet]")
      ? strict
      : facebookFallbackPost(control);
    const container = usable || control;
    if (!container.hasAttribute(HIDDEN_ATTR)) container.setAttribute(HIDDEN_ATTR, "true");
  }

  function hideFacebookVideoPosts(full) {
    if (!facebookWatchBlocked()) return;
    // Cheap tag sweep on every pass: <video> elements are few, unlike links. New videos are
    // fully processed once via checkedVideos; this also re-pauses anything that started playing
    // without fresh DOM (autoplay), which the play listener usually catches first.
    const videos = document.querySelectorAll("video");
    const limit = Math.min(videos.length, FULL_SCAN_LIMIT);
    const reelsAllowed = facebookReelsAllowed();
    for (let index = 0; index < limit; index += 1) {
      const video = videos[index];
      if (!checkedVideos.has(video)) processFacebookVideo(video, reelsAllowed);
      else if (!video.paused) pauseVideo(video);
    }
    if (full) {
      // Thumbnail-only posts have no <video> yet and incremental passes only see newly inserted
      // subtrees, so anything already in the document before the observer started would never
      // be evaluated. The periodic full sweep closes that gap; it runs rarely (not per scroll
      // tick), which keeps the old document-wide attribute-sweep cost off the scrolling path.
      const controls = document.querySelectorAll(FB_VIDEO_UI);
      const controlLimit = Math.min(controls.length, FULL_SCAN_LIMIT);
      for (let index = 0; index < controlLimit; index += 1) {
        const control = controls[index];
        if (control.matches && control.matches("video")) continue;
        processFacebookControl(control, reelsAllowed);
      }
    }
  }

  // True when a video element is playing inside a theater overlay rather than inline in the
  // feed: it sits in a dialog/aria-modal overlay, or it was rendered in a body-level portal
  // outside the feed and main landmarks altogether (Facebook renders the theater that way, with
  // no address change, so markup renames cannot be allowed to lose it).
  function facebookTheaterOverlay(video) {
    if (!video || typeof video.closest !== "function") return null;
    const overlay = video.closest(FB_DIALOG_SELECTOR);
    if (overlay) return overlay;
    // Portal fallback: a theater video lives outside the feed and the page landmarks, while
    // inline feed videos always sit inside div[role="feed"], main or [role="main"].
    if (!video.closest('div[role="feed"], main, [role="main"]')) return video;
    return null;
  }

  function facebookShowVideoScreen() {
    if (document.getElementById("reelless-focus-screen")) return true;
    const platform = R.platformForUrl(location.href);
    record("navigation");
    screenPinned = false;
    theaterScreen = true;
    showFocusScreen(platform, false, facebookWatchSection());
    return true;
  }

  // Locates the theater overlay without side effects: a dialog/aria-modal overlay carrying a
  // player, or a body-level portal video outside the feed and page landmarks (no dialog role at
  // all). Reel theaters are skipped while Reels stay allowed. Returns the overlay and its video
  // (when one has booted), or null when no theater is open.
  function findFacebookTheater() {
    if (!facebookWatchOpenBlocked()) return null;
    const reelsAllowed = facebookReelsAllowed();
    const dialogs = document.querySelectorAll(FB_DIALOG_SELECTOR);
    for (let index = 0; index < dialogs.length; index += 1) {
      const dialog = dialogs[index];
      if (dialog.id === "reelless-focus-screen") continue;
      if (dialog.querySelector("#reelless-focus-screen")) continue;
      // A settings/share dialog carries no player; only a theater with a video (or its
      // language-independent seek/player chrome before the <video> boots) counts.
      if (!dialog.querySelector(FB_VIDEO_UI)) continue;
      const video = dialog.querySelector("video");
      if (video) {
        if (reelsAllowed && facebookReelPost(video)) continue;
        return { element: dialog, video };
      }
      if (reelsAllowed && facebookReelPost(dialog)) continue;
      return { element: dialog, video: null };
    }
    // Portal fallback: theater rendered outside the feed/landmarks with no dialog role at all.
    // Feed videos are always inside the feed; anything else playing while Watch is blocked is
    // the theater, whatever wrapper Facebook renamed it to.
    const videos = document.querySelectorAll("video");
    for (let index = 0; index < videos.length; index += 1) {
      const video = videos[index];
      if (video.closest && video.closest('#reelless-focus-screen, [data-reelless-hidden]')) continue;
      if (reelsAllowed && facebookReelPost(video)) continue;
      if (!facebookTheaterOverlay(video)) continue;
      return { element: video, video };
    }
    return null;
  }

  // A video opened from the feed plays in a theater dialog without changing the address, so there
  // is no navigation to refuse. When Watch is blocked, stop it in place like a Reel: pause what is
  // playing and raise the focus screen with video copy. Returns true when it handled a dialog.
  function blockFacebookVideoDialog() {
    const theater = findFacebookTheater();
    if (!theater) return false;
    if (theater.video) pauseVideo(theater.video);
    facebookShowVideoScreen();
    return true;
  }

  // A click inside a blocked video post that is not on a link (thumbnail, play button, inline
  // player). The anchor click guard never sees these, so they would otherwise open the theater
  // dialog freely.
  function facebookVideoClickTarget(event) {
    if (!facebookWatchOpenBlocked()) return null;
    const target = event.target;
    if (!target || typeof target.closest !== "function") return null;
    if (target.closest("a[href], #reelless-focus-screen")) return null;
    // Clicks inside an already-hidden post are still blocked: feed placeholders ("Video blocked"
    // / "Reel blocked") stay visible and clickable, so ignoring them would let the theater open
    // freely. Truly display:none containers receive no clicks anyway.
    // A click straight onto the player (thumbnail control, seek bar, inline <video>) is a video
    // open even when no post wrapper can be recognised around it (renamed markup). Catch it
    // before the post lookup so a missed container cannot let the theater through.
    if (target.matches && target.matches("video")) return target;
    if (target.matches && target.matches(FB_VIDEO_UI)) {
      const strict = target.closest("div[aria-posinset], article, section, [role='article'], div[data-pagelet]");
      const post = strict || facebookFallbackPost(target);
      if (post) {
        if (facebookReelsAllowed() && facebookReelPost(post)) return null;
        return post;
      }
      return target;
    }
    const uiAncestor = target.closest ? target.closest(FB_VIDEO_UI) : null;
    if (uiAncestor && !(uiAncestor.closest && uiAncestor.closest("a[href]"))) {
      const strict = target.closest("div[aria-posinset], article, section, [role='article'], div[data-pagelet]");
      const post = strict || facebookFallbackPost(target);
      if (post) {
        if (facebookReelsAllowed() && facebookReelPost(post)) return null;
        return post;
      }
      return uiAncestor;
    }
    const strict = target.closest("div[aria-posinset], article, section, [role='article'], div[data-pagelet]");
    // Renamed markup matches no strict post selector; fall back to the post-sized wrapper so the
    // click is still recognised as landing inside a video post.
    const post = strict || facebookFallbackPost(target);
    if (post) {
      if (facebookReelsAllowed() && facebookReelPost(post)) return null;
      if (post.querySelector(`${FB_VIDEO_UI}, a[href*="/watch"], a[href*="/video.php"], a[href*="/share/v/"], a[href*="fb.watch"], a[href*="/videos/"]`)) return post;
      // The click itself lands on a play control (thumbnail with no video rendered yet).
      if (target.matches && target.matches(FB_VIDEO_UI)) return post;
    }
    const dialog = target.closest ? target.closest(FB_DIALOG_SELECTOR) : null;
    if (dialog && dialog.querySelector(FB_VIDEO_UI)) return dialog;
    if (target.closest("video")) return target.closest("video");
    return null;
  }

  // Where the top edge of a hidden container would land if it were shown, in viewport coordinates,
  // or null when that cannot be established. A display:none element has no geometry of its own, so
  // the answer is read from what is laid out around it: the next sibling stands exactly where the
  // container would, and failing that the container would begin at the previous sibling's bottom
  // edge (or level with it in a row, which is never above it). A card alone in its own wrapper has
  // no siblings, so the wrapper's are consulted instead; a wrapper with size of its own encloses
  // the container somewhere inside it, and its top edge is the only bound that can be trusted.
  function hiddenTop(container) {
    let node = container;
    while (node && node !== document.body && node !== document.documentElement) {
      for (let probe = node.nextElementSibling; probe; probe = probe.nextElementSibling) {
        const rect = probe.getBoundingClientRect();
        if (rect.height || rect.width) return rect.top;
      }
      for (let probe = node.previousElementSibling; probe; probe = probe.previousElementSibling) {
        const rect = probe.getBoundingClientRect();
        if (rect.height || rect.width) return rect.bottom;
      }
      const parent = node.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) return null;
      const box = parent.getBoundingClientRect();
      if (box.height || box.width) return box.top;
      node = parent;
    }
    return null;
  }

  // True only with positive evidence that the container sits entirely below the viewport, where
  // giving it its height back moves nothing the reader can see. Unknown is false.
  function isBelowViewport(container) {
    const top = hiddenTop(container);
    const viewportBottom = globalThis.innerHeight;
    return top !== null && Number.isFinite(viewportBottom) && viewportBottom > 0 && top >= viewportBottom;
  }

  // A hidden container whose contents changed stays hidden while it still holds a blocked link
  // (or, for Facebook Watch, a non-Reel video element or play control).
  function reevaluateHidden(container, platform, now) {
    const anchors = Array.from(container.querySelectorAll('a[href], a[title="Shorts"]'));
    if (container.matches('a[href], a[title="Shorts"]')) anchors.unshift(container);
    const hasFacebookVideo = () => {
      if (!platform || platform.id !== "facebook" || !facebookWatchBlocked(now)) return false;
      if (facebookReelsAllowed() && facebookReelPost(container)) return false;
      return Boolean(container.querySelector(FB_VIDEO_UI)
        || (container.matches && container.matches(FB_VIDEO_UI)));
    };
    // An empty card is not evidence that it became ordinary. A feed that recycles its cards tears
    // the contents out before re-rendering them, and revealing one in that instant restores its
    // full height above the reader, carrying them backward up the feed. Require positive evidence.
    if (!anchors.length) {
      if (hasFacebookVideo()) return;
      if (!platform || platform.id !== "facebook" || !facebookWatchBlocked(now)) return;
    }
    for (const anchor of anchors) {
      checked.add(anchor);
      if (blockedEntry(anchor, platform, now)) return;
    }
    if (hasFacebookVideo()) return;
    // A compact Home placeholder does not alter nearby post positions, so its replacement by a
    // photo can be shown immediately.
    if (document.documentElement.hasAttribute("data-reelless-instagram-feed")
      && container.closest("article, [role='article'], [role='listitem'], li")) {
      container.removeAttribute(HIDDEN_ATTR);
      return;
    }
    // Never give height back above the reader; that pushes everything below it down and carries
    // them backwards up the feed. That includes a card whose position cannot be established and
    // one whose neighbour merely straddles the top of the viewport, which is where a reveal is most
    // visible. The card stays hidden and is looked at again on the next pass, so it reappears once
    // it provably sits below the reader. On browsers with :has() this path never runs for a Reel:
    // a live stylesheet rule has no marker to take back.
    if (!isBelowViewport(container)) {
      if (container.isConnected) pendingParents.add(container);
      return;
    }
    container.removeAttribute(HIDDEN_ATTR);
  }

  function hideBlockedEntryPoints(full) {
    const now = new Date();
    const platform = R.platformForUrl(location.href);
    // Nothing to do on a conversation, or when the style engine has already hidden these before
    // they were painted.
    if (!scriptHidesHere()) {
      pendingRoots.clear();
      pendingParents.clear();
      return;
    }
    // Custom boundaries hide their links on every guarded page, platform or not.
    const customHiding = settings.customEntries.length > 0 && R.isScheduleActive(settings, now);
    if (!customHiding && (!platform || !R.hidesEntryPoints(settings, platform) || !R.isScheduleActive(settings, now))) {
      pendingRoots.clear();
      pendingParents.clear();
      return;
    }
    if (pendingParents.size) {
      const dirty = new Set();
      pendingParents.forEach((node) => {
        const hidden = node.closest ? node.closest(HIDDEN_SELECTOR) : null;
        if (hidden) dirty.add(hidden);
      });
      pendingParents.clear();
      dirty.forEach((container) => reevaluateHidden(container, platform, now));
    }
    // Newly inserted content is evaluated on every pass, including a full one. The document sweep
    // below stops at FULL_SCAN_LIMIT anchors in document order, so on a long feed the newest cards
    // sit beyond the cap; discarding them here would leave them permanently unexamined.
    const fbVideoHiding = Boolean(platform) && platform.id === "facebook" && facebookWatchBlocked(now);
    pendingRoots.forEach((root) => {
      if (root.isConnected) evaluateWithin(root, platform, now, fbVideoHiding);
    });
    pendingRoots.clear();
    if (full) {
      const anchors = document.querySelectorAll('a[href], a[title="Shorts"]');
      const limit = Math.min(anchors.length, FULL_SCAN_LIMIT);
      for (let index = 0; index < limit; index += 1) {
        if (!checked.has(anchors[index])) evaluateAnchor(anchors[index], platform, now);
      }
    }
    if (platform && platform.id === "facebook") hideFacebookVideoPosts(full);
  }

  function handleMutations(mutations) {
    // Looked up once per batch: feeds can deliver hundreds of mutations per scroll tick.
    const mutationPlatform = R.platformForUrl(pageLocation.href);
    const watchesLabels = Boolean(mutationPlatform) && mutationPlatform.id === "youtube";
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        const target = mutation.target;
        const name = mutation.attributeName;
        // Frameworks often re-set an attribute to the value it already had; that changes nothing.
        if (name && mutation.oldValue === target.getAttribute(name)) continue;
        // Like counts, timestamps and play-state flips rewrite title/aria-label constantly while
        // scrolling. Only YouTube's Shorts nav rows are identified by those labels; everywhere
        // else blocking keys off hrefs and <video> nodes, which the stylesheet re-evaluates on its
        // own, so scheduling a scan for them only burns scroll budget.
        if ((name === "title" || name === "aria-label") && !watchesLabels) continue;
        checked.delete(target);
        pendingRoots.add(target);
        pendingParents.add(target);
      } else {
        pendingParents.add(mutation.target);
        const added = mutation.addedNodes;
        for (let index = 0; index < added.length; index += 1) {
          if (added[index].nodeType === 1) pendingRoots.add(added[index]);
        }
      }
    }
    if (pendingRoots.size || pendingParents.size) scheduleScan();
  }

  function scan() {
    scanScheduled = false;
    if (scanFrame) { cancelAnimationFrame(scanFrame); scanFrame = 0; }
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    if (location.href !== lastHref) {
      lastHref = location.href;
      lastHandled = "";
      pendingRedirectUrl = null;
      pendingRedirectTries = 0;
      theaterScreen = false;
      unpinFocusScreen();
    }
    applyModeAttribute();
    syncObserver();
    syncXSurfaces();
    // Schedule windows and pause expiries change what counts as blocked without a settings write.
    const active = R.isScheduleActive(settings, new Date());
    if (active !== lastActive) {
      lastActive = active;
      clearMarkers();
      theaterScreen = false;
      unpinFocusScreen();
      fullScanDue = true;
    }
    handleCurrentNavigation();
    if (document.getElementById("reelless-focus-screen")) {
      pendingRoots.clear();
      pendingParents.clear();
      fullScanDue = true;
      return;
    }
    // A theater dialog plays without changing the address, so the navigation guard above never
    // sees it. Block it here, like a Reel, with video copy.
    if (blockFacebookVideoDialog()) {
      pendingRoots.clear();
      pendingParents.clear();
      fullScanDue = true;
      return;
    }
    const full = fullScanDue;
    fullScanDue = false;
    hideBlockedEntryPoints(full);
    // A dialog inserted during this same pass is caught on the next one: opening it fires
    // mutations, which schedule a scan within ~150ms, and the click that opened it already
    // raised the screen. A second document-wide dialog sweep here doubled that cost on every
    // scroll tick for no visible gain.
  }

  // Work is coalesced into one pass per animation frame so new cards are hidden before they are ever
  // painted. The timer covers hidden tabs, where frames do not run, and is cancelled when a frame does.
  function scheduleScan() {
    if (scanScheduled || !globalThis.document) return;
    scanScheduled = true;
    if (!document.hidden && typeof requestAnimationFrame === "function") scanFrame = requestAnimationFrame(scan);
    scanTimer = setTimeout(scan, document.hidden ? 40 : 150);
  }

  function requestFullScan() {
    fullScanDue = true;
    scheduleScan();
  }

  document.addEventListener("click", (event) => {
    const anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (anchor) {
      const url = anchorUrl(anchor);
      if (url) {
        const decision = R.shouldBlockUrl(settings, url, new Date());
        if (decision.blocked) {
          event.preventDefault();
          event.stopImmediatePropagation();
          record("click");
          const plan = redirectPlan(decision, url);
          // The link has already been cancelled. A fallback to Home is only useful on
          // a direct blocked-page load; here it reloads the feed and loses scroll position.
          // (YouTube has no fallback, so a blocked Short click always raises the focus screen.)
          if (plan) return;
          screenPinned = true;
          showFocusScreen(decision.platform, true, decision.section);
          return;
        }
        // Personal custom boundaries refuse their links the same way: cancel the click and
        // stop in place with the custom screen.
        const custom = R.shouldBlockCustomUrl(settings, url, new Date());
        if (custom.blocked) {
          event.preventDefault();
          event.stopImmediatePropagation();
          record("click");
          screenPinned = true;
          showFocusScreen(CUSTOM_PLATFORM, true, { id: custom.entry });
          return;
        }
      }
    }
    // Facebook video thumbnails, play buttons and inline players are not links, so the guard
    // above never sees them. Opening one plays in place or in a dialog without changing the
    // address. Stop it like a Reel: cancel the click, pause the video, and show video copy.
    const videoTarget = facebookVideoClickTarget(event);
    if (videoTarget) {
      event.preventDefault();
      event.stopImmediatePropagation();
      record("click");
      const postVideo = videoTarget.matches && videoTarget.matches("video")
        ? videoTarget
        : videoTarget.querySelector ? videoTarget.querySelector("video") : null;
      if (postVideo) pauseVideo(postVideo);
      else {
        const playing = document.querySelectorAll("video");
        for (let index = 0; index < playing.length; index += 1) pauseVideo(playing[index]);
      }
      if (!videoTarget.hasAttribute(HIDDEN_ATTR)) {
        const container = videoTarget.matches && videoTarget.matches("video")
          ? facebookVideoContainer(videoTarget)
          : videoTarget;
        if (container && !container.hasAttribute(HIDDEN_ATTR)) container.setAttribute(HIDDEN_ATTR, "true");
      }
      const platform = R.platformForUrl(location.href);
      screenPinned = true;
      showFocusScreen(platform, true, facebookWatchSection());
    }
  }, true);

  // A blocked Facebook video that still starts playing (autoplay, dialog theater) is paused in
  // place. Conversations are never touched, and Reels stay playable while only Watch is blocked.
  document.addEventListener("play", (event) => {
    if (!facebookWatchOpenBlocked()) return;
    const video = event.target;
    if (!video || video.closest?.("#reelless-focus-screen")) return;
    if (facebookReelsAllowed() && facebookReelPost(video)) return;
    pauseVideo(video);
    const container = facebookVideoContainer(video);
    if (container && !container.hasAttribute(HIDDEN_ATTR)) container.setAttribute(HIDDEN_ATTR, "true");
    else if (!container && !video.hasAttribute(HIDDEN_ATTR)) video.setAttribute(HIDDEN_ATTR, "true");
    if (facebookTheaterOverlay(video) && !document.getElementById("reelless-focus-screen")) {
      facebookShowVideoScreen();
    }
  }, true);

  // Enter activates whatever has focus. Space, the arrows and the Page keys scroll, so they are
  // reading rather than opening and must never arm this.
  document.addEventListener("pointerdown", () => { lastGestureAt = Date.now(); }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter") lastGestureAt = Date.now();
  }, true);
  globalThis.addEventListener("scroll", () => { lastScrollAt = Date.now(); }, true);

  // Same-document navigations can be refused outright where the Navigation API exists. This is what
  // stops a Reel shared in a conversation from opening: the card is not a link, so the click guard
  // never sees it, but opening it still moves the address, and that can be declined.
  function installNavigationGuard() {
    const nav = globalThis.navigation;
    if (!nav || typeof nav.addEventListener !== "function") return;
    nav.addEventListener("navigate", (event) => {
      // Only in-page transitions. A real page load is left to handleCurrentNavigation, which can
      // offer somewhere to go instead of stranding the reader on a dead page.
      if (!event.cancelable || !event.destination || !event.destination.sameDocument) return;
      let destination;
      try { destination = new URL(event.destination.url); } catch (_error) { return; }
      if (destination.origin !== location.origin) return;
      const decision = R.shouldBlockUrl(settings, destination, new Date());
      if (!decision.blocked) return;
      // A deliberate open is deliberately NOT refused. Some viewers are opened by the page directly
      // rather than by its router, and those only close when the address moves back, which cannot
      // happen if the move never occurred. handleCurrentNavigation steps it back a moment later,
      // which closes both kinds. Refusing here would leave the second kind playing.
      if (userDriven()) return;
      // Nobody asked for this. The site rewrote its own address while the feed scrolled, so decline
      // it outright: the address never moves, and the feed never churns.
      event.preventDefault();
    });
  }

  ["popstate", "hashchange", "yt-navigate-finish", "yt-page-data-updated"].forEach((name) => {
    globalThis.addEventListener(name, requestFullScan, true);
  });

  // A single-page app that rewrites its address with pushState fires none of the events above, and
  // if the DOM did not change there is no mutation to notice either. The Navigation API reports
  // those same-document changes directly. Absent in Firefox today, where the periodic sweep and
  // the mutation observer still catch it, just a little later.
  if (globalThis.navigation && typeof globalThis.navigation.addEventListener === "function") {
    globalThis.navigation.addEventListener("navigatesuccess", requestFullScan);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[R.SETTINGS_KEY]) return;
    settings = R.normalizeSettings(changes[R.SETTINGS_KEY].newValue);
    lastMode = null;
    lastSurfaces = null;
    applyModeAttribute();
    syncObserver();
    clearMarkers();
    lastHandled = "";
    pendingRedirectUrl = null;
    pendingRedirectTries = 0;
    lastActive = null;
    theaterScreen = false;
    const hadNavigationScreen = !screenPinned && Boolean(document.getElementById("reelless-focus-screen"));
    unpinFocusScreen();
    removeFocusScreen();
    // Refresh copy and shortcuts without treating a settings update as a new blocked visit.
    if (hadNavigationScreen) {
      const decision = R.shouldBlockUrl(settings, location.href, new Date());
      if (decision.blocked) showFocusScreen(decision.platform, false, decision.section);
      else {
        const custom = R.shouldBlockCustomUrl(settings, location.href, new Date());
        if (custom.blocked) showFocusScreen(CUSTOM_PLATFORM, false, { id: custom.entry });
      }
    }
    requestFullScan();
  });

  // Stamp secure defaults before the settings are even read, while the document is still
  // empty. With no attributes the stylesheet defaults to hiding Reels/Shorts, but Facebook
  // Watch videos need the videoPosts token and feed markers to be hidden at all — without an
  // early stamp they flash visible and playable on every load. The defaults block short-form
  // (including Watch), so arming them now closes that window; if the person opted out, the
  // settings load a moment later removes the tokens and shows the videos again, which is the
  // harmless direction. Conversations are excused here too, so nothing in a thread is ever
  // hidden even for the moment settings take to arrive.
  try {
    if (document.documentElement) applyModeAttribute();
  } catch (_error) {
    // Early stamping is best-effort only; the post-load pass corrects it.
  }

  chrome.storage.local.get([R.SETTINGS_KEY, R.LEGACY_SETTINGS_KEY]).then((stored) => {
    settings = R.normalizeSettings(stored[R.SETTINGS_KEY] || stored[R.LEGACY_SETTINGS_KEY]);
    applyModeAttribute();
    installNavigationGuard();
    syncObserver();
    // A day on which a guarded page loaded under active protection counts as a day of use, whether
    // or not anything had to be blocked. The worker ignores repeats within the same local day.
    const guarded = R.platformForUrl(location.href);
    if (guarded && R.isScheduleActive(settings, new Date())
      && settings.platforms[guarded.id] && settings.platforms[guarded.id].mode !== "off") {
      chrome.runtime.sendMessage({ type: "markActiveDay" }).catch(() => {});
    }
    // The periodic sweep is incremental: mutations already queue new content, so re-sweeping
    // thousands of anchors every second is what stalled scrolling feeds. A slower full sweep
    // remains as a safety net for anything inserted without a mutation record.
    setInterval(scheduleScan, FULL_SCAN_INTERVAL);
    setInterval(requestFullScan, FULL_SCAN_INTERVAL * 10);
    // A cheap address watch. Some apps move the address with no event of any kind, and the
    // Navigation API is not available in every browser. Comparing one string a few times a second
    // costs nothing and keeps detection prompt enough to tell an open from a scroll. It also
    // re-checks a blocked page whose focus overlay went missing: where the stylesheet hides
    // (YouTube with :has()) the DOM observer stands down, so nothing else would notice a late
    // render dropping the overlay until the next sweep.
    setInterval(() => {
      if (location.href !== lastHref) { scheduleScan(); return; }
      if (lastHandled && !document.getElementById("reelless-focus-screen")) scheduleScan();
    }, 150);
    document.addEventListener("visibilitychange", scheduleScan);
    requestFullScan();
  }).catch(() => {});
})();
