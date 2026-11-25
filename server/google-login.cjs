"use strict";

const { createHash, createPublicKey, randomBytes, verify } = require("node:crypto");

const randomToken = () => randomBytes(32).toString("base64url");
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const attemptCookie = "vershyna_google_state";
const attemptLifetime = 600;

function setupGoogleLogin(db, origin, options = {}) {
  const { clientId, clientSecret, registerClients = false, request = fetch } = options;
  const coachEmail = options.coachEmail?.trim().toLowerCase();
  const enabled = Boolean(clientId && clientSecret && (coachEmail || registerClients));
  let keys = [];
  let refreshKeysAt = 0;
  const redirectUri = origin + "/auth/google/callback";
  const cookie = (value, age) => `${attemptCookie}=${value}; Path=/auth/google; HttpOnly; SameSite=Lax; Max-Age=${age}${origin.startsWith("https:") ? "; Secure" : ""}`;

  function redirect(res, location, cookies = []) {
    res.writeHead(303, { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Set-Cookie": cookies }).end();
  }

  async function verifiedClaims(idToken) {
    const parts = idToken?.split(".");
    if (parts?.length !== 3 || !parts[2]) throw Error("Missing ID token");
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (header.alg !== "RS256" || typeof header.kid !== "string") throw Error("Unexpected signing algorithm");
    if (Date.now() >= refreshKeysAt) {
      const response = await request("https://www.googleapis.com/oauth2/v3/certs", {
        redirect: "error", signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw Error("Google signing keys unavailable");
      keys = (await response.json()).keys;
      const age = Number(response.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1] ?? 0);
      refreshKeysAt = Date.now() + Math.min(age, 3600) * 1000;
    }
    const jwk = keys.find((key) => key.kid === header.kid && key.kty === "RSA" && key.alg === "RS256" && key.use === "sig");
    if (!jwk || !verify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]),
      createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"))) throw Error("Invalid signature");
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  }

  return {
    enabled,
    async handle(req, res, url, identify, signIn) {
      if (!enabled || req.method !== "GET") {
        res.writeHead(404, { "Cache-Control": "no-store" }).end();
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      try {
        if (url.pathname === "/auth/google") {
          const state = randomToken();
          const verifier = randomToken();
          const nonce = randomToken();
          db.prepare("DELETE FROM google_login_attempts WHERE expires <= ?").run(now);
          db.prepare("INSERT INTO google_login_attempts VALUES (?, ?, ?, ?)").run(
            createHash("sha256").update(state).digest("hex"), verifier, nonce, now + attemptLifetime);
          const params = new URLSearchParams({
            client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email",
            state, nonce, code_challenge_method: "S256",
            code_challenge: createHash("sha256").update(verifier).digest("base64url"),
            prompt: "select_account",
          });
          redirect(res, "https://accounts.google.com/o/oauth2/v2/auth?" + params, [cookie(state, attemptLifetime)]);
          return;
        }

        const state = url.searchParams.get("state") || "";
        const browserState = (req.headers.cookie || "").split(/;\s*/).find((item) => item.startsWith(attemptCookie + "="))?.slice(attemptCookie.length + 1);
        if (!tokenPattern.test(state) || state !== browserState) throw Error("Invalid state");
        const attempt = db.prepare("DELETE FROM google_login_attempts WHERE digest = ? AND expires > ? RETURNING verifier, nonce")
          .get(createHash("sha256").update(state).digest("hex"), now);
        const code = url.searchParams.get("code");
        if (!attempt || !code) throw Error("Invalid attempt");

        const response = await request("https://oauth2.googleapis.com/token", {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
          body: new URLSearchParams({
            code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri,
            grant_type: "authorization_code", code_verifier: attempt.verifier,
          }),
        });
        if (!response.ok) throw Error("Token exchange failed");

        const claims = await verifiedClaims((await response.json()).id_token);
        if (!["https://accounts.google.com", "accounts.google.com"].includes(claims.iss) ||
            claims.aud !== clientId || (claims.azp && claims.azp !== clientId) ||
            !Number.isFinite(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000) ||
            claims.nonce !== attempt.nonce || typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255 ||
            claims.email_verified !== true || typeof claims.email !== "string") throw Error("Invalid Google identity");

        const email = claims.email.toLowerCase();
        const isCoach = email === coachEmail && (email.endsWith("@gmail.com") || claims.hd === email.split("@").at(-1));
        const account = identify(claims.sub, isCoach, registerClients);
        if (!account) {
          redirect(res, "/account?login=unavailable", [cookie("", 0)]);
          return;
        }
        redirect(res, "/tracker", [cookie("", 0), signIn(account.id, email)]);
      } catch {
        redirect(res, "/account?login=failed", [cookie("", 0)]);
      }
    },
  };
}

module.exports = { setupGoogleLogin };
