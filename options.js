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

  // Serialized background writes: only the requested fields are applied to the
  // latest state, so a stale page never overwrites unrelated changes elsewhere.
  let pendingPatch = null;
  async function sendPatchNow() {
    clearTimeout(saveTimer);
    const patch = pendingPatch;
    pendingPatch = null;
    if (!patch || locked()) return;
    markStatus("Saving...");
    try {
      const response = await chrome.runtime.sendMessage({ type: "patchSettings", patch });
      if (!response || response.ok === false) {
        markStatus((response && response.error) || "Couldn't save changes.", true);
        return;
      }
      if (response.locked) {
        markStatus("Ultimate Lock active", true);
        return;
      }
      settings = R.normalizeSettings(response.settings);
      if (response.applied === false) {
        markStatus(`Saved, but protection could not be applied (${response.error || "unknown error"}). Reload settings.`, true);
      } else {
        markStatus(settings.ultimate.enabled ? "Ultimate Lock active" : "Saved locally. If you just granted access, refresh already-open site tabs.");
      }
      R.PLATFORMS.forEach(syncPlatformControls);
      await refreshPermissionStates();
    } catch (error) {
      markStatus(`Couldn't save changes (${error && error.message ? error.message : "storage unavailable"}).`, true);
    }
  }

  async function save() {
    await sendPatchNow();
  }

  function queueSave() {
    if (locked()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(sendPatchNow, 180);
  }

  function queuePatch(patch) {
    if (locked()) return;
    pendingPatch = pendingPatch || {};
    for (const [key, value] of Object.entries(patch)) {
      if (key === "platforms" && value && typeof value === "object") {
        pendingPatch.platforms = pendingPatch.platforms || {};
        for (const [id, change] of Object.entries(value)) {
          pendingPatch.platforms[id] = { ...(pendingPatch.platforms[id] || {}), ...change };
          if (change.sections) pendingPatch.platforms[id].sections = { ...((pendingPatch.platforms[id] || {}).sections || {}), ...change.sections };
          if (change.surfaces) pendingPatch.platforms[id].surfaces = { ...((pendingPatch.platforms[id] || {}).surfaces || {}), ...change.surfaces };
        }
      } else {
        pendingPatch[key] = value;
      }
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(sendPatchNow, 180);
  }

  async function sendPlatformEnabled(platformId, enabled) {
    if (locked()) return;
    markStatus("Saving...");
    try {
      const response = await chrome.runtime.sendMessage({ type: "setPlatformEnabled", platform: platformId, enabled });
      if (!response || response.ok === false) {
        markStatus((response && response.error) || "Couldn't save changes.", true);
        return;
      }
      settings = R.normalizeSettings(response.settings);
      const platform = R.platformById(platformId);
      if (platform) syncPlatformControls(platform);
      markStatus(response.applied === false ? `Saved, but protection could not be applied (${response.error || "unknown error"}).` : "Saved locally. If you just granted access, refresh already-open site tabs.", response.applied === false);
      await refreshPermissionStates();
    } catch (error) {
      markStatus(`Couldn't save changes (${error && error.message ? error.message : "storage unavailable"}).`, true);
    }
  }

  async function sendSection(platformId, sectionId, blocked) {
    if (locked()) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: "setSection", platform: platformId, section: sectionId, blocked });
      if (!response || response.ok === false) {
        markStatus((response && response.error) || "Couldn't save changes.", true);
        return;
      }
      settings = R.normalizeSettings(response.settings);
      const platform = R.platformById(platformId);
      if (platform) syncPlatformControls(platform);
      markStatus(response.applied === false ? `Saved, but protection could not be applied (${response.error || "unknown error"}).` : "Saved locally.", response.applied === false);
    } catch (error) {
      markStatus(`Couldn't save changes (${error && error.message ? error.message : "storage unavailable"}).`, true);
    }
  }

  function platformGlyph(platform) {
    if (platform.id === "youtube") return "YT";
    if (platform.id === "instagram") return "IG";
    if (platform.id === "facebook") return "FB";
    return "TT";
  }

  function platformCoverage(platform) {
    if (platform.id === "youtube") return "Shorts links, shelves, and tabs";
    if (platform.id === "tiktok") return "For You and video pages";
    if (platform.id === "facebook") return "Reels and feed videos";
    return "Reels links and direct Reel visits";
  }

  function modeSummaryText(platform) {
    const setting = settings.platforms[platform.id];
    if (setting.mode === "off") return `${platform.label} is off. Nothing is blocked here.`;
    if (setting.mode === "all") return `Blocks everything on ${platform.label} with a focus screen.`;
    if (setting.mode === "selected") {
      const total = platform.sections.length;
      const blocked = platform.sections.filter((section) => setting.sections[section.id]).length;
      return `${blocked} of ${total} parts blocked. Tick the parts you want gone.`;
    }
    const shortform = platform.sections.filter((section) => section.shortform).map((section) => section.label).join(" + ");
    const extra = platform.sections.filter((section) => !section.shortform).map((section) => section.label).join(", ");
    return shortform ? `Blocks ${shortform}.${extra ? ` ${extra} stay available.` : ""}` : "";
  }

  function platformCard(platform) {
    const card = document.createElement("article");
    card.className = "platform-card platform-full";
    card.dataset.platformCard = platform.id;
    const setting = settings.platforms[platform.id];
    const protectedOn = setting.mode !== "off";
    const effectiveMode = protectedOn ? setting.mode : platform.defaultMode;
    const sectionList = platform.sections.map((section) => `<label class="section-option"><input type="checkbox" data-platform="${platform.id}" data-section="${section.id}" ${setting.sections[section.id] ? "checked" : ""}><span><b>${section.label}</b>${section.description ? `<small>${section.description}</small>` : ""}</span></label>`).join("");
    const surfaces = (platform.surfaces || []).map((surface) => `<label class="section-option surface-option"><input type="checkbox" data-platform="${platform.id}" data-surface="${surface.id}" ${setting.surfaces[surface.id] ? "checked" : ""}><span><b>${surface.label}</b>${surface.description ? `<small>${surface.description}</small>` : ""}</span></label>`).join("");
    // Quieten switches stay visible whenever the site is protected, not only in Selected
    // sections mode: they hide page furniture without blocking anything.
    const surfaceBlock = surfaces
      ? `<div class="surface-subgroup" data-quieten="${platform.id}" ${protectedOn ? "" : "hidden"}><span class="surface-subtitle">Also quieten (stay reachable, just hidden)</span>${surfaces}</div>`
      : "";
    card.innerHTML = `<header class="platform-head"><span class="platform-mark">${platformGlyph(platform)}</span><span class="platform-titles"><strong>${platform.label}</strong><small>${platformCoverage(platform)}</small></span><label class="core-toggle"><input type="checkbox" data-core-toggle="${platform.id}" ${protectedOn ? "checked" : ""} aria-label="Protect ${platform.label}"><span aria-hidden="true"></span><b>${protectedOn ? "Protected" : "Off"}</b></label></header>`
      + `<fieldset class="mode-group" data-mode-group="${platform.id}" ${protectedOn ? "" : "disabled"}><legend>Blocking level</legend>`
      + `<label class="mode-pill"><input type="radio" name="mode-${platform.id}" data-mode-radio="${platform.id}" value="shortform" ${effectiveMode === "shortform" ? "checked" : ""} ${protectedOn ? "" : "disabled"}><span>Short-form only</span></label>`
      + `<label class="mode-pill"><input type="radio" name="mode-${platform.id}" data-mode-radio="${platform.id}" value="selected" ${effectiveMode === "selected" ? "checked" : ""} ${protectedOn ? "" : "disabled"}><span>Selected sections</span></label>`
      + `<label class="mode-pill"><input type="radio" name="mode-${platform.id}" data-mode-radio="${platform.id}" value="all" ${effectiveMode === "all" ? "checked" : ""} ${protectedOn ? "" : "disabled"}><span>Block everything</span></label>`
      + `</fieldset>`
      + `<p class="mode-summary" data-mode-summary="${platform.id}">${modeSummaryText(platform)}</p>`
      + `<div class="section-picker" data-section-choices="${platform.id}" ${setting.mode === "selected" && protectedOn ? "" : "hidden"}><span class="section-picker-title">Choose which parts to block</span><div class="section-list">${sectionList}</div></div>${surfaceBlock}`
      + `<label class="entry-choice" data-entry-choice="${platform.id}" ${entryChoiceApplies(platform) ? "" : "hidden"}>${entryLabel(platform)}<select data-entry-points="${platform.id}" aria-label="${platform.label} entry points in feeds">${entryOptions(setting.entryPoints)}</select></label>`;
    return card;
  }

  function advancedRow(platform) {
    const row = document.createElement("details");
    row.className = "advanced-platform optional-site";
    const setting = settings.platforms[platform.id];
    const choices = platform.sections.map((section) => `<label><input type="checkbox" data-platform="${platform.id}" data-section="${section.id}" ${setting.sections[section.id] ? "checked" : ""}><span>${section.label}${section.description ? `<small class="focus-control-note">${section.description}</small>` : ""}</span></label>`).join("");
    const permissionState = `<div class="permission-state" data-permission-state="${platform.id}"><span>Checking optional access...</span><button type="button" data-grant="${platform.id}" hidden>Grant access</button></div>`;
    const entryChoice = `<label class="entry-choice" data-entry-choice="${platform.id}" ${entryChoiceApplies(platform) ? "" : "hidden"}>${entryLabel(platform)}<select class="entry-select" data-entry-points="${platform.id}" aria-label="${platform.label} entry points in feeds">${entryOptions(setting.entryPoints)}</select></label>`;
    const surfaces = (platform.surfaces || []).map((surface) => `<label><input type="checkbox" data-platform="${platform.id}" data-surface="${surface.id}" ${setting.surfaces[surface.id] ? "checked" : ""}><span>${surface.label}${surface.description ? `<small class="focus-control-note">${surface.description}</small>` : ""}</span></label>`).join("");
    const surfaceBlock = surfaces
      ? `<div class="surface-choices" data-surface-choices="${platform.id}"><span class="surface-title">Also quieten these parts of the page</span><div class="surface-grid">${surfaces}</div><p class="surface-note">Off by default. These stay reachable, they are just hidden. Turn one off again if a page stops behaving.</p></div>`
      : "";
    const focusControls = `<div class="section-choices focus-choices" data-section-choices="${platform.id}" ${setting.mode === "selected" ? "" : "hidden"}>${choices}</div>`;
    const controls = `<div class="mode-controls"><select class="mode-select" data-platform="${platform.id}" aria-label="${platform.label} blocking mode">${modeOptions(setting.mode, platform)}</select>${entryChoice}</div>${focusControls}${surfaceBlock}${permissionState}`;
    const mode = settings.platforms[platform.id].mode;
    row.innerHTML = `<summary><span><strong>${platform.label}</strong><small>${mode === "off" ? "Off — optional access" : R.PLATFORM_MODES.find((item) => item.value === mode).label}</small></span><span class="row-chevron" aria-hidden="true"></span></summary><div class="advanced-platform-body">${controls}</div>`;
    return row;
  }

  // Core cards are the single place for core choices now; keep every copy in step.
  function syncPlatformControls(platform) {
    const setting = settings.platforms[platform.id];
    const enabled = setting.mode !== "off";
    const coreToggle = document.querySelector(`input[data-core-toggle="${platform.id}"]`);
    if (coreToggle) {
      coreToggle.checked = enabled;
      coreToggle.closest(".core-toggle").querySelector("b").textContent = enabled ? "Protected" : "Off";
    }
    document.querySelectorAll(`select.mode-select[data-platform="${platform.id}"]`).forEach((select) => { select.value = setting.mode; });
    document.querySelectorAll(`input[data-mode-radio="${platform.id}"]`).forEach((radio) => {
      radio.checked = radio.value === (enabled ? setting.mode : platform.defaultMode);
      radio.disabled = !enabled || locked();
    });
    document.querySelectorAll(`fieldset[data-mode-group="${platform.id}"]`).forEach((group) => {
      if (group.disabled !== !enabled) group.disabled = !enabled;
    });
    document.querySelectorAll(`[data-section-choices="${platform.id}"]`).forEach((node) => {
      // Core cards show the picker only for Selected sections; optional rows share the same attr.
      if (node.classList.contains("section-picker")) node.hidden = !(enabled && setting.mode === "selected");
      else node.hidden = setting.mode !== "selected";
    });
    document.querySelectorAll(`[data-surface-choices="${platform.id}"]`).forEach((node) => { node.hidden = setting.mode === "off"; });
    document.querySelectorAll(`[data-quieten="${platform.id}"]`).forEach((node) => { node.hidden = !enabled; });
    document.querySelectorAll(`[data-entry-choice="${platform.id}"]`).forEach((node) => { node.hidden = !entryChoiceApplies(platform); });
    document.querySelectorAll(`select[data-entry-points="${platform.id}"]`).forEach((select) => { select.value = setting.entryPoints; });
    document.querySelectorAll(`[data-mode-summary="${platform.id}"]`).forEach((node) => { node.textContent = modeSummaryText(platform); });
    // Keep the detailed Advanced rows in step with one-click changes made on the core cards.
    document.querySelectorAll(`input[data-platform="${platform.id}"][data-section]`).forEach((box) => {
      if (box.dataset.section in setting.sections) box.checked = Boolean(setting.sections[box.dataset.section]);
    });
    document.querySelectorAll(`input[data-platform="${platform.id}"][data-surface]`).forEach((box) => {
      if (setting.surfaces && box.dataset.surface in setting.surfaces) box.checked = Boolean(setting.surfaces[box.dataset.surface]);
    });
    const summary = document.querySelector(`.optional-site select.mode-select[data-platform="${platform.id}"]`)?.closest(".optional-site")?.querySelector("summary small");
    if (summary) summary.textContent = setting.mode === "off" ? "Off — optional access" : R.PLATFORM_MODES.find((item) => item.value === setting.mode).label;
  }

  function renderPlatforms() {
    coreContainer.textContent = "";
    advancedContainer.textContent = "";
    R.PLATFORMS.forEach((platform) => {
      if (platform.core) {
        coreContainer.appendChild(platformCard(platform));
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
      : "Lock protection to remove ReelLess pause and setting changes. Choose what stays blocked before you turn it on.";

    document.querySelectorAll("main input, main select, main button").forEach((control) => {
      if (ultimatePanel && ultimatePanel.contains(control)) return;
      control.disabled = isLocked;
    });
    // The lock's own removal controls must stay usable while locked; renderUltimate
    // never disables them (the ritual manages its own buttons).
    for (const id of ["unlockAction", "unlockPhrase", "unlockReason", "startUnlock", "enableUltimate", "ultimateProfile", "ultimateConfirmPhrase"]) {
      const node = document.getElementById(id);
      if (node && ultimatePanel && ultimatePanel.contains(node)) node.disabled = false;
    }
    if (isLocked) document.getElementById("confirmUnlock").disabled = true;
    // aria-disabled marks the non-lock Advanced controls only: the lock lives inside
    // Advanced now, so flagging the whole container would disable its own removal UI.
    for (const selector of [".advanced-intro", ".routine-section", "#moreSitesSection", "#customSection"]) {
      document.querySelector(selector)?.setAttribute("aria-disabled", String(isLocked));
    }
    document.querySelector("details.advanced")?.setAttribute("aria-disabled", "false");
    document.getElementById("ultimateDetails")?.setAttribute("aria-disabled", "false");
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
        // Denial never reports successful activation: force Off through the writer.
        await sendPlatformEnabled(platform.id, false);
        select.value = "off";
        syncPlatformControls(platform);
        await refreshPermissionStates();
        markStatus(`${platform.label} access was not granted, so nothing was activated.`, true);
        return;
      }
      settings.platforms[platform.id].mode = next;
      syncPlatformControls(platform);
      await sendPatchNowWith({ platforms: { [platform.id]: { mode: next } } });
      markStatus(`${platform.label} activated. Refresh already-open ${platform.label} tabs.`);
      if (!platform.core && next === "off") await removePlatformPermission(platform);
      await refreshPermissionStates();
      return;
    }
    settings.platforms[platform.id].mode = next;
    syncPlatformControls(platform);
    if (next === "off" && !platform.core) {
      await sendPlatformEnabled(platform.id, false);
      await removePlatformPermission(platform);
    } else if (!platform.core && next !== "off") {
      await sendPatchNowWith({ platforms: { [platform.id]: { mode: next } } });
      markStatus(`${platform.label} saved. Refresh already-open ${platform.label} tabs.`);
    } else {
      queuePatch({ platforms: { [platform.id]: { mode: next } } });
    }
    await refreshPermissionStates();
  }

  async function sendPatchNowWith(patch) {
    pendingPatch = pendingPatch || {};
    for (const [key, value] of Object.entries(patch)) {
      if (key === "platforms") {
        pendingPatch.platforms = pendingPatch.platforms || {};
        for (const [id, change] of Object.entries(value)) {
          pendingPatch.platforms[id] = { ...(pendingPatch.platforms[id] || {}), ...change };
        }
      } else {
        pendingPatch[key] = value;
      }
    }
    await sendPatchNow();
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
    if (target.matches('input[data-mode-radio]')) {
      const platform = R.platformById(target.dataset.modeRadio);
      if (!platform || !target.checked) return;
      // Optimistic UI, then serialized background write of only this field.
      settings.platforms[platform.id].mode = target.value;
      if (target.value === "shortform") {
        platform.sections.forEach((section) => {
          settings.platforms[platform.id].sections[section.id] = Boolean(section.shortform);
        });
      }
      syncPlatformControls(platform);
      queuePatch({ platforms: { [platform.id]: { mode: target.value, sections: { ...settings.platforms[platform.id].sections } } } });
      return;
    }
    if (target.matches("select[data-entry-points]")) {
      const platform = R.platformById(target.dataset.entryPoints);
      settings.platforms[platform.id].entryPoints = target.value;
      syncPlatformControls(platform);
      queuePatch({ platforms: { [platform.id]: { entryPoints: target.value } } });
      return;
    }
    if (target.matches("input[data-core-toggle]")) {
      const platform = R.platformById(target.dataset.coreToggle);
      // Remember last enabled mode: Off -> On restores it via the background writer.
      settings.platforms[platform.id].mode = target.checked ? (settings.platforms[platform.id].lastEnabledMode || platform.defaultMode) : "off";
      syncPlatformControls(platform);
      await sendPlatformEnabled(platform.id, target.checked);
      return;
    }
    if (target.matches("input[data-surface]")) {
      settings.platforms[target.dataset.platform].surfaces[target.dataset.surface] = target.checked;
      queuePatch({ platforms: { [target.dataset.platform]: { surfaces: { [target.dataset.surface]: target.checked } } } });
      return;
    }
    if (target.matches("input[data-section]")) {
      const platform = R.platformById(target.dataset.platform);
      settings.platforms[target.dataset.platform].sections[target.dataset.section] = target.checked;
      if (platform) syncPlatformControls(platform);
      await sendSection(target.dataset.platform, target.dataset.section, target.checked);
      return;
    }
  });

  document.getElementById("protectionEnabled").addEventListener("change", (event) => {
    if (locked()) return;
    settings.protectionEnabled = event.target.checked;
    if (event.target.checked) settings.pausedUntil = null;
    queuePatch({ protectionEnabled: event.target.checked, pausedUntil: event.target.checked ? null : settings.pausedUntil });
  });
  appearanceSelect.addEventListener("change", (event) => {
    if (locked()) return;
    settings.appearance = event.target.value;
    applyAppearance();
    queuePatch({ appearance: event.target.value });
  });
  document.getElementById("schedulePreset").addEventListener("change", (event) => {
    if (locked()) return;
    settings.schedulePreset = event.target.value;
    document.querySelectorAll(".custom-time").forEach((node) => { node.hidden = event.target.value !== "custom"; });
    queuePatch({ schedulePreset: event.target.value });
  });
  document.getElementById("customStart").addEventListener("change", (event) => { if (!locked()) { settings.customStart = event.target.value; queuePatch({ customStart: event.target.value }); } });
  document.getElementById("customEnd").addEventListener("change", (event) => { if (!locked()) { settings.customEnd = event.target.value; queuePatch({ customEnd: event.target.value }); } });

  document.getElementById("customForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (locked()) return;
    const input = document.getElementById("customEntry");
    const error = document.getElementById("customError");
    const checked = R.validateEntry(input.value);
    error.textContent = checked.ok ? "" : checked.error;
    if (!checked.ok) return;
    if (settings.customEntries.includes(checked.value)) {
      error.textContent = "This boundary is already added.";
      return;
    }
    if (settings.customEntries.length >= R.MAX_CUSTOM_ENTRIES) {
      error.textContent = `The list holds up to ${R.MAX_CUSTOM_ENTRIES} boundaries. Remove one before adding another.`;
      return;
    }
    if (R.platformForUrl(`https://${checked.value.split("/")[0]}/`)) {
      error.textContent = "Use the platform controls above for supported sites.";
      return;
    }
    const pattern = R.permissionPatternForEntry(checked.value);
    // Check capacity before requesting access: never request then silently drop.
    const nextEntries = [...settings.customEntries, checked.value];
    const granted = await chrome.permissions.request({ origins: [pattern] }).catch(() => false);
    if (!granted) {
      error.textContent = "Site access was not granted, so nothing was added. The boundary was not activated.";
      markStatus(`${checked.value} was not activated — access denied.`, true);
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({ type: "patchSettings", patch: { customEntries: nextEntries } });
      if (!response || response.ok === false || response.locked) {
        error.textContent = (response && response.error) || "Couldn't save the boundary.";
        await chrome.permissions.remove({ origins: [pattern] }).catch(() => false);
        return;
      }
      settings = R.normalizeSettings(response.settings);
      input.value = "";
      error.textContent = "";
      markStatus(response.applied === false
        ? `Saved, but protection could not be applied (${response.error || "unknown error"}).`
        : "Boundary added. Refresh already-open tabs on that site to activate it.");
      renderCustom();
      await refreshPermissionStates();
    } catch (saveError) {
      error.textContent = "Couldn't save the boundary.";
      await chrome.permissions.remove({ origins: [pattern] }).catch(() => false);
    }
  });

  document.getElementById("customList").addEventListener("click", async (event) => {
    if (locked()) return;
    const entry = event.target.dataset.remove;
    if (!entry) return;
    const nextEntries = settings.customEntries.filter((item) => item !== entry);
    const pattern = R.permissionPatternForEntry(entry);
    try {
      const response = await chrome.runtime.sendMessage({ type: "patchSettings", patch: { customEntries: nextEntries } });
      if (response && response.settings) settings = R.normalizeSettings(response.settings);
      // Retain access if another entry still uses that exact host.
      if (!settings.customEntries.some((item) => R.permissionPatternForEntry(item) === pattern)) {
        await chrome.permissions.remove({ origins: [pattern] }).catch(() => false);
      }
      markStatus("Boundary removed.");
      renderCustom();
      await refreshPermissionStates();
    } catch (_error) {
      markStatus("Couldn't remove the boundary.", true);
    }
  });

  advancedContainer.addEventListener("click", async (event) => {
    if (locked()) return;
    const id = event.target.dataset.grant;
    if (!id) return;
    const platform = R.platformById(id);
    const granted = await requestPlatform(platform);
    if (!granted) {
      await sendPlatformEnabled(id, false);
      renderPlatforms();
      markStatus(`${platform.label} access was not granted, so nothing was activated.`, true);
      return;
    }
    await sendPatchNowWith({ platforms: { [id]: { mode: settings.platforms[id].mode } } });
    markStatus(`${platform.label} access granted. Refresh already-open ${platform.label} tabs.`);
    await refreshPermissionStates();
  });

  document.getElementById("enableUltimate").addEventListener("click", async () => {
    const phrase = document.getElementById("ultimateConfirmPhrase").value.trim();
    if (phrase !== "I ACCEPT THE LOCK") {
      setUltimateFeedback("Type I ACCEPT THE LOCK exactly before enabling Ultimate Lock.", true);
      return;
    }
    const profile = document.getElementById("ultimateProfile").value;
    try {
      const response = await chrome.runtime.sendMessage({ type: "enableUltimate", profile });
      if (!response || response.ok === false) {
        setUltimateFeedback((response && response.error) || "Couldn't enable Ultimate Lock.", true);
        return;
      }
      settings = R.normalizeSettings(response.settings);
      renderAll();
      setUltimateFeedback("Ultimate Lock is active. Removal requires a private reflection, three check-ins, and one focused minute.");
    } catch (error) {
      setUltimateFeedback(`Couldn't enable Ultimate Lock (${error && error.message ? error.message : "storage unavailable"}).`, true);
    }
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
    try {
      const response = await chrome.runtime.sendMessage({ type: "releaseUltimate" });
      if (!response || response.ok === false) {
        setUltimateFeedback((response && response.error) || "Couldn't remove Ultimate Lock.", true);
        return;
      }
      settings = R.normalizeSettings(response.settings);
      resetUnlock();
      renderAll();
      setUltimateFeedback("Ultimate Lock has been removed. Protection remains on until you change it.");
    } catch (error) {
      setUltimateFeedback(`Couldn't remove Ultimate Lock (${error && error.message ? error.message : "storage unavailable"}).`, true);
    }
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

  async function renderDiagnostics() {
    const summary = document.getElementById("diagnosticsSummary");
    if (!summary) return;
    try {
      const state = await chrome.runtime.sendMessage({ type: "getState" });
      const status = state && state.status ? state.status : R.getEffectiveStatus(settings, new Date()).key;
      const version = chrome.runtime.getManifest ? chrome.runtime.getManifest().version : "unknown";
      let browser = "unknown";
      try {
        const info = await chrome.runtime.getPlatformInfo();
        browser = info && info.os ? `os:${info.os}` : "unknown";
      } catch (_error) {}
      const activeCount = R.PLATFORMS.filter((platform) => settings.platforms[platform.id].mode !== "off").length;
      summary.textContent = `ReelLess ${version} — ${status}, ${activeCount} site(s) enabled, schedule ${settings.schedulePreset}, Ultimate Lock ${settings.ultimate.enabled ? "active" : "off"}.`;
      summary.dataset.diagnostics = R.buildDiagnostics({
        version, browser, status, schedule: settings.schedulePreset, locked: settings.ultimate.enabled,
        platforms: R.PLATFORMS.map((platform) => ({ id: platform.id, mode: settings.platforms[platform.id].mode })),
        limitation: "direct custom visits may show the browser blocked-page error; refresh open tabs after granting access"
      });
    } catch (_error) {
      summary.textContent = "Diagnostics unavailable (storage or background unreachable).";
    }
  }

  const copyButton = document.getElementById("copyDiagnostics");
  if (copyButton) {
    copyButton.addEventListener("click", async () => {
      const status = document.getElementById("diagnosticsStatus");
      const summary = document.getElementById("diagnosticsSummary");
      const text = (summary && summary.dataset.diagnostics) || (summary ? summary.textContent : "");
      try {
        await navigator.clipboard.writeText(text);
        if (status) status.textContent = "Diagnostics copied. Paste it into your support report.";
      } catch (_error) {
        if (status) status.textContent = "Copy failed — select the summary above manually.";
      }
    });
  }

  const resetButton = document.getElementById("resetCounters");
  if (resetButton) {
    resetButton.addEventListener("click", async () => {
      const status = document.getElementById("resetStatus");
      if (!window.confirm("Reset Total blocked attempts to zero? Settings, lock, and review state stay.")) return;
      try {
        const response = await chrome.runtime.sendMessage({ type: "resetStats" });
        if (!response || response.ok === false) {
          if (status) status.textContent = "Couldn't reset counters.";
          return;
        }
        if (status) status.textContent = "Counters reset to zero.";
      } catch (_error) {
        if (status) status.textContent = "Couldn't reset counters.";
      }
    });
  }

  renderAll();
  await hideUngrantableFlowsOnAndroid();
  await renderDiagnostics();
  // Persist the normalized (migrated) settings once so schema 11 + lastEnabledMode stick.
  await chrome.runtime.sendMessage({ type: "patchSettings", patch: {} }).catch(() => chrome.storage.local.set({ [R.SETTINGS_KEY]: settings }));
})();
