// Phase 14 Part Z — save compression (gzip).
//
// Text-heavy JSON (state / memory / canon / snapshots / backups) compresses
// very well with standard gzip — no tuning needed. Used by the periodic
// snapshots (Phase 13 V8) and the backup export. Helpers are sync (the callers
// already do sync file IO) and tolerate reading either a .gz or a plain file.

"use strict";

const fs = require("fs");
const zlib = require("zlib");

function writeJsonGz(filePath, obj) {
  const buf = zlib.gzipSync(Buffer.from(JSON.stringify(obj), "utf8"));
  fs.writeFileSync(filePath, buf);
  return filePath;
}

function readJsonGz(filePath) {
  const raw = fs.readFileSync(filePath);
  // Gzip magic bytes 0x1f 0x8b — fall back to plain JSON if not compressed.
  const text = raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw).toString("utf8") : raw.toString("utf8");
  return JSON.parse(text);
}

function gzipString(str) {
  return zlib.gzipSync(Buffer.from(String(str), "utf8"));
}

module.exports = { writeJsonGz, readJsonGz, gzipString };
