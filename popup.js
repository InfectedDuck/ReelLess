(async function () {
  "use strict";

  const R = ReelLess;
  const platformList = document.getElementById("platformList");
  const core = R.PLATFORMS.filter((platform) => R.CORE_PLATFORM_IDS.includes(platform.id));
  const glyphs = { youtube: "YT", instagram: "IG", facebook: "FB", tiktok: "TT" };
  let state = await chrome.runtime.sendMessage({ type: "getState" });
  let settings = R.normalizeSettings(state && state.settings);
  let stats = R.normalizeStats(state && state.stats);
  let meta = R.normalizeMeta(state && state.meta);
  let saveError = null;

  function applyAppearance() {
    const theme = settings.appearance === "system"
      ? (globalThis.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : settings.appearance;
    document.documentElement.dataset.theme = theme;
  }

  function formatTime(value) {
    try {
      return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (_error) {
      return String(value);
    }
  }

  function renderStatus() {
    const status = R.getEffectiveStatus(settings, new Date());
    const locked = Boolean(settings.ultimate && settings.ultimate.enabled);
    document.getElementById("statusDot").classList.toggle("active", status.active);
    // Ultimate Lock is a separate indicator, not proof any site is protected.
    let text = R.statusText(status, formatTime);
    if (saveError) text = `Couldn't save changes (${saveError}). Protection may not be applied.`;
    else if (locked && status.key !== "locked-active" && status.key !== "locked-paused") text = `Ultimate Lock is active — ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
    document.getElementById("statusText").textContent = saveError ? text : (locked && (status.key === "locked-active" || status.key === "locked-paused") ? "Ultimate Lock is active" : text);
    const paused = status.key === "paused";
    document.getElementById("resumeButton").hidden = !paused || locked;
    document.getElementById("pauseDuration").disabled = locked;
    document.getElementById("pauseButton").disabled = locked;
    document.getElementById("ultimateNotice").hidden = !locked;
  }

  function renderPlatforms() {
    platformList.textContent = "";
    core.forEach((platform) => {
      const row = document.createElement("div");
      row.className = "platform-row";
      const checked = settings.platforms[platform.id].mode !== "off";
      row.innerHTML = `<span class="platform-label"><span class="platform-glyph">${glyphs[platform.id]}</span>${platform.label}</span><label class="switch"><input type="checkbox" data-platform="${platform.id}" ${checked ? "checked" : ""} ${settings.ultimate && settings.ultimate.enabled ? "disabled" : ""} aria-label="Protect ${platform.label}"><span></span></label>`;
      platformList.appendChild(row);
    });
  }

  function renderCounts() {
    document.getElementById("todayCount").textContent = stats.todayCount.toLocaleString();
    document.getElementById("totalCount").textContent = stats.totalCount.toLocaleString();
  }

  function renderReview() {
    // Never construct a review URL from the runtime id. Until a real listing URL
    // is known the review action stays hidden and only support is offered.
    const reviewUrl = R.getReviewUrl("chrome");
    const link = document.getElementById("reviewLink");
    if (reviewUrl) {
      link.href = reviewUrl;
      link.hidden = false;
    } else {
      link.hidden = true;
    }
    document.getElementById("reviewPrompt").hidden = !(meta.reviewShown && !meta.reviewDismissed);
  }

  async function refreshFromBackground() {
    try {
      const fresh = await chrome.runtime.sendMessage({ type: "getState" });
      if (fresh && fresh.settings) settings = R.normalizeSettings(fresh.settings);
      if (fresh && fresh.stats) stats = R.normalizeStats(fresh.stats);
      if (fresh && fresh.meta) meta = R.normalizeMeta(fresh.meta);
      saveError = null;
    } catch (error) {
      saveError = error && error.message ? error.message : "storage unavailable";
    }
    applyAppearance();
    renderPlatforms();
    renderCounts();
    renderReview();
    renderStatus();
  }

  platformList.addEventListener("change", async (event) => {
    const id = event.target.dataset.platform;
    if (!id) return;
    if (settings.ultimate && settings.ultimate.enabled) return;
    event.target.disabled = true;
    try {
      // Serialized background write: reads the latest state and restores the
      // remembered mode, so a stale popup never resets or clobbers other sites.
      const result = await chrome.runtime.sendMessage({ type: "setPlatformEnabled", platform: id, enabled: event.target.checked });
      if (!result || result.ok === false || result.locked) {
        saveError = (result && result.error) || "change rejected";
      } else {
        settings = R.normalizeSettings(result.settings);
        saveError = result.applied === false ? (result.error || "not applied") : null;
        if (result.applied === false) saveError = result.error || "protection not applied";
        else saveError = null;
      }
    } catch (error) {
      saveError = error && error.message ? error.message : "could not save";
    }
    await refreshFromBackground();
  });

  document.getElementById("pauseButton").addEventListener("click", async () => {
    if (settings.ultimate && settings.ultimate.enabled) return;
    const duration = document.getElementById("pauseDuration").value;
    try {
      const result = await chrome.runtime.sendMessage({ type: "pause", duration });
      if (result && result.settings) settings = R.normalizeSettings(result.settings);
      saveError = result && result.invalid ? "invalid pause length" : null;
    } catch (error) {
      saveError = error && error.message ? error.message : "could not pause";
    }
    renderStatus();
  });

  document.getElementById("resumeButton").addEventListener("click", async () => {
    if (settings.ultimate && settings.ultimate.enabled) return;
    try {
      const result = await chrome.runtime.sendMessage({ type: "patchSettings", patch: { pausedUntil: null } });
      if (result && result.settings) settings = R.normalizeSettings(result.settings);
      saveError = result && result.applied === false ? (result.error || "not applied") : null;
    } catch (error) {
      saveError = error && error.message ? error.message : "could not resume";
    }
    renderStatus();
  });

  document.getElementById("settingsButton").addEventListener("click", async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: "openOptions" });
      if (!response || response.ok === false) saveError = (response && response.error) || "could not open settings";
      else saveError = null;
    } catch (error) {
      saveError = "could not open settings";
    }
    renderStatus();
  });
  document.getElementById("dismissReview").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "dismissReview" });
    document.getElementById("reviewPrompt").hidden = true;
  });

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[R.SETTINGS_KEY] || changes[R.STATS_KEY] || changes[R.META_KEY]) refreshFromBackground();
    });
  }

  renderCounts();
  renderReview();
  applyAppearance();
  renderPlatforms();
  renderStatus();
})();
