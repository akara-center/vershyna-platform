"use strict";

const { execFile } = require("node:child_process");
const { createHash } = require("node:crypto");
const { createReadStream, openAsBlob } = require("node:fs");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const run = promisify(execFile);
const dayMs = 86400000;
const retentionDays = 14;
const checkInterval = 15 * 60000;

async function copyToBucket(url, date, s3, dbPath) {
  const head = await s3.fetch(url, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(15000) });
  if (head.ok && head.headers.get("x-amz-meta-backup-date") === date) return false;
  if (!head.ok && head.status !== 404) throw Error("перевірка сховища: HTTP " + head.status);

  const folder = await mkdtemp(path.join(tmpdir(), "vershyna-backup-"));
  try {
    const file = path.join(folder, "vershyna.sqlite");
    await run(process.execPath, [path.join(__dirname, "start.cjs"), "backup", file], {
      timeout: 120000, env: { ...process.env, VERSHYNA_DB: dbPath },
    });
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    const saved = await s3.fetch(url, {
      method: "PUT", redirect: "error", signal: AbortSignal.timeout(120000),
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "X-Amz-Content-Sha256": hash.digest("hex"),
        "X-Amz-Meta-Backup-Date": date,
      },
      body: await openAsBlob(file),
    });
    if (!saved.ok) {
      await saved.body?.cancel();
      throw Error("завантаження копії: HTTP " + saved.status);
    }
    await saved.body?.cancel();
    return true;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

function scheduleBackups(server, dbPath, env = process.env) {
  const endpoint = env.VERSHYNA_BACKUP_ENDPOINT;
  if (!endpoint) return;
  const { VERSHYNA_BACKUP_BUCKET: bucket, VERSHYNA_BACKUP_ACCESS_KEY_ID: accessKeyId,
    VERSHYNA_BACKUP_SECRET_ACCESS_KEY: secretAccessKey, VERSHYNA_BACKUP_REGION: region = "auto" } = env;
  let base;
  let s3;
  try {
    base = new URL(endpoint);
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash ||
      base.pathname !== "/" || !/^[a-z0-9][a-z0-9-]+[a-z0-9]$/.test(bucket ?? "") ||
      !accessKeyId || !secretAccessKey || dbPath === ":memory:") throw Error("Invalid backup settings");
    if (env.VERSHYNA_BACKUP_URL_STYLE === "path") base.pathname = "/" + bucket + "/";
    else base.hostname = bucket + "." + base.hostname;
    const { AwsClient } = require("aws4fetch");
    s3 = new AwsClient({ accessKeyId, secretAccessKey, region, service: "s3", retries: 0 });
  } catch {
    console.error("Резервні копії: перевір налаштування сховища або встанови залежності сервера.");
    return;
  }

  let busy = false;
  let completed = -1;
  let retryAt = 0;
  async function check() {
    const now = Date.now();
    const day = Math.floor(now / dayMs);
    if (busy || completed === day || now < retryAt) return;
    busy = true;
    try {
      const date = new Date(now).toISOString().slice(0, 10);
      const slot = String((day % retentionDays) + 1).padStart(2, "0");
      const url = new URL("daily/day-" + slot + ".sqlite", base);
      const uploaded = await copyToBucket(url, date, s3, dbPath);
      if (uploaded) console.info("Резервну копію Вершини збережено: " + date + " · daily/day-" + slot + ".sqlite");
      completed = day;
    } catch (error) {
      retryAt = Date.now() + checkInterval;
      const status = /HTTP (\d{3})$/.exec(error?.message || "")?.[1];
      console.error("Не вдалося зберегти резервну копію Вершини." + (status ? " HTTP " + status : ""));
    } finally {
      busy = false;
    }
  }
  server.once("listening", () => void check());
  server.on("request", () => void check());
  const timer = setInterval(check, checkInterval);
  timer.unref();
  server.once("close", () => clearInterval(timer));
}

module.exports = { copyToBucket, scheduleBackups };
