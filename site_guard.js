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
  const YOUTUBE_ITEMS = "ytd-reel-item-renderer, ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model, ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer, tp-yt-paper-tab, yt-tab-shape";

  // Platforms whose entry points are fully covered by the rules in site_guard.css. On these the
  // script does no hiding at all, which is what removes the scanning cost while scrolling.
  const CSS_COVERED = new Set(["youtube"]);
  const CSS_HAS_SUPPORT = typeof CSS !== "undefined" && typeof CSS.supports === "function"
    && CSS.supports("selector(:has(a))");

  let settings = R.getDefaultSettings();
  let lastHandled = "";
  let lastHref = location.href;
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
  let observer = null;

  // Links already evaluated against the current settings. Keeping this off the DOM means busy feeds
  // never pay for attribute writes on thousands of links, and nothing needs to be cleared per mutation.
  let checked = new WeakSet();
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
    return R.hidesEntryPoints(settings, platform) ? "hide" : "keep";
  }

  function applyModeAttribute() {
    const element = document.documentElement;
    if (!element) return;
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
    const next = platform ? R.activeSurfaces(settings, platform).join(" ") : "";
    if (lastSurfaces === next) return;
    lastSurfaces = next;
    if (next) element.dataset.reellessSurfaces = next;
    else element.removeAttribute("data-reelless-surfaces");
  }

  // True when the stylesheet is already hiding everything this platform needs hidden.
  function cssIsHandlingHiding() {
    if (!CSS_HAS_SUPPORT) return false;
    const platform = R.platformForUrl(location.href);
    return Boolean(platform) && CSS_COVERED.has(platform.id);
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(handleMutations);
    observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["href"], attributeOldValue: true
    });
  }

  function stopObserver() {
    if (!observer) return;
    observer.disconnect();
    observer = null;
    pendingRoots.clear();
    pendingParents.clear();
  }

  // Watching the DOM is only worth its cost on platforms the stylesheet does not cover.
  function syncObserver() {
    if (cssIsHandlingHiding()) {
      if (observer) {
        stopObserver();
        // Drop anything the script hid before the stylesheet took over.
        document.querySelectorAll(HIDDEN_SELECTOR).forEach((node) => node.removeAttribute(HIDDEN_ATTR));
      }
      return;
    }
    startObserver();
  }

  function clearMarkers() {
    checked = new WeakSet();
    pendingRoots.clear();
    pendingParents.clear();
    document.querySelectorAll(HIDDEN_SELECTOR).forEach((node) => node.removeAttribute(HIDDEN_ATTR));
  }

  function focusCopy(platform) {
    if (platform.id === "tiktok") {
      return {
        title: "TikTok is outside your focus plan",
        body: "ReelLess is keeping TikTok feed and video pages out of this session. You can change your boundary when you mean to."
      };
    }
    return {
      title: "This section is outside your focus plan",
      body: `${platform.label} matches a boundary you chose in ReelLess.`
    };
  }

  function showFocusScreen(platform, pinned) {
    if (document.getElementById("reelless-focus-screen")) return;
    const mount = () => {
      if (!document.documentElement || document.getElementById("reelless-focus-screen")) return;
      const copy = focusCopy(platform);
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
          <div class="reelless-actions">
            <button type="button" data-action="pause">Pause for 15 minutes</button>
            <button type="button" data-action="settings">Open settings</button>
            <button type="button" data-action="dismiss">Stay here</button>
          </div>
        </div>`;
      screen.querySelector("h1").textContent = copy.title;
      screen.querySelector("p").textContent = settings.ultimate.enabled ? `${copy.body} Ultimate Lock is active, so pausing is unavailable.` : copy.body;
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

  // "conversion" means the same content in an acceptable form, which is worth navigating to.
  // "fallback" means we are simply sending the visitor elsewhere, which is not.
  function redirectPlan(decision, url) {
    if (decision.reason === "all") return null;
    const section = decision.section;
    if (decision.platform.id === "youtube" && section && section.id === "shorts") {
      const watch = R.youtubeWatchUrl(url);
      return watch ? { url: watch, kind: "conversion" } : null;
    }
    if (decision.platform.id === "instagram" && section && section.id === "reels") {
      // Coming from a profile's Reels tab, the profile itself is a less disorienting landing than the feed.
      const profile = url.pathname.match(/^\/([^/]+)\/reels?(?:\/|$)/i);
      return { url: profile ? `${url.origin}/${profile[1]}/` : decision.platform.homeUrl, kind: "fallback" };
    }
    if (decision.platform.id === "facebook" && section && section.id === "reels") {
      return { url: decision.platform.homeUrl, kind: "fallback" };
    }
    return null;
  }

  function redirectTarget(decision, url) {
    const plan = redirectPlan(decision, url);
    return plan ? plan.url : null;
  }

  function handleCurrentNavigation() {
    const decision = R.shouldBlockUrl(settings, location.href, new Date());
    const wasInitialCheck = !initialNavigationDone;
    initialNavigationDone = true;
    if (!decision.blocked) {
      lastAllowedHref = location.href;
      lastHandled = "";
      if (!screenPinned) removeFocusScreen();
      return;
    }
    const key = `${location.href}|${decision.platform.id}|${decision.reason}`;
    if (key === lastHandled) return;
    lastHandled = key;
    const plan = redirectPlan(decision, new URL(location.href));

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
      record("navigation");
      location.replace(plan.url);
      return;
    }
    // Re-checks after a settings change must not count the same visit twice.
    if (!document.getElementById("reelless-focus-screen")) record("navigation");
    screenPinned = false;
    showFocusScreen(decision.platform, false);
  }

  function safeContainer(anchor, platform) {
    let candidate = anchor;
    if (platform.id === "youtube") {
      const shelf = anchor.closest(YOUTUBE_SHORTS_SHELVES);
      // Only take the whole shelf when nothing ordinary is inside it, so a mixed grid loses its
      // Shorts cards rather than the videos next to them.
      const shelfIsAllShorts = shelf && !shelf.querySelector('a[href*="/watch"]');
      candidate = shelfIsAllShorts ? (shelf.closest("ytd-rich-section-renderer") || shelf) : (anchor.closest(YOUTUBE_ITEMS) || anchor);
    } else if (platform.id === "instagram" || platform.id === "facebook") {
      const card = anchor.closest("article, [role='article'], li, [role='listitem']");
      if (card && card.querySelectorAll("a[href]").length <= 8) candidate = card;
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

  function blockedEntry(anchor, platform, now) {
    const url = anchorUrl(anchor);
    if (!url) return false;
    const decision = R.shouldBlockUrl(settings, url, now);
    return Boolean(decision.blocked && decision.platform && decision.platform.id === platform.id && decision.section);
  }

  function evaluateAnchor(anchor, platform, now) {
    checked.add(anchor);
    if (!blockedEntry(anchor, platform, now)) return;
    const container = safeContainer(anchor, platform);
    if (!container.hasAttribute(HIDDEN_ATTR)) container.setAttribute(HIDDEN_ATTR, "true");
  }

  function evaluateWithin(root, platform, now) {
    if (root.matches("a[href]") && !checked.has(root)) evaluateAnchor(root, platform, now);
    const anchors = root.querySelectorAll("a[href]");
    for (let index = 0; index < anchors.length; index += 1) {
      if (!checked.has(anchors[index])) evaluateAnchor(anchors[index], platform, now);
    }
  }

  // A hidden container whose contents changed stays hidden only while it still holds a blocked link.
  // A display:none element reports a zero rect, so it cannot report its own position. Ask the
  // nearest sibling that is laid out. Returns false whenever the answer is genuinely unknown.
  function isAboveViewport(container) {
    for (let probe = container.previousElementSibling; probe; probe = probe.previousElementSibling) {
      const rect = probe.getBoundingClientRect();
      if (rect.height || rect.width) return rect.bottom <= 0;
    }
    for (let probe = container.nextElementSibling; probe; probe = probe.nextElementSibling) {
      const rect = probe.getBoundingClientRect();
      if (rect.height || rect.width) return rect.top < 0;
    }
    return false;
  }

  function reevaluateHidden(container, platform, now) {
    const anchors = Array.from(container.querySelectorAll("a[href]"));
    if (container.matches("a[href]")) anchors.unshift(container);
    // An empty card is not evidence that it became ordinary. A feed that recycles its cards tears
    // the contents out before re-rendering them, and revealing one in that instant restores its
    // full height above the reader, carrying them backward up the feed. Require positive evidence.
    if (!anchors.length) return;
    for (const anchor of anchors) {
      checked.add(anchor);
      if (blockedEntry(anchor, platform, now)) return;
    }
    // Never give height back above the reader; that pushes everything below it down and carries
    // them backwards up the feed. A hidden element has no geometry of its own, so its position is
    // read from the nearest sibling that is actually laid out. If that cannot be established, the
    // reveal is allowed: a card that should reappear matters more than a hypothetical shift.
    if (isAboveViewport(container)) return;
    container.removeAttribute(HIDDEN_ATTR);
  }

  function hideBlockedEntryPoints(full) {
    const now = new Date();
    const platform = R.platformForUrl(location.href);
    // Nothing to do when the style engine has already hidden these before they were painted.
    if (cssIsHandlingHiding()) {
      pendingRoots.clear();
      pendingParents.clear();
      return;
    }
    if (!platform || !R.hidesEntryPoints(settings, platform) || !R.isScheduleActive(settings, now)) {
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
    pendingRoots.forEach((root) => {
      if (root.isConnected) evaluateWithin(root, platform, now);
    });
    pendingRoots.clear();
    if (full) {
      const anchors = document.querySelectorAll("a[href]");
      const limit = Math.min(anchors.length, FULL_SCAN_LIMIT);
      for (let index = 0; index < limit; index += 1) {
        if (!checked.has(anchors[index])) evaluateAnchor(anchors[index], platform, now);
      }
    }
  }

  function handleMutations(mutations) {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        const target = mutation.target;
        // Frameworks often re-set an href to the value it already had; that changes nothing.
        if (mutation.oldValue === target.getAttribute("href")) continue;
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
      unpinFocusScreen();
    }
    applyModeAttribute();
    syncObserver();
    // Schedule windows and pause expiries change what counts as blocked without a settings write.
    const active = R.isScheduleActive(settings, new Date());
    if (active !== lastActive) {
      lastActive = active;
      clearMarkers();
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
    const full = fullScanDue;
    fullScanDue = false;
    hideBlockedEntryPoints(full);
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
    if (!anchor) return;
    const url = anchorUrl(anchor);
    if (!url) return;
    const decision = R.shouldBlockUrl(settings, url, new Date());
    if (!decision.blocked) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    record("click");
    const target = redirectTarget(decision, url);
    if (target) {
      location.assign(target);
      return;
    }
    screenPinned = true;
    showFocusScreen(decision.platform, true);
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
      const plan = redirectPlan(decision, destination);
      // A conversion has a real destination worth reaching, so let it run and be handled normally.
      if (plan && plan.kind === "conversion") return;
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
    lastActive = null;
    unpinFocusScreen();
    requestFullScan();
  });

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
    setInterval(requestFullScan, FULL_SCAN_INTERVAL);
    // A cheap address watch. Some apps move the address with no event of any kind, and the
    // Navigation API is not available in every browser. Comparing one string a few times a second
    // costs nothing and keeps detection prompt enough to tell an open from a scroll.
    setInterval(() => { if (location.href !== lastHref) scheduleScan(); }, 150);
    document.addEventListener("visibilitychange", scheduleScan);
    requestFullScan();
  }).catch(() => {});
})();
