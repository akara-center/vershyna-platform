"use strict";

const assert = require("node:assert/strict");
const { createHash, generateKeyPairSync, sign } = require("node:crypto");
const { test } = require("node:test");
const { once } = require("node:events");
const { createServer } = require("../server/start.cjs");
const { openWorkspaces } = require("../server/workspaces.cjs");

test("Google sign-in binds a verified coach identity and rejects replay or an unrelated account", async (t) => {
  const db = openWorkspaces(":memory:");
  const origin = "https://vershyna.example";
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), alg: "RS256", kid: "test-signing-key", use: "sig" };
  let google;
  let identity;
  let badSignature = false;
  const server = createServer(db, origin, undefined, {
    clientId: "test-client", clientSecret: "test-secret", coachEmail: "owner@gmail.com",
    request: async (url, options) => {
      if (url.endsWith("/certs")) return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=60" } });
      assert.equal(url, "https://oauth2.googleapis.com/token");
      assert.equal(options.body.get("redirect_uri"), origin + "/auth/google/callback");
      assert.equal(createHash("sha256").update(options.body.get("code_verifier")).digest("base64url"),
        google.searchParams.get("code_challenge"));
      const encoded = (data) => Buffer.from(JSON.stringify(data)).toString("base64url");
      const payload = encoded({ alg: "RS256", kid: jwk.kid }) + "." + encoded({
        iss: "https://accounts.google.com", aud: "test-client", exp: Date.now() / 1000 + 60,
        nonce: google.searchParams.get("nonce"), email_verified: true, ...identity,
      });
      const signature = sign("RSA-SHA256", Buffer.from(payload), privateKey).toString("base64url");
      return Response.json({ id_token: payload + "." + (badSignature ? "invalid" : signature) });
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.close(); db.close(); });
  const base = "http://127.0.0.1:" + server.address().port;
  const call = (path, cookie) => fetch(base + path, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });
  const login = async (email, sub) => {
    identity = { email, sub };
    const start = await call("/auth/google");
    google = new URL(start.headers.get("location"));
    assert.equal(google.searchParams.get("scope"), "openid email");
    const cookie = start.headers.getSetCookie()[0].split(";")[0];
    const callback = "/auth/google/callback?code=test&state=" + google.searchParams.get("state");
    return { response: await call(callback, cookie), callback, cookie };
  };

  assert.match(await (await call("/account")).text(), /id="google-login" class=/);
  const owner = await login("owner@gmail.com", "coach-subject");
  assert.equal(owner.response.headers.get("location"), "/tracker");
  const session = owner.response.headers.getSetCookie().find((entry) => entry.startsWith("vershyna_session=")).split(";")[0];
  const profile = await (await call("/api/coach/profile", session)).json();
  assert.equal(profile.role, "coach");
  assert.equal(profile.email, "owner@gmail.com");
  assert.equal((await call("/", session)).headers.get("location"), "/tracker");
  for (const [path, link] of [["/tracker", "/coach"], ["/coach", "/tracker"]]) {
    const page = await call(path, session);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("cache-control"), /private, no-store/);
    const html = await page.text();
    assert.match(html, /Ви увійшли як <strong>owner@gmail.com<\/strong>/);
    assert.match(html, new RegExp('href="' + link + '"'));
    assert.match(html, /data-session-logout/);
    assert.match(html, /<script src="\/session\.js" defer>/);
    assert.equal((await call(path)).headers.get("location"), "/account");
  }
  const logout = (account) => fetch(base + "/api/session", {
    method: "DELETE", headers: { Cookie: session, Origin: origin, "X-Vershyna-Account": account },
  });
  assert.equal((await logout("another-account")).status, 401);
  assert.equal((await call("/tracker", session)).status, 200);
  assert.equal((await logout(profile.account)).status, 200);
  assert.equal((await call("/tracker", session)).headers.get("location"), "/account");
  assert.equal((await call(owner.callback, owner.cookie)).headers.get("location"), "/account?login=failed");
  assert.equal((await login("guest@gmail.com", "other-subject")).response.headers.get("location"), "/account?login=unavailable");
  assert.equal((await login("owner@gmail.com", "other-subject")).response.headers.get("location"), "/account?login=unavailable");
  assert.equal((await login("owner@gmail.com", "coach-subject")).response.headers.get("location"), "/tracker");

  badSignature = true;
  assert.equal((await login("owner@gmail.com", "coach-subject")).response.headers.get("location"), "/account?login=failed");
  assert.equal(db.prepare("SELECT count(*) AS count FROM workspace_accounts").get().count, 1);
});
