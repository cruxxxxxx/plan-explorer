#!/usr/bin/env node
// Plan Explorer live bridge: a localhost sidecar between the page and any coding agent.
// No dependencies. The protocol is in reference/live.md.
//
//   node live.mjs serve  <dir> [--port 4848] [--exec "<agent command>"]
//   node live.mjs listen <dir>                 # JSONL of questions on stdout (pending first, then new)
//   node live.mjs reply  <dir> <noteId> [--status working|done] [text | -]
//   node live.mjs status <dir>
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const [cmd, dirArg, ...rest] = process.argv.slice(2);
const USAGE = `usage:
  node live.mjs serve  <dir> [--port 4848] [--exec "<agent command>"]
  node live.mjs listen <dir>
  node live.mjs reply  <dir> <noteId> [--status working|done] [text | -]
  node live.mjs status <dir>`;

if (!cmd || !dirArg) {
  console.error(USAGE);
  process.exit(2);
}
const DIR = path.resolve(dirArg);
const LIVE = path.join(DIR, ".live");
const F = {
  server: path.join(LIVE, "server.json"),
  asks: path.join(LIVE, "asks.jsonl"),
  answers: path.join(LIVE, "answers.json"),
  notes: path.join(LIVE, "notes.json"),
  notesRaw: path.join(LIVE, "notes-raw.json"),
  listener: path.join(LIVE, "listener"),
  plan: path.join(DIR, "plan.js")
};
const LISTENER_FRESH_MS = 15000;

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
function readAsks() {
  try {
    return fs.readFileSync(F.asks, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
  } catch (e) {
    return [];
  }
}
// The newest ask per note that has no answer at or after it.
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
const listenerAlive = () => {
  try {
    return Date.now() - fs.statSync(F.listener).mtimeMs < LISTENER_FRESH_MS;
  } catch (e) {
    return false;
  }
};

// ── serve ───────────────────────────────────────────────────────────────
function serve() {
  if (!fs.existsSync(F.plan)) {
    console.error(`✗ no plan.js in ${DIR}`);
    process.exit(1);
  }
  fs.mkdirSync(LIVE, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(LIVE, ".gitignore"), "*\n");
  const execCmd = flag("--exec", null);
  const wantPort = Number(flag("--port", 4848));
  const prev = readJson(F.server, {});
  const token = prev.token || crypto.randomBytes(24).toString("base64url");
  const clients = new Set();
  let port = 0;
  let execBusy = false;

  const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const broadcast = (event, data) => {
    for (const res of clients) {
      send(res, event, data);
    }
  };
  const statusNow = () => ({
    agent: execCmd ? "exec" : listenerAlive() ? "listening" : "offline",
    pending: pendingAsks().map(a => a.noteId)
  });
  let lastStatus = "";
  const pushStatus = () => {
    const s = statusNow();
    const k = JSON.stringify(s);
    if (k !== lastStatus) {
      lastStatus = k;
      broadcast("status", s);
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

  // Exec adapter: one process per question, prompt on stdin, stdout streams back as the reply.
  function pumpExec() {
    if (!execCmd || execBusy) {
      return;
    }
    const next = pendingAsks().sort((a, b) => a.at - b.at)[0];
    if (!next) {
      return;
    }
    execBusy = true;
    saveAnswer(next.noteId, "working", "", "exec");
    const child = spawn(execCmd, {
      shell: true,
      cwd: DIR,
      env: { ...process.env, PLAN_DIR: DIR, PLAN_FILE: F.plan, PLAN_NOTE_ID: next.noteId },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let out = "";
    let err = "";
    let lastPush = 0;
    child.stdout.on("data", d => {
      out += d;
      if (Date.now() - lastPush > 400) {
        lastPush = Date.now();
        saveAnswer(next.noteId, "working", out.trim(), "exec");
      }
    });
    child.stderr.on("data", d => {
      err += d;
    });
    child.on("close", code => {
      const text = out.trim() || (code ? `Agent command failed (exit ${code}): ${err.trim().slice(-400)}` : "(no answer)");
      saveAnswer(next.noteId, "done", text, "exec");
      execBusy = false;
      pumpExec();
    });
    child.stdin.end(execPrompt(next));
  }

  // Plan file watch: poll mtime. fs.watch misses edits on macOS when editors replace the file.
  let planMtime = 0;
  try {
    planMtime = fs.statSync(F.plan).mtimeMs;
  } catch (e) {}
  fs.watchFile(F.plan, { interval: 300 }, cur => {
    if (cur.mtimeMs && cur.mtimeMs !== planMtime) {
      planMtime = cur.mtimeMs;
      broadcast("plan", { mtime: planMtime });
      log({ type: "plan-changed", at: Date.now() });
    }
  });

  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const tokenOk = (req, url) => {
    const given = req.headers["x-live-token"] || url.searchParams.get("t") || "";
    const a = Buffer.from(String(given));
    const b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
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

  const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2" };
  function serveStatic(req, res, url) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return json(res, 405, { error: "method not allowed" });
    }
    const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    if (rel.split("/").some(seg => seg.startsWith("."))) {
      return json(res, 404, { error: "not found" });
    }
    const file = path.resolve(DIR, "." + rel);
    if (!file.startsWith(DIR + path.sep)) {
      return json(res, 404, { error: "not found" });
    }
    fs.readFile(file, (e, buf) => {
      if (e) {
        return json(res, 404, { error: "not found" });
      }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(req.method === "HEAD" ? undefined : buf);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
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
        return json(res, 200, { ok: true, plan: path.basename(DIR), ...statusNow(), answers: readJson(F.answers, {}), notes: readJson(F.notesRaw, null) });
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
        writeJson(F.notesRaw, body.raw);
        if (body.export) {
          writeJson(F.notes, body.export);
        }
        return json(res, 200, { ok: true });
      }
      if (route === "POST /live/ask") {
        const body = await readBody(req);
        if (!body.note || !body.note.id) {
          return json(res, 400, { error: "note.id required" });
        }
        const ask = makeAsk(body);
        fs.appendFileSync(F.asks, JSON.stringify(ask) + "\n", { mode: 0o600 });
        log(ask);
        pushStatus();
        pumpExec();
        return json(res, 200, { ok: true, at: ask.at, agent: statusNow().agent });
      }
      if (route === "POST /live/answer") {
        const body = await readBody(req);
        if (!body.noteId) {
          return json(res, 400, { error: "noteId required" });
        }
        const status = body.status === "working" ? "working" : "done";
        return json(res, 200, { ok: true, answer: saveAnswer(String(body.noteId), status, body.text, body.by) });
      }
      return json(res, 404, { error: "unknown endpoint" });
    } catch (e) {
      return json(res, 400, { error: String(e.message || e) });
    }
  });

  function makeAsk(body) {
    const n = body.note;
    return {
      type: "ask",
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
      route: body.route || "",
      plan: body.plan || null,
      planVersion: body.planVersion ?? null,
      planFile: F.plan,
      reply: `node ${JSON.stringify(SELF)} reply ${JSON.stringify(DIR)} ${n.id} -`
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
      const url = `http://127.0.0.1:${port}/?t=${token}`;
      writeJson(F.server, { port, token, pid: process.pid, url, exec: execCmd, started: new Date().toISOString() });
      log({ type: "ready", url, exec: execCmd || null, plan: F.plan });
      pumpExec();
    });
  }
  listenOn(wantPort, wantPort === 0 ? 0 : 20);
  const stop = () => {
    try {
      const cur = readJson(F.server, {});
      if (cur.pid === process.pid) {
        writeJson(F.server, { ...cur, pid: null, stopped: new Date().toISOString() });
      }
    } catch (e) {}
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

function log(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function execPrompt(ask) {
  return `You are answering a question left on a plan page. The plan lives in ${F.plan} (window.PLAN = {...}).

Note on: ${ask.where} (nid ${ask.nid})
${ask.quote ? `Quoted text: "${ask.quote}"\n` : ""}${ask.target ? `Element text: ${ask.target}\n` : ""}Mark: ${ask.markName || "Note"} (${ask.mark || "none"})
Question or comment: ${ask.text}

Rules:
- Answer with technical facts only. No preamble, no description of how you found the answer.
- Keep it short: a few sentences or a short list.
- If the note asks for a change (marks ! + ✗ ✓ or an explicit request) and you can edit files, edit ${F.plan}: keep every existing id, set rev to the plan's version on what you change, and say in one line what changed.
- Your stdout is shown to the user as the reply.
`;
}

// ── listen ──────────────────────────────────────────────────────────────
function listen() {
  fs.mkdirSync(LIVE, { recursive: true, mode: 0o700 });
  const beat = () => {
    const t = new Date();
    try {
      fs.utimesSync(F.listener, t, t);
    } catch (e) {
      fs.writeFileSync(F.listener, "", { mode: 0o600 });
    }
  };
  beat();
  setInterval(beat, 5000);
  for (const a of pendingAsks()) {
    log({ ...a, pending: true });
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
      process.stdout.write(l + "\n");
    }
  }, 400);
  const stop = () => {
    try {
      fs.utimesSync(F.listener, new Date(0), new Date(0));
    } catch (e) {}
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

// ── reply ───────────────────────────────────────────────────────────────
async function reply() {
  const status = flag("--status", "done");
  const [noteId, ...words] = rest;
  if (!noteId) {
    console.error(USAGE);
    process.exit(2);
  }
  let text = words.join(" ");
  if (text === "-" || (!text && !process.stdin.isTTY && status === "done")) {
    text = fs.readFileSync(0, "utf8").trim();
  }
  const s = readJson(F.server, null);
  if (!s || !s.pid) {
    console.error(`✗ live server not running for ${DIR} (start: node live.mjs serve ${dirArg})`);
    process.exit(1);
  }
  const res = await fetch(`http://127.0.0.1:${s.port}/live/answer`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-live-token": s.token, host: `127.0.0.1:${s.port}` },
    body: JSON.stringify({ noteId, status, text: text || undefined, by: process.env.PLAN_AGENT || "agent" })
  });
  if (!res.ok) {
    console.error(`✗ ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  console.log(`✓ ${status} → ${noteId}`);
}

// ── status ──────────────────────────────────────────────────────────────
function status() {
  const s = readJson(F.server, null);
  const pend = pendingAsks();
  console.log(JSON.stringify({ running: !!(s && s.pid), url: s && s.pid ? s.url : null, listener: listenerAlive(), pending: pend.map(a => ({ noteId: a.noteId, text: a.text, where: a.where })) }, null, 2));
}

const COMMANDS = { serve, listen, reply, status };
if (!COMMANDS[cmd]) {
  console.error(USAGE);
  process.exit(2);
}
await COMMANDS[cmd]();
