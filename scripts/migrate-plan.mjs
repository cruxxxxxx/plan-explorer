#!/usr/bin/env node
// Converts a plan.js from the old item shapes to the unified one:
//   areas[].issues / work / openQuestions → areas[].items  (one type vocabulary, one status lifecycle)
//   numeric steps → step anchors (`%% @name` above the message), so inserting a message no longer re-pins items.
// Never writes in place unless asked. Prints a summary (counts, anything lossy) to stderr.
// Usage: node migrate-plan.mjs <plan.js> [--out file] [--in-place] [--no-anchors] [--json]
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--out");
const outIdx = args.indexOf("--out");
const outFile = outIdx >= 0 ? args[outIdx + 1] : args.includes("--in-place") ? file : null;
const withAnchors = !args.includes("--no-anchors");
if (!file || (outIdx >= 0 && !outFile)) {
  console.error("usage: node migrate-plan.mjs <plan.js> [--out file] [--in-place] [--no-anchors] [--json]");
  process.exit(2);
}

const source = readFileSync(file, "utf8");
let plan;
try {
  const ctx = { window: {} };
  vm.runInNewContext(source, ctx, { filename: file });
  plan = ctx.window.PLAN;
} catch (e) {
  console.error(`✗ ${file} does not run: ${e.message}`);
  process.exit(1);
}
if (!plan || !Array.isArray(plan.areas)) {
  console.error("✗ plan.js must set window.PLAN with areas");
  process.exit(1);
}

const report = { items: { bug: 0, work: 0, question: 0 }, statusMapped: {}, fieldsRenamed: {}, anchorsAdded: 0, stepsAnchored: 0, stepsKeptNumeric: 0, idCollisions: [], lossy: [] };
const bump = (o, k) => {
  o[k] = (o[k] || 0) + 1;
};
const STATUS = { todo: "open", fixing: "doing", fixed: "done", wontfix: "dropped" };
const MSG = /^(.+?)\s*(<<-{1,2}>>|-{1,2}(?:>>|>|x|\)))\s*[+-]?\s*(.+?)\s*:\s*(.*)$/;
const ANCHOR = /^%%\s*@([a-z0-9][a-z0-9-]*)\s*$/i;

// Item keys in a fixed lead order, then whatever else the item had, in its original order.
function ordered(item) {
  const out = {};
  for (const k of ["id", "type", "title"]) {
    if (item[k] !== undefined) { out[k] = item[k]; }
  }
  for (const [k, v] of Object.entries(item)) {
    if (!(k in out) && v !== undefined) { out[k] = v; }
  }
  return out;
}
// Renames a key in place, keeping its position among the other keys.
function rename(item, from, to) {
  if (item[from] === undefined) { return; }
  if (item[to] !== undefined) {
    report.lossy.push(`${item.id}: has both ${from} and ${to}; kept ${from} under ${from}`);
    return;
  }
  const entries = Object.entries(item).map(([k, v]) => [k === from ? to : k, v]);
  for (const k of Object.keys(item)) { delete item[k]; }
  Object.assign(item, Object.fromEntries(entries));
  bump(report.fieldsRenamed, `${from}→${to}`);
}
function mapStatus(item) {
  if (item.status && STATUS[item.status]) {
    bump(report.statusMapped, `${item.status}→${STATUS[item.status]}`);
    item.status = STATUS[item.status];
  }
}
function fromIssue(raw) {
  const item = { ...raw, type: "bug" };
  mapStatus(item);
  rename(item, "cause", "why");
  rename(item, "fix", "how");
  report.items.bug++;
  return ordered(item);
}
function fromWork(raw) {
  const item = { ...raw, type: raw.type || "change" };
  mapStatus(item);
  report.items.work++;
  return ordered(item);
}
function fromQuestion(raw) {
  const item = { ...raw, type: "question" };
  rename(item, "text", "title");
  report.items.question++;
  return ordered(item);
}

// ── anchors ────────────────────────────────────────────────────────────
function messageLines(src) {
  const lines = String(src).split("\n");
  const msgs = [];
  let pending = null;
  lines.forEach((raw, idx) => {
    const l = raw.trim();
    const a = l.match(ANCHOR);
    if (a) {
      pending = a[1].toLowerCase();
      return;
    }
    if (!l || l.startsWith("%%")) {
      return;
    }
    const m = l.match(MSG);
    if (m) { msgs.push({ idx, text: m[4], indent: raw.match(/^\s*/)[0], anchor: pending }); }
    pending = null;
  });
  return { lines, msgs };
}
function slug(text, taken) {
  const words = String(text).replace(/<br\s*\/?>/gi, " ").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  let base = words.slice(0, 3).join("-").slice(0, 28).replace(/-+$/, "") || "step";
  if (!/^[a-z0-9]/.test(base)) { base = "s-" + base; }
  let name = base;
  for (let n = 2; taken.has(name); n++) { name = `${base}-${n}`; }
  taken.add(name);
  return name;
}
function anchorFlow(f, wanted) {
  const { lines, msgs } = messageLines(f.mermaid);
  const taken = new Set(msgs.map(m => m.anchor).filter(Boolean));
  const names = new Map();
  const inserts = [];
  for (const k of [...wanted].sort((x, y) => x - y)) {
    const m = msgs[k];
    if (!m) { continue; }
    if (!m.anchor) {
      m.anchor = slug(m.text, taken);
      inserts.push({ idx: m.idx, line: `${m.indent}%% @${m.anchor}` });
      report.anchorsAdded++;
    }
    names.set(k, m.anchor);
  }
  for (const ins of inserts.sort((x, y) => y.idx - x.idx)) { lines.splice(ins.idx, 0, ins.line); }
  f.mermaid = lines.join("\n");
  return names;
}
function anchorArea(a) {
  const flows = a.flows || [];
  const flowOf = i => flows.find(f => i.flow === f.id || i.flow === `${a.id}/${f.id}`);
  const isSeq = f => String(f.mermaid || "").trim().startsWith("sequenceDiagram");
  for (const f of flows.filter(isSeq)) {
    const pinned = a.items.filter(i => flowOf(i) === f && Array.isArray(i.steps));
    const count = messageLines(f.mermaid).msgs.length;
    const wanted = new Set();
    for (const i of pinned) {
      for (const s of i.steps) {
        if (Number.isInteger(s) && s >= 1 && s <= count) { wanted.add(s - 1); }
      }
    }
    if (!wanted.size) { continue; }
    const names = anchorFlow(f, wanted);
    for (const i of pinned) {
      i.steps = i.steps.map(s => {
        if (Number.isInteger(s) && names.has(s - 1)) {
          report.stepsAnchored++;
          return names.get(s - 1);
        }
        if (typeof s === "number") {
          report.stepsKeptNumeric++;
          report.lossy.push(`${a.id}/${i.id}: step ${s} is outside 1..${count} in ${f.id}; left numeric`);
        }
        return s;
      });
    }
  }
}

// ── convert ────────────────────────────────────────────────────────────
for (const a of plan.areas) {
  const legacy = ["issues", "work", "openQuestions"].filter(k => Array.isArray(a[k]));
  if (!legacy.length) {
    if (withAnchors && Array.isArray(a.items)) { anchorArea(a); }
    continue;
  }
  const items = [
    ...(a.items || []),
    ...(a.issues || []).map(fromIssue),
    ...(a.work || []).map(fromWork),
    ...(a.openQuestions || []).map(fromQuestion)
  ];
  const seen = new Set();
  for (const i of items) {
    if (seen.has(i.id)) {
      report.idCollisions.push(`${a.id}/${i.id}`);
      report.lossy.push(`${a.id}/${i.id}: id used twice in the area after merging lists; rename one by hand (notes attach to ids)`);
    }
    seen.add(i.id);
  }
  // Put items where the first legacy list was, so the area's key order stays familiar.
  const rebuilt = {};
  let placed = false;
  for (const [k, v] of Object.entries(a)) {
    if (k === "items" || legacy.includes(k)) {
      if (!placed) {
        rebuilt.items = items;
        placed = true;
      }
      continue;
    }
    rebuilt[k] = v;
  }
  for (const k of Object.keys(a)) { delete a[k]; }
  Object.assign(a, rebuilt);
  if (withAnchors) { anchorArea(a); }
}

// ── write JS (template literals for multi-line text, unquoted keys) ───
const KEY = /^[A-Za-z_$][\w$]*$/;
function str(s) {
  if (s.includes("\n")) { return "`" + s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`"; }
  return JSON.stringify(s);
}
function short(v) {
  return v === null || typeof v !== "object" || (Array.isArray(v) ? v.every(x => x === null || typeof x !== "object") : false);
}
function emit(v, ind) {
  const pad = "  ".repeat(ind + 1);
  const end = "  ".repeat(ind);
  if (v === null) { return "null"; }
  if (typeof v === "string") { return str(v); }
  if (typeof v !== "object") { return JSON.stringify(v); }
  if (Array.isArray(v)) {
    if (!v.length) { return "[]"; }
    const flat = v.every(short) ? `[${v.map(x => emit(x, ind)).join(", ")}]` : null;
    if (flat && flat.length <= 100 && !flat.includes("\n")) { return flat; }
    return `[\n${v.map(x => pad + emit(x, ind + 1)).join(",\n")}\n${end}]`;
  }
  const keys = Object.keys(v).filter(k => v[k] !== undefined);
  if (!keys.length) { return "{}"; }
  const prop = k => (KEY.test(k) ? k : JSON.stringify(k));
  if (keys.every(k => short(v[k]) && !Array.isArray(v[k]))) {
    const flat = `{ ${keys.map(k => `${prop(k)}: ${emit(v[k], ind)}`).join(", ")} }`;
    if (flat.length <= 80 && !flat.includes("\n")) { return flat; }
  }
  return `{\n${keys.map(k => `${pad}${prop(k)}: ${emit(v[k], ind + 1)}`).join(",\n")}\n${end}}`;
}
const at = source.search(/window\.PLAN\s*=/);
const preamble = at > 0 ? source.slice(0, at).replace(/\s*$/, "\n") : "";
const out = `${preamble}window.PLAN = ${emit(plan, 0)};\n`;
if (/^\s*\/\//m.test(source.slice(at))) {
  report.lossy.push("comments inside the PLAN object are not carried over");
}

if (outFile) {
  writeFileSync(outFile, out);
} else {
  process.stdout.write(out);
}
const r = report;
const summary = `${file}: ${r.items.bug} issues → bug, ${r.items.work} work → items, ${r.items.question} questions → question; ` +
  `status ${JSON.stringify(r.statusMapped)}; fields ${JSON.stringify(r.fieldsRenamed)}; ` +
  `${r.anchorsAdded} anchors added, ${r.stepsAnchored} steps anchored, ${r.stepsKeptNumeric} left numeric; ` +
  `${r.lossy.length ? "lossy: " + r.lossy.join("; ") : "nothing lossy"}${outFile ? ` → ${outFile}` : ""}`;
console.error(args.includes("--json") ? JSON.stringify(report) : summary);
