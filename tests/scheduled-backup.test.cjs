"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { copyToBucket } = require("../server/scheduled-backup.cjs");
const { openWorkspaces, provision } = require("../server/workspaces.cjs");

test("daily SQLite backup uploads a restorable snapshot and skips a completed day", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "vershyna-backup-test-"));
  const dbPath = path.join(dir, "source.sqlite");
  const db = openWorkspaces(dbPath);
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  provision(db, "test-coach", "coach");
  let storedDate;
  let saved;
  const s3 = {
    async fetch(url, { method, headers, body }) {
      assert.equal(url.pathname, "/daily/day-01.sqlite");
      if (method === "HEAD") return storedDate
        ? new Response(null, { status: 200, headers: { "x-amz-meta-backup-date": storedDate } })
        : new Response(null, { status: 404 });
      assert.equal(method, "PUT");
      storedDate = headers["X-Amz-Meta-Backup-Date"];
      saved = Buffer.from(await body.arrayBuffer());
      assert.equal(createHash("sha256").update(saved).digest("hex"), headers["X-Amz-Content-Sha256"]);
      return new Response(null, { status: 200 });
    },
  };
  const url = new URL("https://bucket.example/daily/day-01.sqlite");
  assert.equal(await copyToBucket(url, "2026-11-25", s3, dbPath), true);
  assert.equal(await copyToBucket(url, "2026-11-25", s3, dbPath), false);
  const restoredPath = path.join(dir, "restored.sqlite");
  await writeFile(restoredPath, saved, { mode: 0o600 });
  const restored = openWorkspaces(restoredPath);
  try {
    assert.equal(restored.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.equal(restored.prepare("SELECT account_id FROM coach_roles").get().account_id, "test-coach");
  } finally {
    restored.close();
  }
});
