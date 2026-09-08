// Stages and zips the Firefox package. The manifest is generated from manifest.json rather than
// maintained separately, so a change to the Chrome manifest cannot silently skip Firefox.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { toFirefoxManifest, SHARED_FILES } from "./firefox-manifest.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"));
const dist = path.join(root, "dist");
const stage = path.join(dist, "firefox");
const zipPath = path.join(dist, "reelless-firefox.zip");

const chromeManifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const firefoxManifest = toFirefoxManifest(chromeManifest);

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.writeFileSync(path.join(stage, "manifest.json"), `${JSON.stringify(firefoxManifest, null, 2)}\n`, "utf8");

for (const file of SHARED_FILES) {
  const source = path.join(root, file);
  if (!fs.existsSync(source)) throw new Error(`Missing packaged file: ${file}`);
  fs.copyFileSync(source, path.join(stage, file));
}
fs.cpSync(path.join(root, "icons"), path.join(stage, "icons"), { recursive: true });

fs.rmSync(zipPath, { force: true });
execFileSync("powershell", [
  "-ExecutionPolicy", "Bypass", "-NoProfile", "-Command",
  `Compress-Archive -Path (Join-Path '${stage}' '*') -DestinationPath '${zipPath}' -CompressionLevel Optimal`
], { stdio: "inherit" });

// The same root-level check the Chrome package makes: AMO rejects a wrapping directory.
const staged = fs.readdirSync(stage);
if (!staged.includes("manifest.json")) throw new Error("manifest.json is not at the package root");
if (!fs.existsSync(zipPath)) throw new Error("The Firefox archive was not produced");

console.log(`Firefox package staged at ${stage}`);
console.log(`Firefox archive written to ${zipPath}`);
console.log(`Add-on id ${firefoxManifest.browser_specific_settings.gecko.id}, minimum Firefox ${firefoxManifest.browser_specific_settings.gecko.strict_min_version}`);
