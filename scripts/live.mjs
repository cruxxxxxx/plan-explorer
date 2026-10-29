#!/usr/bin/env node
// Plan Explorer live server: serves a plan folder (just plan.js) with the skill's engine,
// and relays notes between the page and any coding agent. No dependencies.
// Protocol: reference/live.md
//
//   node live.mjs <dir> [--exec "<agent cmd>"]   start or reuse the server, print the URL, then stream notes
//   node live.mjs reply <dir> <noteId> [--status working|done] [text | -]
//   node live.mjs replies <dir> [--status working] -   answer several notes (stdin: "--- <noteId>" blocks or JSON)
//   node live.mjs log <dir> "what changed"        optional: one changelog entry for the current round
//   node live.mjs status <dir>
//   node live.mjs stop <dir>
//   node live.mjs serve <dir> [--port N]         the server itself, in the foreground
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
// PLAN_EXPLORER_ENGINE overrides the engine (tests inject a harness this way).
const ENGINE = process.env.PLAN_EXPLORER_ENGINE || path.join(path.dirname(SELF), "..", "engine", "explorer.html");
const USAGE = `usage:
  node live.mjs <dir> [--exec "<agent cmd>"]
  node live.mjs reply  <dir> <noteId> [--status working|done] [text | -]
  node live.mjs replies <dir> [--status working] -   (stdin: "--- <noteId>" then the text, repeated; or {"<noteId>": "text"})
  node live.mjs log    <dir> "what changed"
  node live.mjs status <dir>
  node live.mjs stop   <dir>
  node live.mjs serve  <dir> [--port N]`;
const COMMANDS = ["serve", "listen", "reply", "replies", "log", "status", "stop"];
const argv = process.argv.slice(2);
const cmd = COMMANDS.includes(argv[0]) ? argv.shift() : "open";
const dirArg = argv.shift();
const rest = argv;
if (!dirArg) {
  console.error(USAGE);
  process.exit(2);
}
const DIR = path.resolve(dirArg);
const LIVE = path.join(DIR, ".live");
const F = {
  server: path.join(LIVE, "server.json"),
  log: path.join(LIVE, "server.log"),
  asks: path.join(LIVE, "asks.jsonl"),
  answers: path.join(LIVE, "answers.json"),
  notes: path.join(LIVE, "notes.json"),
  notesRaw: path.join(LIVE, "notes-raw.json"),
  deleted: path.join(LIVE, "deleted.json"),
  lock: path.join(LIVE, "spawn.lock"),
  listener: path.join(LIVE, "listener.json"),
  revs: path.join(LIVE, "revs.json"),
  changelog: path.join(LIVE, "changelog.json"),
  plan: path.join(DIR, "plan.js")
};
const LISTENER_FRESH_MS = 15000;
// Notes saved within this window reach the agent as one line (one Monitor event, one turn).
const BATCH_MS = Number(process.env.PLAN_EXPLORER_BATCH_MS || 2000);
// Edits more than this far apart start a new round: a new version, and a fresh set of "Changed" tags.
const ROUND_GAP_MS = Number(process.env.PLAN_EXPLORER_ROUND_GAP_MS || 30 * 60 * 1000);
// Note events carry at most this much of the element's text.
const TARGET_CHARS = 200;
// A server with no open page and no listener for this long shuts itself down.
const IDLE_MS = 6 * 60 * 60 * 1000;
// Single-quote for POSIX shells: the agent runs the reply command as given.
const shq = v => `'${String(v).replace(/'/g, "'\\''")}'`;
const NOTE_ID = /^[A-Za-z0-9_-]{1,64}$/;
// A running server is replaced when this script or the engine changes.
const codeStamp = () => [SELF, ENGINE].map(f => {
  try {
    return fs.statSync(f).mtimeMs;
  } catch (e) {
    return 0;
  }
}).join(":");

function flag(name, fallback) {
  const i = rest.indexOf(name);
  if (i < 0) {
    return fallback;
  }
  const v = rest[i + 1];
  rest.splice(i, 2);
  return v;
}
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return fallback;
  }
};
function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function ensureLiveDir() {
  fs.mkdirSync(LIVE, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(LIVE, ".gitignore"), "*\n");
}
const log = obj => process.stdout.write(JSON.stringify(obj) + "\n");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pidAlive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
};

function readAsks() {
  try {
    return fs.readFileSync(F.asks, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
  } catch (e) {
    return [];
  }
}
// The newest ask per note that has no "done" answer after it.
function pendingAsks() {
  const answers = readJson(F.answers, {});
  const latest = new Map();
  for (const a of readAsks()) {
    latest.set(a.noteId, a);
  }
  return [...latest.values()].filter(a => {
    const ans = answers[a.noteId];
    return !ans || ans.status !== "done" || ans.at < a.at;
  });
}
function listenerState() {
  const l = readJson(F.listener, null);
  if (!l || !l.pid || Date.now() - l.beat > LISTENER_FRESH_MS || !pidAlive(l.pid)) {
    return null;
  }
  return l;
}
// A stable port per plan folder, so the URL can be bookmarked.
function preferredPort() {
  const h = crypto.createHash("sha1").update(DIR).digest().readUInt16BE(0);
  return 47100 + (h % 800);
}

// ── bookkeeping: version, updated and "Changed" tags without the agent ──
// Runs plan.js in an empty context and returns window.PLAN (null if it doesn't run yet, e.g. mid-write).
function evalPlan(src) {
  try {
    const ctx = { window: {} };
    vm.runInNewContext(src, ctx, { filename: F.plan, timeout: 1000 });
    const plan = ctx.window.PLAN;
    return plan && typeof plan === "object" ? plan : null;
  } catch (e) {
    return null;
  }
}
const BOOKKEEPING = new Set(["rev", "version", "updated", "changelog", "replies"]);
const digest = v => crypto.createHash("sha1").update(JSON.stringify(v, (k, x) => (BOOKKEEPING.has(k) ? undefined : x)) ?? "").digest("base64url").slice(0, 16);
const without = (o, keys) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !keys.includes(k)));
// One fingerprint per item the page can tag, keyed like the engine's nids (areas/<a>/flows/<f>, api/<t>/m/<m>, …).
// Containers are hashed without their children, so a changed flow doesn't tag its whole area.
const AREA_KIDS = { flows: "flows", issues: "issues", work: "work", sections: "sections", options: "options", openQuestions: "questions" };
function fingerprints(plan) {
  const out = {};
  const list = v => (Array.isArray(v) ? v.filter(x => x && typeof x === "object" && x.id != null) : []);
  out.plan = digest(without(plan, ["areas", "api", "roadmap"]));
  for (const a of list(plan.areas)) {
    out[`areas/${a.id}`] = digest(without(a, Object.keys(AREA_KIDS)));
    for (const [field, seg] of Object.entries(AREA_KIDS)) {
      for (const o of list(a[field])) {
        out[`areas/${a.id}/${seg}/${o.id}`] = digest(o);
      }
    }
  }
  const api = plan.api && typeof plan.api === "object" ? plan.api : {};
  out.api = digest(without(api, ["types"]));
  for (const t of list(api.types)) {
    out[`api/${t.id}`] = digest(without(t, ["members"]));
    for (const m of list(t.members)) {
      out[`api/${t.id}/m/${m.id}`] = digest(m);
    }
  }
  for (const r of list(plan.roadmap)) {
    out[`roadmap/${r.id}`] = digest(r);
  }
  return out;
}
const today = (t = Date.now()) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
// Diffs the plan against the last snapshot (.live/revs.json). The first snapshot is the baseline: nothing is tagged.
// A change after a quiet gap of ROUND_GAP_MS opens a new round (version + 1); a higher plan.version set by hand wins.
function trackRevisions(plan, prev, now = Date.now()) {
  const hashes = fingerprints(plan);
  const own = Number.isFinite(Number(plan.version)) ? Number(plan.version) : 0;
  if (!prev || !prev.hashes) {
    return { hashes, revs: {}, round: Math.max(own, 1), lastChange: 0, updated: null };
  }
  const changed = Object.keys(hashes).filter(k => hashes[k] !== prev.hashes[k]);
  const gone = Object.keys(prev.hashes).filter(k => !(k in hashes));
  if (!changed.length && !gone.length) {
    return own > prev.round ? { ...prev, round: own } : prev;
  }
  const fresh = !prev.lastChange || now - prev.lastChange > ROUND_GAP_MS;
  const round = Math.max(fresh ? prev.round + 1 : prev.round, own);
  const revs = { ...prev.revs };
  for (const k of gone) {
    delete revs[k];
  }
  for (const k of changed) {
    revs[k] = round;
  }
  return { hashes, revs, round, lastChange: now, updated: today(now) };
}
// What the page needs, appended to the served plan.js as window.PLAN_AUTO.
function autoInfo(state) {
  if (!state) {
    return null;
  }
  return { version: state.round, updated: state.updated, changed: Object.keys(state.revs).filter(k => state.revs[k] === state.round) };
}

// ── serve ───────────────────────────────────────────────────────────────
function serve() {
  if (!fs.existsSync(F.plan)) {
    console.error(`✗ no plan.js in ${DIR}`);
    process.exit(1);
  }
  ensureLiveDir();
  const prev = readJson(F.server, {});
  const wantPort = Number(flag("--port", prev.port || preferredPort()));
  const token = prev.token || crypto.randomBytes(24).toString("base64url");
  const stamp = codeStamp();
  const clients = new Set();
  let port = 0;

  const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const broadcast = (event, data) => {
    for (const res of clients) {
      send(res, event, data);
    }
  };
  const statusNow = () => {
    const l = listenerState();
    return { agent: l ? l.mode : "offline", pending: pendingAsks().map(a => a.noteId) };
  };
  let lastStatus = "";
  const pushStatus = () => {
    const s = JSON.stringify(statusNow());
    if (s !== lastStatus) {
      lastStatus = s;
      broadcast("status", JSON.parse(s));
    }
  };
  setInterval(pushStatus, 2000).unref();

  function saveAnswer(noteId, status, text, by) {
    const answers = readJson(F.answers, {});
    const prevAns = answers[noteId] || {};
    answers[noteId] = { text: text ?? prevAns.text ?? "", status, at: Date.now(), by: by || prevAns.by || "agent" };
    writeJson(F.answers, answers);
    broadcast("answer", { noteId, ...answers[noteId] });
    pushStatus();
    return answers[noteId];
  }

  // Bookkeeping state, recomputed whenever plan.js has new content that runs.
  let revState = readJson(F.revs, null);
  let revSource = null;
  function refreshRevisions() {
    let src;
    try {
      src = fs.readFileSync(F.plan, "utf8");
    } catch (e) {
      return;
    }
    if (src === revSource) {
      return;
    }
    const plan = evalPlan(src);
    if (!plan) {
      return;
    }
    revSource = src;
    const next = trackRevisions(plan, revState);
    if (next !== revState) {
      revState = next;
      writeJson(F.revs, revState);
    }
  }
  refreshRevisions();

  // Poll mtimes: fs.watch misses edits on macOS when editors replace the file.
  let planMtime = fs.statSync(F.plan).mtimeMs;
  fs.watchFile(F.plan, { interval: 300 }, cur => {
    if (cur.mtimeMs && cur.mtimeMs !== planMtime) {
      planMtime = cur.mtimeMs;
      refreshRevisions();
      broadcast("plan", { mtime: planMtime });
    }
  });
  fs.watchFile(ENGINE, { interval: 1000 }, () => broadcast("engine", {}));

  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const cookieName = () => `pe${port}`;
  const cookieToken = req => {
    const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${cookieName()}=([^;]+)`));
    return m ? m[1] : "";
  };
  const same = (given, want) => {
    const a = Buffer.from(String(given));
    const b = Buffer.from(want);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  const tokenOk = (req, url) => [req.headers["x-live-token"], url.searchParams.get("t"), cookieToken(req)].some(t => t && same(t, token));
  const json = (res, code, body) => {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const readBody = req => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > 2_000_000) {
        reject(new Error("body too large"));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        reject(e);
      }
    });
  });

  const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif", ".woff2": "font/woff2" };
  const SECURITY = {
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY"
  };
  // The page runs inline engine code and Mermaid from jsDelivr (pinned + SRI); nothing else may load or connect.
  const CSP = "default-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  function serveFile(req, res, file, headers = {}) {
    fs.readFile(file, (e, buf) => {
      if (e) {
        return json(res, 404, { error: "not found" });
      }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store", ...SECURITY, ...headers });
      res.end(req.method === "HEAD" ? undefined : buf);
    });
  }
  // plan.js plus the bookkeeping the agent no longer writes by hand (read by the engine's applyAuto).
  function servePlan(req, res) {
    fs.readFile(F.plan, "utf8", (e, src) => {
      if (e) {
        return json(res, 404, { error: "not found" });
      }
      refreshRevisions();
      const body = `${src}\n;window.PLAN_AUTO = ${JSON.stringify(autoInfo(revState))};\n`;
      res.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "no-store", ...SECURITY });
      res.end(req.method === "HEAD" ? undefined : body);
    });
  }
  function serveStatic(req, res, url) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return json(res, 405, { error: "method not allowed" });
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      // A valid ?t= on the page URL becomes a cookie, so the plain URL works from then on.
      const t = url.searchParams.get("t");
      const headers = t && same(t, token) ? { "set-cookie": `${cookieName()}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000` } : {};
      return serveFile(req, res, ENGINE, { ...headers, "content-security-policy": CSP });
    }
    // Everything but the engine page is plan data: same auth as the API.
    if (!tokenOk(req, url)) {
      return json(res, 401, { error: "missing or wrong token" });
    }
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch (e) {
      return json(res, 400, { error: "bad path" });
    }
    if (rel.split("/").some(seg => seg.startsWith("."))) {
      return json(res, 404, { error: "not found" });
    }
    const file = path.resolve(DIR, "." + rel);
    if (!file.startsWith(DIR + path.sep)) {
      return json(res, 404, { error: "not found" });
    }
    if (file === F.plan) {
      return servePlan(req, res);
    }
    return serveFile(req, res, file);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(e => {
      console.error(`request failed: ${e && e.stack || e}`);
      if (!res.headersSent) {
        json(res, 500, { error: "internal error" });
      } else {
        res.end();
      }
    });
  });
  process.on("uncaughtException", e => console.error(`uncaught: ${e && e.stack || e}`));
  process.on("unhandledRejection", e => console.error(`unhandled: ${e && e.stack || e}`));
  async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch (e) {
      return json(res, 400, { error: "bad url" });
    }
    // DNS-rebinding and cross-site guard: only our own host and origin.
    if (!allowedHosts().has(req.headers.host)) {
      return json(res, 403, { error: "bad host" });
    }
    const origin = req.headers.origin;
    if (origin && !allowedHosts().has(origin.replace(/^http:\/\//, ""))) {
      return json(res, 403, { error: "bad origin" });
    }
    if (!url.pathname.startsWith("/live/")) {
      return serveStatic(req, res, url);
    }
    if (!tokenOk(req, url)) {
      return json(res, 401, { error: "missing or wrong token" });
    }
    try {
      const route = `${req.method} ${url.pathname}`;
      if (route === "GET /live/hello") {
        return json(res, 200, { ok: true, pid: process.pid, stamp, planMtime, ...statusNow(), answers: readJson(F.answers, {}), notes: readJson(F.notesRaw, []), deleted: readJson(F.deleted, {}) });
      }
      if (route === "POST /live/stop") {
        json(res, 200, { ok: true });
        return shutdown();
      }
      if (route === "GET /live/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write("retry: 2000\n\n");
        clients.add(res);
        send(res, "status", statusNow());
        const ping = setInterval(() => res.write(": ping\n\n"), 15000);
        req.on("close", () => {
          clearInterval(ping);
          clients.delete(res);
        });
        return;
      }
      if (route === "PUT /live/notes") {
        const body = await readBody(req);
        if (!Array.isArray(body.raw)) {
          return json(res, 400, { error: "raw must be an array" });
        }
        // Merge per note: newest `updated` wins, deletions are kept as tombstones.
        const dead = { ...readJson(F.deleted, {}), ...(body.deleted && typeof body.deleted === "object" ? body.deleted : {}) };
        const byId = new Map(readJson(F.notesRaw, []).map(n => [n.id, n]));
        for (const n of body.raw) {
          const cur = byId.get(n && n.id);
          if (n && n.id && (!cur || String(n.updated || "") > String(cur.updated || ""))) {
            byId.set(n.id, n);
          }
        }
        const merged = [...byId.values()].filter(n => !dead[n.id]);
        writeJson(F.deleted, dead);
        writeJson(F.notesRaw, merged);
        // The export view is only current when this client already had the merged set.
        const sameSet = merged.length === body.raw.filter(n => !dead[n.id]).length && merged.every(n => body.raw.some(r => r.id === n.id && r.updated === n.updated));
        if (body.export && sameSet) {
          writeJson(F.notes, body.export);
        }
        return json(res, 200, { ok: true, notes: merged, deleted: dead });
      }
      if (route === "POST /live/ask") {
        const body = await readBody(req);
        if (!body.note || !NOTE_ID.test(String(body.note.id || ""))) {
          return json(res, 400, { error: "note.id required ([A-Za-z0-9_-])" });
        }
        const ask = makeAsk(body);
        fs.appendFileSync(F.asks, JSON.stringify(ask) + "\n", { mode: 0o600 });
        pushStatus();
        return json(res, 200, { ok: true, at: ask.at, agent: statusNow().agent });
      }
      if (route === "POST /live/answer") {
        const body = await readBody(req);
        if (!NOTE_ID.test(String(body.noteId || ""))) {
          return json(res, 400, { error: "noteId required ([A-Za-z0-9_-])" });
        }
        const status = body.status === "working" ? "working" : "done";
        return json(res, 200, { ok: true, answer: saveAnswer(String(body.noteId), status, body.text, body.by) });
      }
      return json(res, 404, { error: "unknown endpoint" });
    } catch (e) {
      return json(res, 400, { error: String(e.message || e) });
    }
  }

  function makeAsk(body) {
    const n = body.note;
    return {
      type: "note",
      at: Date.now(),
      noteId: String(n.id),
      mark: n.mark || null,
      markName: n.markName || null,
      text: n.text || "",
      where: n.where || "",
      nid: n.nid || "",
      kind: n.kind || "element",
      quote: n.quote || "",
      target: String(body.target || "").slice(0, 4000),
      plan: body.plan || null,
      planVersion: body.planVersion ?? null,
      planFile: F.plan,
      reply: `node ${shq(SELF)} reply ${shq(DIR)} ${shq(n.id)} -`
    };
  }

  function listenOn(p, triesLeft) {
    server.once("error", e => {
      if (e.code === "EADDRINUSE" && triesLeft > 0) {
        listenOn(p + 1, triesLeft - 1);
      } else {
        console.error(`✗ ${e.message}`);
        process.exit(1);
      }
    });
    server.listen(p, "127.0.0.1", () => {
      port = server.address().port;
      const url = `http://127.0.0.1:${port}/`;
      writeJson(F.server, { port, token, pid: process.pid, url, first: `${url}?t=${token}`, stamp, started: new Date().toISOString() });
      log({ type: "ready", url, first: `${url}?t=${token}` });
    });
  }
  listenOn(wantPort, wantPort === 0 ? 0 : 20);
  // Release the port before exiting, so a restart can bind the same one (stable URL and cookie).
  function shutdown() {
    const cur = readJson(F.server, {});
    if (cur.pid === process.pid) {
      writeJson(F.server, { ...cur, pid: null, stopped: new Date().toISOString() });
    }
    for (const c of clients) {
      c.end();
    }
    server.close(() => process.exit(0));
    server.closeAllConnections?.();
    setTimeout(() => process.exit(0), 1500).unref();
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  let idleSince = Date.now();
  setInterval(() => {
    if (clients.size || listenerState()) {
      idleSince = Date.now();
    } else if (Date.now() - idleSince > IDLE_MS) {
      shutdown();
    }
  }, 60000).unref();
}

// ── open: ensure the server, print the URL, then listen ────────────────
// A server counts as ours only if it answers on its port with its token and pid.
// (A bare pid check could hit an unrelated process after a reboot.)
async function health(s) {
  if (!s || !s.port || !s.token) {
    return null;
  }
  try {
    const res = await fetch(`http://127.0.0.1:${s.port}/live/hello`, { headers: { "x-live-token": s.token }, signal: AbortSignal.timeout(1000) });
    const h = res.ok ? await res.json() : null;
    return h && h.pid === s.pid ? h : null;
  } catch (e) {
    return null;
  }
}
async function stopServer(s) {
  try {
    await fetch(`http://127.0.0.1:${s.port}/live/stop`, { method: "POST", headers: { "x-live-token": s.token }, signal: AbortSignal.timeout(1000) });
  } catch (e) {}
  for (let i = 0; i < 40 && await health(s); i++) {
    await sleep(100);
  }
}
// One spawner at a time per plan folder.
async function withLock(fn) {
  ensureLiveDir();
  for (let i = 0; ; i++) {
    try {
      fs.closeSync(fs.openSync(F.lock, "wx"));
      break;
    } catch (e) {
      const age = Date.now() - (fs.statSync(F.lock, { throwIfNoEntry: false })?.mtimeMs || 0);
      if (age > 15000) {
        fs.rmSync(F.lock, { force: true });
      } else if (i > 150) {
        throw new Error(`another live.mjs is starting this plan (${F.lock})`);
      } else {
        await sleep(100);
      }
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(F.lock, { force: true });
  }
}
async function ensureServer(portArg) {
  return withLock(async () => {
    const cur = readJson(F.server, {});
    const h = await health(cur);
    if (h && cur.stamp === codeStamp()) {
      return cur;
    }
    if (h) {
      await stopServer(cur);
    }
    if (!fs.existsSync(F.plan)) {
      console.error(`✗ no plan.js in ${DIR}`);
      process.exit(1);
    }
    const out = fs.openSync(F.log, "a");
    spawn(process.execPath, [SELF, "serve", DIR, ...(portArg ? ["--port", portArg] : [])], { detached: true, stdio: ["ignore", out, out] }).unref();
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      const s = readJson(F.server, {});
      if (s.pid && s.pid !== cur.pid && await health(s)) {
        return s;
      }
    }
    console.error(`✗ server did not start; see ${F.log}`);
    process.exit(1);
  });
}

async function open() {
  const portArg = flag("--port", null);
  const execCmd = flag("--exec", null);
  const s = await ensureServer(portArg);
  // The first visit needs the token; the server turns it into a cookie.
  log({ type: "ready", url: s.url, open: s.first, agent: execCmd ? "exec" : "session" });
  listen(execCmd);
}

// One listener per plan: a newer listener takes over and the older one exits.
function listen(execCmd) {
  ensureLiveDir();
  const me = { pid: process.pid, mode: execCmd ? "exec" : "listening", started: Date.now() };
  const beat = () => {
    const l = readJson(F.listener, null);
    if (l && l.pid !== process.pid && l.started > me.started && pidAlive(l.pid)) {
      process.exit(0);
    }
    writeJson(F.listener, { ...me, beat: Date.now() });
  };
  beat();
  setInterval(beat, 4000);

  const queue = [];
  let busy = false;
  function pump() {
    if (busy || !queue.length) {
      return;
    }
    busy = true;
    runExec(execCmd, queue.shift()).finally(() => {
      busy = false;
      pump();
    });
  }
  // Session mode: notes saved close together go out as one line, so the agent takes one turn for them.
  const batch = new Map();
  let batchTimer = null;
  function flushBatch() {
    clearTimeout(batchTimer);
    batchTimer = null;
    const list = [...batch.values()];
    batch.clear();
    if (list.length === 1) {
      log(list[0]);
    } else if (list.length > 1) {
      // One replies command answers the whole batch, so per-note reply commands are left out.
      log({ type: "notes", notes: list.map(({ type, reply, ...n }) => n), replies: `node ${shq(SELF)} replies ${shq(DIR)} -` });
    }
  }
  const handle = (a, now) => {
    if (execCmd) {
      queue.push(a);
      pump();
      return;
    }
    batch.set(a.noteId, slimNote(a));
    if (now) {
      flushBatch();
    } else if (!batchTimer) {
      batchTimer = setTimeout(flushBatch, BATCH_MS);
    }
  };

  for (const a of pendingAsks()) {
    handle({ ...a, pending: true }, false);
  }
  flushBatch();
  if (!execCmd) {
    watchChecks();
  }
  let offset = 0;
  try {
    offset = fs.statSync(F.asks).size;
  } catch (e) {}
  let partial = "";
  setInterval(() => {
    let size = 0;
    try {
      size = fs.statSync(F.asks).size;
    } catch (e) {
      return;
    }
    if (size < offset) {
      offset = 0;
    }
    if (size === offset) {
      return;
    }
    const fd = fs.openSync(F.asks, "r");
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    offset = size;
    const lines = (partial + buf.toString("utf8")).split("\n");
    partial = lines.pop();
    for (const l of lines.filter(Boolean)) {
      handle(JSON.parse(l));
    }
  }, 400);
  const stop = () => {
    const l = readJson(F.listener, null);
    if (l && l.pid === process.pid) {
      fs.rmSync(F.listener, { force: true });
    }
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

// The note as the agent sees it: what it needs to act and reply, nothing it can derive or rarely uses.
// The full ask stays in .live/asks.jsonl.
function slimNote(a) {
  const out = { type: "note", noteId: a.noteId };
  if (a.mark) {
    out.mark = a.mark;
  }
  out.text = a.text || "";
  for (const k of ["where", "nid", "quote"]) {
    if (a[k]) {
      out[k] = a[k];
    }
  }
  const target = String(a.target || "").replace(/\s+/g, " ").trim();
  const quote = String(a.quote || "").replace(/\s+/g, " ").trim();
  // Element notes quote the element's first 160 characters, so its text adds nothing; `nid` finds the rest.
  // Text notes quote a selection, and the element text around it is context.
  if (target && !(quote && target.startsWith(quote.replace(/…$/, "")))) {
    out.target = target.length > TARGET_CHARS ? `${target.slice(0, TARGET_CHARS - 1)}…` : target;
  }
  if (a.pending) {
    out.pending = true;
  }
  out.reply = a.reply;
  return out;
}

// Session mode: lint plan.js after the agent's edits settle, and say so only when something is wrong
// (and once more when it's fixed). Saves a check.mjs run per edit.
const CHECK_SETTLE_MS = Number(process.env.PLAN_EXPLORER_CHECK_SETTLE_MS || 3000);
function watchChecks() {
  let seen = 0;
  let changedAt = 0;
  let lastReport = "";
  setInterval(async () => {
    let m = 0;
    try {
      m = fs.statSync(F.plan).mtimeMs;
    } catch (e) {
      return;
    }
    if (!seen) {
      seen = m;
      return;
    }
    if (m !== seen) {
      seen = m;
      changedAt = Date.now();
      return;
    }
    if (!changedAt || Date.now() - changedAt < CHECK_SETTLE_MS) {
      return;
    }
    changedAt = 0;
    const { checkPlanFile } = await import("./check.mjs");
    const r = checkPlanFile(F.plan);
    const report = r.errors.join("\n");
    if (report && report !== lastReport) {
      log({ type: "check", ok: false, errors: r.errors.slice(0, 8), ...(r.errors.length > 8 ? { more: r.errors.length - 8 } : {}) });
    } else if (!report && lastReport) {
      log({ type: "check", ok: true });
    }
    lastReport = report;
  }, 500);
}

// Exec adapter: one process per note, prompt on stdin, stdout streams back as the reply.
function runExec(execCmd, a) {
  return new Promise(resolve => {
    postAnswer(a.noteId, "working", "", "exec").catch(() => {});
    const child = spawn(execCmd, {
      shell: true,
      cwd: DIR,
      env: { ...process.env, PLAN_DIR: DIR, PLAN_FILE: F.plan, PLAN_NOTE_ID: a.noteId },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let out = "";
    let err = "";
    let lastPush = 0;
    child.stdout.on("data", d => {
      out += d;
      if (Date.now() - lastPush > 400) {
        lastPush = Date.now();
        postAnswer(a.noteId, "working", out.trim(), "exec").catch(() => {});
      }
    });
    child.stderr.on("data", d => {
      err += d;
    });
    child.on("close", code => {
      const text = out.trim() || (code ? `Agent command failed (exit ${code}): ${err.trim().slice(-400)}` : "");
      postAnswer(a.noteId, "done", text, "exec").catch(() => {}).finally(resolve);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(execPrompt(a));
  });
}

function execPrompt(a) {
  return `A note was left on a plan page. The plan lives in ${F.plan} (window.PLAN = {...}).

Note on: ${a.where} (nid ${a.nid})
${a.quote ? `Quoted text: "${a.quote}"\n` : ""}${a.target ? `Element text: ${a.target}\n` : ""}Mark: ${a.markName || "Note"} (${a.mark || "none"})
Note: ${a.text}

Rules:
- ? = answer it. ! = address the concern. + = fold the idea in or say why not. ✓ = lock it in. ✗ = cut it. No mark = context; reply only if useful.
- Technical facts only. No preamble, no description of how you found the answer. Keep it short.
- If a change is needed and you can edit files, edit ${F.plan}: keep every existing id and say in one line what changed. Version, dates and "Changed" tags are tracked for you.
- Your stdout is shown to the user as the reply.
`;
}

async function postAnswer(noteId, status, text, by) {
  const s = readJson(F.server, null);
  if (!s || !s.pid) {
    throw new Error(`live server not running for ${DIR}`);
  }
  const res = await fetch(`http://127.0.0.1:${s.port}/live/answer`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-live-token": s.token },
    body: JSON.stringify({ noteId, status, text: text || undefined, by })
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${await res.text()}`);
  }
}

// ── reply / status / stop ───────────────────────────────────────────────
async function reply() {
  const status = flag("--status", "done");
  const [noteId, ...words] = rest;
  if (!noteId) {
    console.error(USAGE);
    process.exit(2);
  }
  let text = words.join(" ");
  if (text === "-") {
    text = fs.readFileSync(0, "utf8").trim();
  }
  try {
    await postAnswer(noteId, status, text, process.env.PLAN_AGENT || "agent");
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
  console.log(`✓ ${status} → ${noteId}`);
}

// Several answers in one command. stdin is either {"<noteId>": "text", …} or blocks:
//   --- <noteId>
//   text (any lines; empty marks the note seen)
function parseReplies(input) {
  const src = input.trim();
  if (src.startsWith("{")) {
    const obj = JSON.parse(src);
    return Object.entries(obj).map(([noteId, text]) => [noteId, String(text ?? "").trim()]);
  }
  const out = [];
  let cur = null;
  for (const line of input.split("\n")) {
    const m = line.match(/^---\s+([A-Za-z0-9_-]{1,64})\s*$/);
    if (m) {
      cur = [m[1], []];
      out.push(cur);
    } else if (cur) {
      cur[1].push(line);
    }
  }
  return out.map(([noteId, lines]) => [noteId, lines.join("\n").trim()]);
}
async function replies() {
  const status = flag("--status", "done") === "working" ? "working" : "done";
  const src = rest[0] && rest[0] !== "-" ? rest.join(" ") : fs.readFileSync(0, "utf8");
  let list;
  try {
    list = parseReplies(src);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(2);
  }
  if (!list.length) {
    console.error("✗ no replies found. Use blocks that start with a line \"--- <noteId>\", or a JSON object.");
    process.exit(2);
  }
  let failed = 0;
  for (const [noteId, text] of list) {
    try {
      await postAnswer(noteId, status, text, process.env.PLAN_AGENT || "agent");
      console.log(`✓ ${status} → ${noteId}`);
    } catch (e) {
      failed++;
      console.error(`✗ ${noteId}: ${e.message}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

// Optional changelog: one entry for the current round, kept in .live/changelog.json with the ids that changed.
function logCmd() {
  const what = rest.join(" ").trim();
  if (!what) {
    console.error(USAGE);
    process.exit(2);
  }
  ensureLiveDir();
  const state = readJson(F.revs, null);
  const info = autoInfo(state) || { version: null, changed: [] };
  const entries = readJson(F.changelog, []);
  entries.push({ version: info.version, date: today(), what, changed: info.changed });
  writeJson(F.changelog, entries);
  console.log(`✓ logged v${info.version ?? "?"}: ${what}`);
}

async function status() {
  const s = readJson(F.server, null);
  const running = !!(await health(s));
  const l = listenerState();
  const info = autoInfo(readJson(F.revs, null));
  console.log(JSON.stringify({ running, url: running ? s.url : null, open: running ? s.first : null, agent: l ? l.mode : "offline", version: info ? info.version : null, changed: info ? info.changed : [], pending: pendingAsks().map(a => ({ noteId: a.noteId, text: a.text, where: a.where })) }, null, 2));
}

async function stopCmd() {
  const s = readJson(F.server, null);
  if (await health(s)) {
    await stopServer(s);
    console.log(`✓ stopped ${s.url}`);
  } else {
    console.log("not running");
  }
}

const RUN = { open, serve, listen: () => listen(flag("--exec", null)), reply, replies, log: logCmd, status, stop: stopCmd };
await RUN[cmd]();
