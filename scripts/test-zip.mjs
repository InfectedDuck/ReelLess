import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { collectEntries, writeZip, readZip, assertStorePackage } from "./zip.mjs";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "reelless-zip-"));
try {
  // A tree shaped like the package: a root manifest, a nested icons directory, a binary and a
  // file that does not compress, so both the deflate and store paths are exercised.
  const tree = path.join(scratch, "tree");
  fs.mkdirSync(path.join(tree, "icons", "dark"), { recursive: true });
  const manifest = JSON.stringify({ name: "fixture", version: "1.0.0" }, null, 2).repeat(20);
  const random = Buffer.alloc(4096);
  for (let i = 0; i < random.length; i += 1) random[i] = (i * 7919 + 13) % 251;
  fs.writeFileSync(path.join(tree, "manifest.json"), manifest);
  fs.writeFileSync(path.join(tree, "icons", "icon-16.png"), random);
  fs.writeFileSync(path.join(tree, "icons", "dark", "icon-16.png"), Buffer.from("tiny"));
  fs.writeFileSync(path.join(tree, "empty.txt"), "");

  const zipPath = path.join(scratch, "fixture.zip");
  writeZip(zipPath, collectEntries(tree, ["manifest.json", "icons", "empty.txt"]));

  // --- Every entry name uses "/", including the nested ones Compress-Archive got wrong. ---
  const entries = readZip(zipPath);
  const names = entries.map((entry) => entry.name);
  assert.deepEqual(names, ["empty.txt", "icons/dark/icon-16.png", "icons/icon-16.png", "manifest.json"],
    "entries must be archive-relative, forward-slashed, and sorted");
  assert.ok(names.every((name) => !name.includes("\\")), "no entry may contain a backslash");

  // --- Round trip: the bytes that come out are the bytes that went in. ---
  const byName = new Map(entries.map((entry) => [entry.name, entry.data]));
  assert.equal(byName.get("manifest.json").toString("utf8"), manifest);
  assert.ok(byName.get("icons/icon-16.png").equals(random), "binary content must survive the store path");
  assert.equal(byName.get("icons/dark/icon-16.png").toString("utf8"), "tiny");
  assert.equal(byName.get("empty.txt").length, 0, "an empty file must round-trip as an empty entry");

  // --- The store-package checks accept this layout and reject the layouts stores reject. ---
  assert.deepEqual(assertStorePackage(zipPath), names);
  assert.throws(() => writeZip(path.join(scratch, "bad.zip"), [{ name: "icons\\icon-16.png", data: Buffer.from("x") }]),
    /must use "\/"/, "the writer must refuse a backslash rather than ship it");
  assert.throws(() => writeZip(path.join(scratch, "bad.zip"), [{ name: "../escape", data: Buffer.from("x") }]),
    /Unsafe/, "the writer must refuse a path that escapes the archive root");
  const wrapped = path.join(scratch, "wrapped.zip");
  writeZip(wrapped, [{ name: "reelless/manifest.json", data: Buffer.from("{}") }]);
  assert.throws(() => assertStorePackage(wrapped), /wrapping directory/, "a wrapping directory must be rejected");

  // --- An independent reader agrees. .NET's ZipFile is what the Chrome build reads back with,
  // and it has no knowledge of this writer. Skipped where PowerShell is not installed. ---
  const probe = spawnSync("powershell", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; $a=[System.IO.Compression.ZipFile]::OpenRead('${zipPath}'); ` +
    "try { $a.Entries | ForEach-Object { $s=$_.Open(); $m=New-Object System.IO.MemoryStream; $s.CopyTo($m); $s.Dispose(); \"$($_.FullName)|$($m.Length)\" } } finally { $a.Dispose() }"
  ], { encoding: "utf8" });
  if (probe.error && probe.error.code === "ENOENT") {
    console.log("(PowerShell not available; skipped the .NET read-back)");
  } else {
    assert.equal(probe.status, 0, `the .NET reader failed to open the archive:\n${probe.stderr}`);
    const seen = probe.stdout.trim().split(/\r?\n/).sort();
    const expected = entries.map((entry) => `${entry.name}|${entry.data.length}`).sort();
    assert.deepEqual(seen, expected, ".NET must read the same names and sizes this writer produced");
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log("ZIP writer forward-slash, round-trip, store-layout, and .NET read-back tests passed.");
