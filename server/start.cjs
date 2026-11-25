"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { openWorkspaces, provision, workspaceApi, activeAccount, snapshot, configureCoach, startSession, identifyGoogleAccount } = require("./workspaces.cjs");

const { scheduleBackups } = require("./scheduled-backup.cjs");
const { setupGoogleLogin } = require("./google-login.cjs");
const { setupCalendar } = require("./calendar-account.cjs");

const dist = path.resolve(__dirname, "../dist");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png",
  ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

function createServer(db, origin, calendarOptions, googleOptions) {
  const coach = configureCoach(db);
  const calendar = setupCalendar(db, origin, calendarOptions, coach);
  const google = setupGoogleLogin(db, origin, googleOptions);
  const api = workspaceApi(db, origin, calendar.api, coach);
  const server = http.createServer({ requestTimeout: 20000 }, (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const { pathname } = url;
    if (pathname === "/auth/google" || pathname === "/auth/google/callback")
      return void google.handle(req, res, url,
        (...args) => identifyGoogleAccount(db, coach, ...args), (id) => startSession(db, origin, req, id));
    if (pathname === "/healthz" && req.method === "GET") return void res.writeHead(200, { "Cache-Control": "no-store" }).end("ok");
    if (pathname.startsWith("/api/")) return void api(req, res, pathname);
    if (req.method !== "GET" && req.method !== "HEAD") return void res.writeHead(405).end();
    if (pathname === "/" || pathname === "/index.html") return void res.writeHead(302, { Location: "/tracker" }).end();
    if (pathname === "/tracker") {
      const account = activeAccount(db, req);
      if (!account || coach.suspended(account.id)) return void res.writeHead(302, { Location: "/account", "Cache-Control": "no-store" }).end();
      if (coach.role(account.id) === "coach") return void res.writeHead(302, { Location: "/coach", "Cache-Control": "no-store" }).end();
      const data = JSON.stringify(snapshot(account)).replace(/</g, "\\u003c");
      const html = fs.readFileSync(path.join(dist, "index.html"), "utf8")
        .replace('<script src="./state.js?', () => `<script type="application/json" id="workspace-data">${data}</script><script src="/workspace.js"></script><script src="./state.js?`)
        .replace('<a href="./collaboration.html">Демо кабінету коуча</a>', '<a href="/coach">Спільний трекер</a> <a href="/account">Мій акаунт</a>')
        .replace('<nav id="pilot-nav"', '<div class="workspace-status pilot-actions"><a href="/account">Мій акаунт</a><span id="workspace-status" role="status"></span><button type="button" id="workspace-review" hidden>Звірити зміни</button></div><nav id="pilot-nav"');
      res.writeHead(200, { "Content-Type": mime[".html"], "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
      return void res.end(req.method === "GET" ? html : undefined);
    }
    const accountFiles = { "/account": "account.html", "/account.js": "account.js", "/workspace.js": "workspace.js", "/coach": "coach.html", "/coach.js": "coach.js" };
    const accountFile = Object.hasOwn(accountFiles, pathname) && accountFiles[pathname];
    const name = pathname.slice(1);
    if (!accountFile && !/^[a-zA-Z0-9_-]+\.[a-z]+$/.test(name)) return void res.writeHead(404).end();
    const file = accountFile ? path.join(__dirname, accountFile) : path.join(dist, name);
    const type = mime[path.extname(file)];
    if (!type || !fs.existsSync(file)) return void res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache" });
    if (req.method === "HEAD") return void res.end();
    if (pathname === "/account" && google.enabled) {
      const html = fs.readFileSync(file, "utf8").replace('id="google-login" hidden', 'id="google-login"');
      return void res.end(html);
    }
    fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
  });
  if (calendar.enabled) {
    let syncing = false;
    const timer = setInterval(async () => {
      if (syncing) return;
      syncing = true;
      try { await calendar.background(); }
      catch { console.warn("Не вдалося виконати фонову звірку Google Calendar."); }
      finally { syncing = false; }
    }, 60000);
    timer.unref();
    server.once("close", () => clearInterval(timer));
  }
  return server;
}

if (require.main === module) {
  process.umask(0o077);
  const dbPath = process.env.VERSHYNA_DB || path.resolve("var/vershyna.sqlite");
  if (process.env.RAILWAY_SERVICE_ID &&
      (process.env.RAILWAY_VOLUME_MOUNT_PATH !== "/data" || path.dirname(dbPath) !== "/data")) {
    throw Error("На Railway база має бути в постійному томі /data.");
  }
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = openWorkspaces(dbPath);
  if (process.argv[2] === "backup") {
    const destination = process.argv[3];
    if (!destination || fs.existsSync(destination)) throw Error("Вкажи шлях до нового файлу резервної копії.");
    db.prepare("VACUUM INTO ?").run(path.resolve(destination));
    db.close();
  } else if (["provision", "rotate-key"].includes(process.argv[2])) {
    console.log(provision(db, process.argv[3] || "", process.argv[4], process.argv[2] === "rotate-key"));
    db.close();
  } else {
    const port = Number(process.env.VERSHYNA_PORT || process.env.PORT || 8787);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("Некоректний порт.");
    const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
    const publicOrigin = process.env.VERSHYNA_ORIGIN || (publicDomain && `https://${publicDomain}`);
    const origin = new URL(publicOrigin || `http://127.0.0.1:${port}`).origin;
    if (process.env.RAILWAY_SERVICE_ID && !origin.startsWith("https://")) {
      throw Error("Додай публічний HTTPS-домен Railway або задай VERSHYNA_ORIGIN.");
    }
    const calendarOptions = { clientId: process.env.VERSHYNA_GOOGLE_CLIENT_ID,
      clientSecret: process.env.VERSHYNA_GOOGLE_CLIENT_SECRET, encryptionKey: process.env.VERSHYNA_GOOGLE_TOKEN_KEY };
    const googleOptions = {
      clientId: process.env.VERSHYNA_LOGIN_GOOGLE_CLIENT_ID,
      clientSecret: process.env.VERSHYNA_LOGIN_GOOGLE_CLIENT_SECRET,
      coachEmail: process.env.VERSHYNA_LOGIN_COACH_EMAIL,
      registerClients: process.env.VERSHYNA_LOGIN_GOOGLE_REGISTER_CLIENTS === "1",
    };
    const server = createServer(db, origin, calendarOptions, googleOptions);
    scheduleBackups(server, dbPath);
    server.listen(port, process.env.VERSHYNA_HOST || "127.0.0.1", () => console.log(`Вершина: ${origin}/account`));
  }
}

module.exports = { createServer };
