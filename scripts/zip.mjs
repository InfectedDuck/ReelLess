// Writes the store packages. Windows PowerShell 5.1's Compress-Archive stores nested entries with
// a backslash separator ("icons\icon-16.png"), which the ZIP specification forbids and which
// Mozilla's validator rejects as INVALID_XPI_ENTRY. This writer emits forward slashes on every
// platform, needs no dependency, and reads the archive back so a build can assert on what it shipped.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// MS-DOS date and time fields, which is all the ZIP format has for timestamps.
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

// Walks the paths to package, returning entries whose names are archive-relative and use "/".
export function collectEntries(root, items) {
  const entries = [];
  const visit = (absolute, relative) => {
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(absolute).sort()) visit(path.join(absolute, child), `${relative}/${child}`);
      return;
    }
    entries.push({ name: relative.split(path.sep).join("/"), data: fs.readFileSync(absolute), mtime: stat.mtime });
  };
  for (const item of items) {
    const absolute = path.join(root, item);
    if (!fs.existsSync(absolute)) throw new Error(`Missing packaged file: ${item}`);
    visit(absolute, item.split(path.sep).join("/"));
  }
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function writeZip(zipPath, entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    if (entry.name.includes("\\")) throw new Error(`ZIP entry names must use "/": ${entry.name}`);
    if (entry.name.startsWith("/") || entry.name.split("/").includes("..")) throw new Error(`Unsafe ZIP entry name: ${entry.name}`);
    const name = Buffer.from(entry.name, "utf8");
    const deflated = zlib.deflateRawSync(entry.data, { level: 9 });
    const stored = deflated.length >= entry.data.length;
    const body = stored ? entry.data : deflated;
    const method = stored ? 0 : 8;
    const crc = crc32(entry.data);
    const { time, day } = dosDateTime(entry.mtime || new Date());

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed to extract: 2.0
    local.writeUInt16LE(0x0800, 6);        // general purpose flags: names are UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);          // version made by: 2.0, MS-DOS attributes
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);          // extra field length
    central.writeUInt16LE(0, 32);          // comment length
    central.writeUInt16LE(0, 34);          // disk number start
    central.writeUInt16LE(0, 36);          // internal attributes
    central.writeUInt32LE(0, 38);          // external attributes
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  fs.writeFileSync(zipPath, Buffer.concat([...locals, directory, end]));
}

// Reads an archive's central directory and inflates every entry, so a build can verify the file
// it just wrote rather than the list it meant to write.
export function readZip(zipPath) {
  const buffer = fs.readFileSync(zipPath);
  let endOffset = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { endOffset = i; break; }
  }
  if (endOffset < 0) throw new Error(`${zipPath} has no end-of-central-directory record`);
  const count = buffer.readUInt16LE(endOffset + 10);
  let cursor = buffer.readUInt32LE(endOffset + 16);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error(`${zipPath}: corrupt central directory`);
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const body = buffer.subarray(start, start + compressedSize);
    const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    if (data.length !== size || crc32(data) !== crc) throw new Error(`${zipPath}: ${name} is corrupt`);
    entries.push({ name, data });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

// The root-level checks both store packages share. Throws with the reason a store would reject it.
export function assertStorePackage(zipPath) {
  const names = readZip(zipPath).map((entry) => entry.name);
  if (names.some((name) => name.includes("\\"))) throw new Error(`${zipPath} stores entries with backslashes`);
  if (names.some((name) => /^[^/]+\/manifest\.json$/.test(name))) throw new Error(`${zipPath} contains a wrapping directory`);
  if (!names.includes("manifest.json")) throw new Error(`${zipPath}: manifest.json is not at the ZIP root`);
  if (names.some((name) => /(^|\/)(node_modules|scripts|store-assets|docs)\//.test(name))) throw new Error(`${zipPath}: development files leaked into the package`);
  return names;
}

// CLI form for the PowerShell build: node scripts/zip.mjs <zip> <root> <item> [<item> ...]
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1"))) {
  const [zipPath, root, ...items] = process.argv.slice(2);
  if (!zipPath || !root || items.length === 0) {
    console.error("usage: node scripts/zip.mjs <zip> <root> <item> [<item> ...]");
    process.exit(2);
  }
  writeZip(zipPath, collectEntries(root, items));
  const names = assertStorePackage(zipPath);
  console.log(`Wrote ${zipPath} with ${names.length} entries`);
}
