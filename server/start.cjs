"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { openWorkspaces, provision, workspaceApi } = require("./workspaces.cjs");

const dist = path.resolve(__dirname, "../dist");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png",
  ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

function createServer(db, origin) {
  const api = workspaceApi(db, origin);
  return http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname.startsWith("/api/")) return void api(req, res, pathname);
    if (req.method !== "GET" && req.method !== "HEAD") return void res.writeHead(405).end();
    const accountFiles = { "/account": "account.html", "/account.js": "account.js" };
    const accountFile = Object.hasOwn(accountFiles, pathname) && accountFiles[pathname];
    const name = pathname === "/" ? "index.html" : pathname.slice(1);
    if (!accountFile && !/^[a-zA-Z0-9_-]+\.[a-z]+$/.test(name)) return void res.writeHead(404).end();
    const file = accountFile ? path.join(__dirname, accountFile) : path.join(dist, name);
    const type = mime[path.extname(file)];
    if (!type || !fs.existsSync(file)) return void res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache" });
    if (req.method === "HEAD") return void res.end();
    fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
  });
}

if (require.main === module) {
  const dbPath = process.env.VERSHYNA_DB || path.resolve("var/vershyna.sqlite");
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = openWorkspaces(dbPath);
  if (process.argv[2] === "provision") {
    console.log(provision(db, process.argv[3] || ""));
    db.close();
  } else {
    const port = Number(process.env.VERSHYNA_PORT || 8787);
    const origin = new URL(process.env.VERSHYNA_ORIGIN || `http://127.0.0.1:${port}`).origin;
    createServer(db, origin).listen(port, "127.0.0.1", () => console.log(`Вершина: ${origin}/account`));
  }
}

module.exports = { createServer };
