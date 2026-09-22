(async function () {
  "use strict";

  const R = ReelLess;
  const stored = await chrome.storage.local.get([R.SETTINGS_KEY, R.LEGACY_SETTINGS_KEY]);
  let settings = R.normalizeSettings(stored[R.SETTINGS_KEY] || stored[R.LEGACY_SETTINGS_KEY]);
  let saveTimer = null;
  let unlockInterval = null;
  let unlockActive = false;
  let unlockRemaining = 0;
  let unlockCheckpointIndex = 0;
  let unlockAwaitingCheckpoint = false;
  let unlockLastTick = 0;

  const UNLOCK_DURATION = 60000;
  const UNLOCK_CHECKPOINTS = [
    { remaining: 45000, label: "Checkpoint 1 of 3 — I am choosing this deliberately" },
    { remaining: 30000, label: "Checkpoint 2 of 3 — I still want to remove the lock" },
    { remaining: 15000, label: "Checkpoint 3 of 3 — Continue the focused release" }
  ];

  const coreContainer = document.getElementById("corePlatforms");
  const detailedCoreContainer = document.getElementById("detailedCorePlatforms");
  const advancedContainer = document.getElementById("advancedPlatforms");
  const status = document.getElementById("saveStatus");
  const ultimatePanel = document.getElementById("ultimatePanel");
  const ultimateSetup = document.getElementById("ultimateSetup");
  const ultimateRelease = document.getElementById("ultimateRelease");
  const ultimateFeedback = document.getElementById("ultimateFeedback");
  const appearanceSelect = document.getElementById("appearance");

  function resolvedAppearance() {
    if (settings.appearance === "system") return globalThis.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    return settings.appearance;
  }

  function applyAppearance() {
    document.documentElement.dataset.theme = resolvedAppearance();
  }

  function modeOptions(selected, platform) {
    return R.PLATFORM_MODES.filter((mode) => mode.value !== "shortform" || platform.sections.some((section) => section.shortform))
      .map((mode) => `<option value="${mode.value}" ${mode.value === selected ? "selected" : ""}>${mode.label}</option>`).join("");
  }

  function entryOptions(selected) {
    return R.ENTRY_POINT_MODES.map((mode) => `<option value="${mode.value}" ${mode.value === selected ? "selected" : ""}>${mode.label}</option>`).join("");
  }

  // The entry-point choice only matters while the site itself stays open. Off has nothing to show,
  // and Block all covers every page with the focus screen.
  function entryChoiceApplies(platform) {
    const mode = settings.platforms[platform.id].mode;
    return mode === "shortform" || mode === "selected";
  }

  function entryLabel(platform) {
    if (!platform.core) return "Blocked page links";
    if (platform.id === "youtube") return "Shorts in feeds";
    if (platform.id === "instagram") return "Reels in feeds";
    if (platform.id === "facebook") return "Reels and videos in feeds";
    if (platform.id === "tiktok") return "Feed links";
    return "Short-form links";
  }

  function markStatus(message, error) {
    status.textContent = message;
    status.style.color = error ? "#ff998b" : "";
  }

  function locked() {
    return Boolean(settings.ultimate && settings.ultimate.enabled);
  }

  function setUltimateFeedback(message, error) {
    ultimateFeedback.textContent = message || "";
    ultimateFeedback.style.color = error ? "#ff998b" : "";
  }

  async function save() {
    clearTimeout(saveTimer);
    settings = R.normalizeSettings(settings);
    markStatus("Saving...");
    await chrome.storage.local.set({ [R.SETTINGS_KEY]: settings });
    await chrome.runtime.sendMessage({ type: "applySettings" }).catch(() => null);
    markStatus(settings.ultimate.enabled ? "Ultimate Lock active" : "Saved locally");
  }

  function queueSave() {
    if (locked()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 180);
  }

  function platformCard(platform) {
    const card = document.createElement("article");
    card.className = "platform-card";
    const setting = settings.platforms[platform.id];
    const checked = setting.mode !== "off";
    const coverage = platform.id === "youtube" ? "Shorts links, shelves, and tabs" : platform.id === "tiktok" ? "For You and video pages" : platform.id === "facebook" ? "Reels and feed videos; allow videos via Selected sections" : "Reels links and direct Reel visits";
    card.innerHTML = `<header><span class="platform-mark">${platform.id === "youtube" ? "YT" : platform.id === "instagram" ? "IG" : platform.id === "facebook" ? "FB" : "TT"}</span><strong>${platform.label}</strong></header><p>${coverage}</p><label class="core-toggle"><input type="checkbox" data-core-toggle="${platform.id}" ${checked ? "checked" : ""}><span></span><b>${checked ? "Protected" : "Off"}</b></label><label class="entry-choice" data-entry-choice="${platform.id}" ${entryChoiceApplies(platform) ? "" : "hidden"}>${entryLabel(platform)}<select data-entry-points="${platform.id}" aria-label="${platform.label} entry points in feeds">${entryOptions(setting.entryPoints)}</select></label>`;
    return card;
  }

  function advancedRow(platform) {
    const row = document.createElement(platform.core ? "article" : "details");
    row.className = `advanced-platform ${platform.core ? "core-mode-card" : "optional-site"}`;
    const setting = settings.platforms[platform.id];
    const choices = platform.sections.map((section) => `<label><input type="checkbox" data-platform="${platform.id}" data-section="${section.id}" ${setting.sections[section.id] ? "checked" : ""}><span>${section.label}${section.description ? `<small class="focus-control-note">${section.description}</small>` : ""}</span></label>`).join("");
    const permissionState = platform.core ? "" : `<div class="permission-state" data-permission-state="${platform.id}"><span>Checking optional access...</span><button type="button" data-grant="${platform.id}" hidden>Grant access</button></div>`;
    const entryChoice = `<label class="entry-choice" data-entry-choice="${platform.id}" ${entryChoiceApplies(platform) ? "" : "hidden"}>${entryLabel(platform)}<select class="entry-select" data-entry-points="${platform.id}" aria-label="${platform.label} entry points in feeds">${entryOptions(setting.entryPoints)}</select></label>`;
    const surfaces = (platform.surfaces || []).map((surface) => `<label><input type="checkbox" data-platform="${platform.id}" data-surface="${surface.id}" ${setting.surfaces[surface.id] ? "checked" : ""}><span>${surface.label}${surface.description ? `<small class="focus-control-note">${surface.description}</small>` : ""}</span></label>`).join("");
    const surfaceBlock = surfaces
      ? `<div class="surface-choices" data-surface-choices="${platform.id}"><span class="surface-title">Also quieten these parts of the page</span><div class="surface-grid">${surfaces}</div><p class="surface-note">Off by default. These stay reachable, they are just hidden. Turn one off again if a page stops behaving.</p></div>`
      : "";
    const focusControls = `<div class="section-choices focus-choices" data-section-choices="${platform.id}" ${setting.mode === "selected" ? "" : "hidden"}>${choices}${surfaces}</div>`;
    const controls = `<div class="mode-controls"><select class="mode-select" data-platform="${platform.id}" aria-label="${platform.label} blocking mode">${modeOptions(setting.mode, platform)}</select>${entryChoice}</div>${!platform.core ? focusControls : `<div class="section-choices focus-choices core-sections" data-section-choices="${platform.id}" ${setting.mode === "selected" ? "" : "hidden"}>${choices}</div>${surfaceBlock}`}${permissionState}`;
    if (platform.core) {
      row.innerHTML = `<div><strong>${platform.label}</strong><p>Choose a narrower or wider protection mode.</p></div>${controls}`;
    } else {
      const mode = settings.platforms[platform.id].mode;
      row.innerHTML = `<summary><span><strong>${platform.label}</strong><small>${mode === "off" ? "Off — optional access" : R.PLATFORM_MODES.find((item) => item.value === mode).label}</small></span><span class="row-chevron" aria-hidden="true"></span></summary><div class="advanced-platform-body">${controls}</div>`;
    }
    return row;
  }

  // One platform can be controlled from its core card and its detailed row; keep every copy in step.
  function syncPlatformControls(platform) {
    const setting = settings.platforms[platform.id];
    const enabled = setting.mode !== "off";
    const coreToggle = document.querySelector(`input[data-core-toggle="${platform.id}"]`);
    if (coreToggle) {
      coreToggle.checked = enabled;
      coreToggle.closest(".core-toggle").querySelector("b").textContent = enabled ? "Protected" : "Off";
    }
    document.querySelectorAll(`select.mode-select[data-platform="${platform.id}"]`).forEach((select) => { select.value = setting.mode; });
    document.querySelectorAll(`[data-section-choices="${platform.id}"]`).forEach((node) => { node.hidden = setting.mode !== "selected"; });
    document.querySelectorAll(`[data-surface-choices="${platform.id}"]`).forEach((node) => { node.hidden = setting.mode === "off"; });
    document.querySelectorAll(`[data-entry-choice="${platform.id}"]`).forEach((node) => { node.hidden = !entryChoiceApplies(platform); });
    document.querySelectorAll(`select[data-entry-points="${platform.id}"]`).forEach((select) => { select.value = setting.entryPoints; });
    const summary = document.querySelector(`.optional-site select.mode-select[data-platform="${platform.id}"]`)?.closest(".optional-site")?.querySelector("summary small");
    if (summary) summary.textContent = setting.mode === "off" ? "Off — optional access" : R.PLATFORM_MODES.find((item) => item.value === setting.mode).label;
  }

  function renderPlatforms() {
    coreContainer.textContent = "";
    detailedCoreContainer.textContent = "";
    advancedContainer.textContent = "";
    R.PLATFORMS.forEach((platform) => {
      if (platform.core) {
        coreContainer.appendChild(platformCard(platform));
        detailedCoreContainer.appendChild(advancedRow(platform));
      } else {
        advancedContainer.appendChild(advancedRow(platform));
      }
    });
    refreshPermissionStates();
  }

  function renderCustom() {
    const list = document.getElementById("customList");
    list.textContent = "";
    settings.customEntries.forEach((entry) => {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = entry;
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.dataset.remove = entry;
      removeButton.textContent = "Remove";
      item.append(label, removeButton);
      list.appendChild(item);
    });
  }

  function renderUltimate() {
    const isLocked = locked();
    document.body.classList.toggle("ultimate-active", isLocked);
    ultimateSetup.hidden = isLocked;
    ultimateRelease.hidden = !isLocked;
    document.getElementById("ultimateDescription").textContent = isLocked
      ? `Ultimate Lock is enforcing: ${settings.ultimate.profile === "block_shortform" ? "all core short-form content" : "your platform choices"}.`
      : "Lock protection to remove in-extension pausing and setting changes. Choose what stays blocked before you turn it on.";

    document.querySelectorAll("main input, main select, main button").forEach((control) => {
      if (ultimatePanel.contains(control)) return;
      control.disabled = isLocked;
    });
    document.querySelector("details.advanced").setAttribute("aria-disabled", String(isLocked));
    if (isLocked) markStatus("Ultimate Lock active");
  }

  function renderAll() {
    const preset = document.getElementById("schedulePreset");
    preset.innerHTML = R.SCHEDULE_PRESETS.map((item) => `<option value="${item.value}">${item.label}</option>`).join("");
    preset.value = settings.schedulePreset;
    document.getElementById("customStart").value = settings.customStart;
    document.getElementById("customEnd").value = settings.customEnd;
    document.getElementById("protectionEnabled").checked = settings.protectionEnabled;
    appearanceSelect.value = settings.appearance;
    applyAppearance();
    document.querySelectorAll(".custom-time").forEach((node) => { node.hidden = settings.schedulePreset !== "custom"; });
    renderPlatforms();
    renderCustom();
    renderUltimate();
  }

  async function requestPlatform(platform) {
    try { return await chrome.permissions.request({ origins: platform.permissionPatterns }); } catch (_error) { return false; }
  }

  async function hasPlatformPermission(platform) {
    try { return await chrome.permissions.contains({ origins: platform.permissionPatterns }); } catch (_error) { return false; }
  }

  async function refreshPermissionStates() {
    for (const platform of R.PLATFORMS.filter((item) => !item.core)) {
      const container = document.querySelector(`[data-permission-state="${platform.id}"]`);
      if (!container) continue;
      const enabled = settings.platforms[platform.id].mode !== "off";
      const granted = enabled && await hasPlatformPermission(platform);
      container.querySelector("span").textContent = !enabled ? "No site access requested" : granted ? "Optional access granted" : "Access needed to activate this site";
      container.querySelector("button").hidden = !enabled || granted || locked();
    }
  }

  async function removePlatformPermission(platform) {
    try { await chrome.permissions.remove({ origins: platform.permissionPatterns }); } catch (_error) {}
  }

  async function onModeChange(select) {
    if (locked()) return;
    const platform = R.platformById(select.dataset.platform);
    const next = select.value;
    if (!platform.core && next !== "off" && !(await hasPlatformPermission(platform))) {
      markStatus(`Waiting for ${platform.label} access...`);
      const granted = await requestPlatform(platform);
      if (!granted) {
        settings.platforms[platform.id].mode = "off";
        syncPlatformControls(platform);
        await save();
        await refreshPermissionStates();
        markStatus(`${platform.label} access was not granted`, true);
        return;
      }
    }
    settings.platforms[platform.id].mode = next;
    syncPlatformControls(platform);
    await save();
    if (!platform.core && next === "off") await removePlatformPermission(platform);
    await refreshPermissionStates();
  }

  function unlockControlsDisabled(disabled) {
    document.getElementById("unlockAction").disabled = disabled;
    document.getElementById("unlockPhrase").disabled = disabled;
    document.getElementById("unlockReason").disabled = disabled;
  }

  function renderUnlockProgress() {
    const segments = Array.from(document.querySelectorAll("#unlockProgress span"));
    segments.forEach((segment, index) => {
      segment.classList.toggle("complete", index < unlockCheckpointIndex);
      segment.classList.toggle("active", unlockActive && index === unlockCheckpointIndex);
    });
  }

  function resetUnlock(message) {
    clearInterval(unlockInterval);
    unlockInterval = null;
    unlockActive = false;
    unlockRemaining = 0;
    unlockCheckpointIndex = 0;
    unlockAwaitingCheckpoint = false;
    unlockLastTick = 0;
    unlockControlsDisabled(false);
    document.getElementById("confirmUnlock").disabled = true;
    document.getElementById("startUnlock").disabled = false;
    document.getElementById("unlockRitual").hidden = true;
    document.getElementById("unlockCheckpoint").hidden = true;
    document.getElementById("unlockTimer").textContent = message || "Keep this Settings page open, focused, and complete all three checkpoints.";
    renderUnlockProgress();
  }

  function updateUnlockTimer() {
    if (!unlockActive || unlockAwaitingCheckpoint) return;
    const now = Date.now();
    unlockRemaining = Math.max(0, unlockRemaining - Math.max(0, now - unlockLastTick));
    unlockLastTick = now;

    const checkpoint = UNLOCK_CHECKPOINTS[unlockCheckpointIndex];
    if (checkpoint && unlockRemaining <= checkpoint.remaining) {
      unlockRemaining = checkpoint.remaining;
      unlockAwaitingCheckpoint = true;
      const button = document.getElementById("unlockCheckpoint");
      button.textContent = checkpoint.label;
      button.hidden = false;
      document.getElementById("unlockTimer").textContent = `${Math.ceil(unlockRemaining / 1000)} seconds remain. Complete checkpoint ${unlockCheckpointIndex + 1} to continue.`;
      renderUnlockProgress();
      return;
    }

    if (unlockRemaining === 0) {
      clearInterval(unlockInterval);
      unlockInterval = null;
      document.getElementById("confirmUnlock").disabled = false;
      document.getElementById("startUnlock").disabled = true;
      document.getElementById("unlockTimer").textContent = "Focused minute and all checkpoints complete. Confirm removal without leaving this page.";
      renderUnlockProgress();
      return;
    }
    document.getElementById("unlockTimer").textContent = `Stay on this page: ${Math.ceil(unlockRemaining / 1000)} seconds remaining, ${UNLOCK_CHECKPOINTS.length - unlockCheckpointIndex} check-ins left.`;
  }

  document.addEventListener("change", async (event) => {
    const target = event.target;
    if (locked()) return;
    if (target.matches("select.mode-select[data-platform]")) return onModeChange(target);
    if (target.matches("select[data-entry-points]")) {
      const platform = R.platformById(target.dataset.entryPoints);
      settings.platforms[platform.id].entryPoints = target.value;
      syncPlatformControls(platform);
      return queueSave();
    }
    if (target.matches("input[data-core-toggle]")) {
      const platform = R.platformById(target.dataset.coreToggle);
      settings.platforms[platform.id].mode = target.checked ? platform.defaultMode : "off";
      syncPlatformControls(platform);
      return queueSave();
    }
    if (target.matches("input[data-surface]")) {
      settings.platforms[target.dataset.platform].surfaces[target.dataset.surface] = target.checked;
      return queueSave();
    }
    if (target.matches("input[data-section]")) {
      settings.platforms[target.dataset.platform].sections[target.dataset.section] = target.checked;
      queueSave();
    }
  });

  document.getElementById("protectionEnabled").addEventListener("change", (event) => {
    if (locked()) return;
    settings.protectionEnabled = event.target.checked;
    if (event.target.checked) settings.pausedUntil = null;
    queueSave();
  });
  appearanceSelect.addEventListener("change", (event) => {
    if (locked()) return;
    settings.appearance = event.target.value;
    applyAppearance();
    queueSave();
  });
  document.getElementById("schedulePreset").addEventListener("change", (event) => {
    if (locked()) return;
    settings.schedulePreset = event.target.value;
    document.querySelectorAll(".custom-time").forEach((node) => { node.hidden = event.target.value !== "custom"; });
    queueSave();
  });
  document.getElementById("customStart").addEventListener("change", (event) => { if (!locked()) { settings.customStart = event.target.value; queueSave(); } });
  document.getElementById("customEnd").addEventListener("change", (event) => { if (!locked()) { settings.customEnd = event.target.value; queueSave(); } });

  document.getElementById("customForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (locked()) return;
    const input = document.getElementById("customEntry");
    const error = document.getElementById("customError");
    const checked = R.validateEntry(input.value);
    error.textContent = checked.ok ? "" : checked.error;
    if (!checked.ok || settings.customEntries.includes(checked.value)) return;
    if (R.platformForUrl(`https://${checked.value.split("/")[0]}/`)) {
      error.textContent = "Use the platform controls above for supported sites.";
      return;
    }
    const pattern = R.permissionPatternForEntry(checked.value);
    const granted = await chrome.permissions.request({ origins: [pattern] }).catch(() => false);
    if (!granted) {
      error.textContent = "Site access was not granted, so nothing was added.";
      return;
    }
    settings.customEntries.push(checked.value);
    input.value = "";
    await save();
    renderCustom();
  });

  document.getElementById("customList").addEventListener("click", async (event) => {
    if (locked()) return;
    const entry = event.target.dataset.remove;
    if (!entry) return;
    settings.customEntries = settings.customEntries.filter((item) => item !== entry);
    const pattern = R.permissionPatternForEntry(entry);
    await save();
    if (!settings.customEntries.some((item) => R.permissionPatternForEntry(item) === pattern)) {
      await chrome.permissions.remove({ origins: [pattern] }).catch(() => false);
    }
    renderCustom();
  });

  advancedContainer.addEventListener("click", async (event) => {
    if (locked()) return;
    const id = event.target.dataset.grant;
    if (!id) return;
    const platform = R.platformById(id);
    const granted = await requestPlatform(platform);
    if (!granted) {
      settings.platforms[id].mode = "off";
      await save();
      renderPlatforms();
      markStatus(`${platform.label} access was not granted`, true);
      return;
    }
    await save();
    await refreshPermissionStates();
  });

  document.getElementById("enableUltimate").addEventListener("click", async () => {
    const phrase = document.getElementById("ultimateConfirmPhrase").value.trim();
    if (phrase !== "I ACCEPT THE LOCK") {
      setUltimateFeedback("Type I ACCEPT THE LOCK exactly before enabling Ultimate Lock.", true);
      return;
    }
    const profile = document.getElementById("ultimateProfile").value;
    settings = R.createUltimateSettings(settings, profile);
    await save();
    renderAll();
    setUltimateFeedback("Ultimate Lock is active. Removal requires a private reflection, three check-ins, and one focused minute.");
  });

  document.getElementById("startUnlock").addEventListener("click", () => {
    const action = document.getElementById("unlockAction").value;
    const phrase = document.getElementById("unlockPhrase").value.trim();
    const reason = document.getElementById("unlockReason").value.trim();
    if (action !== "remove_ultimate" || phrase !== "REMOVE ULTIMATE" || reason.length < 20) {
      setUltimateFeedback("Choose Remove Ultimate Lock, type REMOVE ULTIMATE exactly, and write at least 20 characters about why you are removing it.", true);
      return;
    }
    setUltimateFeedback("");
    unlockActive = true;
    unlockRemaining = UNLOCK_DURATION;
    unlockCheckpointIndex = 0;
    unlockAwaitingCheckpoint = false;
    unlockLastTick = Date.now();
    unlockControlsDisabled(true);
    document.getElementById("startUnlock").disabled = true;
    document.getElementById("unlockRitual").hidden = false;
    document.getElementById("unlockCheckpoint").hidden = true;
    renderUnlockProgress();
    updateUnlockTimer();
    unlockInterval = setInterval(updateUnlockTimer, 250);
  });

  document.getElementById("unlockCheckpoint").addEventListener("click", () => {
    if (!unlockActive || !unlockAwaitingCheckpoint) return;
    unlockCheckpointIndex += 1;
    unlockAwaitingCheckpoint = false;
    unlockLastTick = Date.now();
    document.getElementById("unlockCheckpoint").hidden = true;
    renderUnlockProgress();
    updateUnlockTimer();
  });

  document.getElementById("confirmUnlock").addEventListener("click", async () => {
    const action = document.getElementById("unlockAction").value;
    const phrase = document.getElementById("unlockPhrase").value.trim();
    const reason = document.getElementById("unlockReason").value.trim();
    if (!unlockActive || unlockRemaining > 0 || unlockCheckpointIndex !== UNLOCK_CHECKPOINTS.length || action !== "remove_ultimate" || phrase !== "REMOVE ULTIMATE" || reason.length < 20) {
      resetUnlock();
      setUltimateFeedback("The release conditions changed. Complete the focused release again.", true);
      return;
    }
    settings = R.releaseUltimateSettings(settings);
    await save();
    resetUnlock();
    renderAll();
    setUltimateFeedback("Ultimate Lock has been removed. Protection remains on until you change it.");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && unlockActive) {
      resetUnlock("Release reset because Settings was left. Start again when you are ready.");
      setUltimateFeedback("The focused minute and all checkpoints must be completed without leaving Settings.", true);
    }
  });
  window.addEventListener("blur", () => {
    if (unlockActive) {
      resetUnlock("Release reset because Settings lost focus. Start again when you are ready.");
      setUltimateFeedback("The focused minute and all checkpoints must be completed without leaving Settings.", true);
    }
  });
  window.addEventListener("pagehide", () => resetUnlock());
  globalThis.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (settings.appearance === "system") applyAppearance();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[R.SETTINGS_KEY]) return;
    const next = R.normalizeSettings(changes[R.SETTINGS_KEY].newValue);
    if (unlockActive) resetUnlock();
    // Saves made on this page echo back through storage. Re-rendering on the echo collapses
    // every open row (fresh <details> start closed) and wipes whatever the user was doing,
    // even though nothing changed — enabling an optional site like X then requires reopening
    // rows between every click, and its section checkboxes can never be ticked in one flow.
    // Only re-render for genuinely external updates, and keep the rows already open.
    if (JSON.stringify(next) === JSON.stringify(settings)) return;
    const advancedOpen = document.querySelector("details.advanced")?.open === true;
    const openSites = new Set(Array.from(document.querySelectorAll("details.optional-site[open]"))
      .map((node) => node.querySelector("select.mode-select[data-platform]")?.dataset.platform)
      .filter(Boolean));
    settings = next;
    renderAll();
    if (advancedOpen) document.querySelector("details.advanced").open = true;
    document.querySelectorAll("details.optional-site").forEach((row) => {
      const id = row.querySelector("select.mode-select[data-platform]")?.dataset.platform;
      if (id && openSites.has(id)) row.open = true;
    });
  });

  // Firefox for Android offers no interface for granting or withdrawing optional host access, so
  // the optional-sites and custom-pages flows would fail with nothing on screen to explain why.
  // The four bundled core sites need no grant and keep working.
  async function hideUngrantableFlowsOnAndroid() {
    let platform = null;
    try { platform = await chrome.runtime.getPlatformInfo(); } catch (_error) { return; }
    if (!platform || platform.os !== "android") return;
    document.getElementById("moreSitesSection").hidden = true;
    document.getElementById("customSection").hidden = true;
    document.getElementById("mobileNotice").hidden = false;
  }

  renderAll();
  await hideUngrantableFlowsOnAndroid();
  await chrome.storage.local.set({ [R.SETTINGS_KEY]: settings });
})();
