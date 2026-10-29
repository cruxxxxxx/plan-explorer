#!/usr/bin/env node
// Plan Explorer live server: serves a plan folder (just plan.js) with the skill's engine,
// and relays notes between the page and any coding agent. No dependencies.
// Protocol: reference/live.md
//
//   node live.mjs <dir> [--exec "<agent cmd>"]   start or reuse the server, print the URL, then stream notes
//   node live.mjs reply <dir> <noteId> [--status working|done] [text | -]
//   node live.mjs status <dir>
//   node live.mjs stop <dir>
//   node live.mjs serve <dir> [--port N]         the server itself, in the foreground
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
// PLAN_EXPLORER_ENGINE overrides the engine (tests inject a harness this way).
const ENGINE = process.env.PLAN_EXPLORER_ENGINE || path.join(path.dirname(SELF), "..", "engine", "explorer.html");
const USAGE = `usage:
  node live.mjs <dir> [--exec "<agent cmd>"]
  node live.mjs reply  <dir> <noteId> [--status working|done] [text | -]
  node live.mjs status <dir>
  node live.mjs stop   <dir>
  node live.mjs serve  <dir> [--port N]`;
const COMMANDS = ["serve", "listen", "reply", "status", "stop"];
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
  plan: path.join(DIR, "plan.js")
};
const LISTENER_FRESH_MS = 15000;
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

  // Poll mtimes: fs.watch misses edits on macOS when editors replace the file.
  let planMtime = fs.statSync(F.plan).mtimeMs;
  fs.watchFile(F.plan, { interval: 300 }, cur => {
    if (cur.mtimeMs && cur.mtimeMs !== planMtime) {
      planMtime = cur.mtimeMs;
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
  const handle = a => {
    if (execCmd) {
      queue.push(a);
      pump();
    } else {
      log(a);
    }
  };

  for (const a of pendingAsks()) {
    handle({ ...a, pending: true });
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
- If a change is needed and you can edit files, edit ${F.plan}: keep every existing id, set rev to the plan's version on what you change, and say in one line what changed.
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

async function status() {
  const s = readJson(F.server, null);
  const running = !!(await health(s));
  const l = listenerState();
  console.log(JSON.stringify({ running, url: running ? s.url : null, open: running ? s.first : null, agent: l ? l.mode : "offline", pending: pendingAsks().map(a => ({ noteId: a.noteId, text: a.text, where: a.where })) }, null, 2));
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

const RUN = { open, serve, listen: () => listen(flag("--exec", null)), reply, status, stop: stopCmd };
await RUN[cmd]();
