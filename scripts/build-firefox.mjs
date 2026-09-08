// Stages and zips the Firefox package. The manifest is generated from manifest.json rather than
// maintained separately, so a change to the Chrome manifest cannot silently skip Firefox.
import fs from "node:fs";
import path from "node:path";
import { toFirefoxManifest, SHARED_FILES } from "./firefox-manifest.mjs";
import { collectEntries, writeZip, assertStorePackage } from "./zip.mjs";

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

// Written by the shared writer rather than Compress-Archive: Windows PowerShell 5.1 stores nested
// entries with backslashes, which AMO's validator rejects as INVALID_XPI_ENTRY.
fs.rmSync(zipPath, { force: true });
writeZip(zipPath, collectEntries(stage, fs.readdirSync(stage).sort()));

// The same root-level checks the Chrome package makes, read back from the archive itself:
// AMO rejects a wrapping directory and a backslash in any entry name.
const shipped = assertStorePackage(zipPath);
for (const file of ["manifest.json", ...SHARED_FILES]) {
  if (!shipped.includes(file)) throw new Error(`${file} is missing from the Firefox archive`);
}

console.log(`Firefox package staged at ${stage}`);
console.log(`Firefox archive written to ${zipPath}`);
console.log(`Add-on id ${firefoxManifest.browser_specific_settings.gecko.id}, minimum Firefox ${firefoxManifest.browser_specific_settings.gecko.strict_min_version}`);
