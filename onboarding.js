async function applyAppearance() {
  const stored = await chrome.storage.local.get([ReelLess.SETTINGS_KEY, ReelLess.LEGACY_SETTINGS_KEY]);
  const settings = ReelLess.normalizeSettings(stored[ReelLess.SETTINGS_KEY] || stored[ReelLess.LEGACY_SETTINGS_KEY]);
  document.documentElement.dataset.theme = settings.appearance === "system"
    ? (globalThis.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : settings.appearance;
}

applyAppearance().catch(() => {});
document.getElementById("settingsButton").addEventListener("click", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: "openOptions" });
    if (!response || response.ok === false) chrome.runtime.openOptionsPage();
  } catch (_error) {
    try { chrome.runtime.openOptionsPage(); } catch (_ignored) {}
  }
});
document.getElementById("pinHelp").addEventListener("click", () => {
  const target = document.getElementById("pinInstructions");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.remove("highlight");
  requestAnimationFrame(() => target.classList.add("highlight"));
});
