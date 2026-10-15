// omranisystems.com — homepage + access-code gate for every subdomain
require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const apps = require("./apps.json");

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || "127.0.0.1";
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || ".omranisystems.com";
const UNLOCK_MS = Number(process.env.UNLOCK_HOURS || 12) * 3600 * 1000;
const SECRET = process.env.GATE_SECRET;

if (!SECRET || SECRET === "change-me" || SECRET.length < 32) {
  console.error("GATE_SECRET is missing or too short in .env");
  process.exit(1);
}

const appsById = Object.fromEntries(apps.map((a) => [a.id, a]));

// ---------- helpers ----------
const sign = (value) =>
  crypto.createHmac("sha256", SECRET).update(value).digest("hex");

function makeToken(appId) {
  const exp = Date.now() + UNLOCK_MS;
  return `${exp}.${sign(`${appId}.${exp}`)}`;
}

function tokenIsValid(appId, token) {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = sign(`${appId}.${exp}`);
  return (
    sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  );
}

function codeIsValid(appId, code) {
  const stored = process.env[`CODE_${appId.toUpperCase()}`];
  if (!stored || !code) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const attempt = crypto.scryptSync(String(code), salt, 64);
  const expected = Buffer.from(hash, "hex");
  return (
    attempt.length === expected.length &&
    crypto.timingSafeEqual(attempt, expected)
  );
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

const cookieName = (appId) => `os_gate_${appId}`;

// Simple brute-force protection: 5 wrong codes per IP per app, then 15 min lock
const attempts = new Map();
const MAX_TRIES = 5;
const LOCK_MS = 15 * 60 * 1000;

function isLocked(key) {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() > a.until) {
    attempts.delete(key);
    return false;
  }
  return a.count >= MAX_TRIES;
}

function recordFailure(key) {
  const a = attempts.get(key) || { count: 0, until: Date.now() + LOCK_MS };
  a.count += 1;
  a.until = Date.now() + LOCK_MS;
  attempts.set(key, a);
}

// ---------- app ----------
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", "loopback"); // real visitor IP comes from Nginx
app.use(express.json({ limit: "2kb" }));

app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
  });
  next();
});

// List of apps for the homepage (no codes, no secrets)
app.get("/api/apps", (req, res) => {
  res.json(apps.map(({ id, name, url, protected: p }) => ({ id, name, url, protected: p })));
});

// Visitor submits a code from the homepage
app.post("/api/unlock", (req, res) => {
  const { app: appId, code } = req.body || {};
  const target = appsById[appId];
  if (!target) return res.status(404).json({ error: "Unknown app" });

  if (!target.protected) return res.json({ redirect: target.url });

  const key = `${req.ip}:${appId}`;
  if (isLocked(key)) {
    return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
  }

  if (!codeIsValid(appId, code)) {
    recordFailure(key);
    return res.status(401).json({ error: "Wrong code" });
  }

  attempts.delete(key);
  res.cookie(cookieName(appId), makeToken(appId), {
    domain: COOKIE_DOMAIN,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: UNLOCK_MS,
    path: "/",
  });
  res.json({ redirect: target.url });
});

// Called by Nginx (auth_request) before every request to a protected subdomain
app.get("/gate/verify", (req, res) => {
  const appId = String(req.query.app || "");
  const target = appsById[appId];
  if (!target) return res.sendStatus(401);
  if (!target.protected) return res.sendStatus(204);
  return tokenIsValid(appId, readCookie(req, cookieName(appId)))
    ? res.sendStatus(204)
    : res.sendStatus(401);
});

// Static homepage
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

// /unlock?app=pass (used when someone opens a subdomain directly) -> same page
app.get("/unlock", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((req, res) => res.status(404).sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, HOST, () => {
  console.log(`omranisystems.com running on http://${HOST}:${PORT}`);
});
