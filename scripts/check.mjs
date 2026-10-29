#!/usr/bin/env node
// Validates a Plan Explorer plan.js: structure, unique ids, note-safe ids.
// Usage: node check.mjs path/to/plan.js
import { readFileSync } from "node:fs";
import vm from "node:vm";

const file = process.argv[2];
if (!file) {
  console.error("usage: node check.mjs path/to/plan.js");
  process.exit(2);
}

const errors = [];
const warnings = [];
const err = m => errors.push(m);
const warn = m => warnings.push(m);

let plan;
try {
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync(file, "utf8"), ctx, { filename: file });
  plan = ctx.window.PLAN;
} catch (e) {
  console.error(`✗ ${file} does not run: ${e.message}`);
  process.exit(1);
}
if (!plan) {
  console.error("✗ plan.js must set window.PLAN");
  process.exit(1);
}

const ID = /^[a-z0-9][a-z0-9-]*$/;
function checkIds(list, where) {
  const seen = new Set();
  (list || []).forEach((x, i) => {
    if (!x || typeof x !== "object") {
      err(`${where}[${i}] is not an object`);
      return;
    }
    if (!x.id) {
      err(`${where}[${i}] has no id`);
    } else if (!ID.test(x.id)) {
      err(`${where}[${i}] id "${x.id}" must be lowercase kebab-case (no slashes)`);
    } else if (seen.has(x.id)) {
      err(`${where}: duplicate id "${x.id}"`);
    }
    seen.add(x.id);
    if (x.rev != null && plan.version != null && x.rev > plan.version) {
      warn(`${where}/${x.id}: rev ${x.rev} is newer than plan version ${plan.version}`);
    }
  });
}

if (!plan.id || !ID.test(plan.id)) { err("plan.id is required, lowercase kebab-case (it keys the notes storage)"); }
if (!plan.title) { err("plan.title is required"); }
if (typeof plan.version !== "number") { warn("plan.version should be a number"); }
if (!plan.kind) {
  warn('plan.kind is not set. Use "review" (findings with severity) or "plan" (an implementation plan: work items, no severity). It decides how items read.');
} else if (!["review", "plan"].includes(plan.kind)) {
  warn(`plan.kind "${plan.kind}" is not review|plan`);
}
if (!Array.isArray(plan.areas) || !plan.areas.length) { err("plan.areas must be a non-empty array"); }

checkIds(plan.areas, "areas");
const typeIds = new Set(((plan.api || {}).types || []).map(t => t.id));

// Messages in a sequence diagram, in order, with the anchor named by a `%% @name` line right above each.
const MSG = /^(.+?)\s*(<<-{1,2}>>|-{1,2}(?:>>|>|x|\)))\s*[+-]?\s*(.+?)\s*:/;
const ANCHOR_LINE = /^%%\s*@(\S+)\s*$/;
function parseFlow(src, where) {
  const msgs = [];
  const anchors = {};
  let pending = null;
  for (const line of String(src || "").split("\n")) {
    const t = line.trim();
    const a = t.match(ANCHOR_LINE);
    if (a) {
      if (pending) { warn(`${where}: anchor @${pending} is not directly above a message`); }
      pending = a[1];
      if (!ID.test(pending)) { err(`${where}: anchor @${pending} must be lowercase kebab-case`); }
      continue;
    }
    if (!t || t.startsWith("%%")) {
      continue;
    }
    if (MSG.test(t)) {
      if (pending) {
        if (anchors[pending] != null) {
          err(`${where}: anchor @${pending} is used twice`);
        } else {
          anchors[pending] = msgs.length;
        }
      }
      msgs.push(t);
    } else if (pending) {
      warn(`${where}: anchor @${pending} is not directly above a message`);
    }
    pending = null;
  }
  if (pending) { warn(`${where}: anchor @${pending} is not directly above a message`); }
  return { msgs, anchors };
}

// One item model: areas[].items (old issues / work / openQuestions are read as aliases).
const TYPES = ["bug", "risk", "new", "change", "remove", "decision", "question"];
const STATUSES = ["open", "doing", "done", "dropped"];
const LEGACY_STATUS = { todo: "open", fixing: "doing", fixed: "done", wontfix: "dropped" };
const LEGACY_TYPE = { issues: "bug", work: "change", openQuestions: "question" };
function itemsOf(a) {
  const out = [];
  for (const list of ["items", "issues", "work", "openQuestions"]) {
    for (const raw of a[list] || []) {
      if (!raw || typeof raw !== "object") { continue; }
      const type = TYPES.includes(raw.type) ? raw.type : list === "items" ? (plan.kind === "review" ? "bug" : "change") : LEGACY_TYPE[list];
      out.push({ raw, list, type, title: raw.title ?? raw.text, status: LEGACY_STATUS[raw.status] || raw.status || "open" });
    }
  }
  return out;
}

// An item sits on a flow and steps: 1-based message numbers or anchor names.
function checkLinks(it, ib, a, flows) {
  const i = it.raw;
  const f = i.flow ? flows.get(i.flow) || flows.get(String(i.flow).replace(`${a.id}/`, "")) : null;
  if (i.flow && !f) { err(`${ib}: flow "${i.flow}" is not a flow in area ${a.id}`); }
  if (i.steps != null && !Array.isArray(i.steps)) { err(`${ib}: steps must be an array`); }
  if (Array.isArray(i.steps)) {
    if (!i.flow) {
      err(`${ib}: steps given without flow`);
    } else if (f) {
      const { msgs, anchors } = f.parsed;
      const anchored = Object.keys(anchors).length > 0;
      for (const k of i.steps) {
        if (typeof k === "string" && !/^\d+$/.test(k)) {
          const name = k.replace(/^@/, "");
          if (anchors[name] == null) { err(`${ib}: step "${k}" is not an anchor in ${f.id} (known: ${Object.keys(anchors).map(x => "@" + x).join(", ") || "none"})`); }
        } else if (!Number.isInteger(Number(k)) || k < 1 || k > msgs.length) {
          err(`${ib}: step ${k} is outside 1..${msgs.length} (messages in ${f.id})`);
        } else if (anchored) {
          warn(`${ib}: step ${k} is a number in ${f.id}, which has anchors; numbers shift when a message is inserted above. Put \`%% @name\` above that message and use "name"`);
        }
      }
    }
  }
  for (const t of i.types || []) {
    if (!typeIds.has(t)) { err(`${ib}: types → "${t}" is not an api type id`); }
  }
  if (!i.flow && (a.flows || []).length && ["open", "doing"].includes(it.status) && !["remove", "decision", "question"].includes(it.type)) {
    warn(`${ib}: not linked to a flow (add flow + steps so it shows on the diagram)`);
  }
}
let flowCount = 0;
let legacyLists = 0;
for (const a of plan.areas || []) {
  const b = `areas/${a.id}`;
  if (!a.title) { err(`${b}: missing title`); }
  if (a.status && !["draft", "exploring", "settled"].includes(a.status)) { warn(`${b}: status "${a.status}" is not draft|exploring|settled`); }
  checkIds(a.flows, `${b}/flows`);
  checkIds(a.sections, `${b}/sections`);
  checkIds(a.options, `${b}/options`);
  const flows = new Map();
  for (const f of a.flows || []) {
    flowCount++;
    const fb = `${b}/flows/${f.id}`;
    const src = String(f.mermaid || "").trim();
    if (!f.title) { err(`${fb}: missing title`); }
    if (!src) {
      err(`${fb}: empty mermaid`);
    } else if (!src.startsWith("sequenceDiagram")) {
      warn(`${fb}: not a sequenceDiagram; per-message notes only work on sequence diagrams`);
    }
    const parsed = parseFlow(src, fb);
    flows.set(f.id, { id: f.id, parsed });
    const participants = new Set();
    for (const t of parsed.msgs) {
      const m = t.match(MSG);
      participants.add(m[1].trim());
      participants.add(m[3].trim());
    }
    for (const [pid, tid] of Object.entries(f.actors || {})) {
      if (!typeIds.has(tid)) { err(`${fb}: actors.${pid} → "${tid}" is not an api type id`); }
      if (!new RegExp(`(participant|actor)\\s+${pid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(src)) { warn(`${fb}: actors.${pid} is not a participant id`); }
    }
    if (participants.size > 8) { warn(`${fb}: ${participants.size} participants; split it into smaller flows`); }
  }
  const items = itemsOf(a);
  legacyLists += ["issues", "work", "openQuestions"].filter(k => Array.isArray(a[k])).length;
  checkIds(items.map(x => x.raw), `${b}/items`);
  for (const it of items) {
    const i = it.raw;
    const ib = `${b}/items/${i.id}`;
    checkLinks(it, ib, a, flows);
    if (!it.title) { err(`${ib}: missing title`); }
    if (i.type != null && !TYPES.includes(i.type)) { warn(`${ib}: type "${i.type}" is not ${TYPES.join("|")}`); }
    if (i.status != null && !STATUSES.includes(it.status)) { warn(`${ib}: status "${i.status}" is not ${STATUSES.join("|")}`); }
    if (it.type !== "bug") {
      if (i.severity) { warn(`${ib}: severity only applies to bugs (findings in a review); this is a ${it.type}`); }
      continue;
    }
    if (i.severity && !["high", "medium", "low"].includes(i.severity)) { warn(`${ib}: severity "${i.severity}" is not high|medium|low`); }
    if (i.origin && !["pre-existing", "introduced"].includes(i.origin)) { warn(`${ib}: origin "${i.origin}" is not pre-existing|introduced`); }
    if (!i.category) { warn(`${ib}: no category (name the subsystem affected)`); }
    if (!i.where) { warn(`${ib}: no where (file:line)`); }
    if (/^[A-Z]+-\d+\b/.test(it.title || "")) { warn(`${ib}: title starts with a tracker-style id; titles describe the problem`); }
    if (i.severity !== "low" && !i.how && !i.fix) { warn(`${ib}: no how (the fix)`); }
  }
  if (plan.kind === "plan" && items.some(x => x.type === "bug" && x.raw.severity && x.list !== "issues")) {
    warn(`${b}: plan.kind is "plan" but the area has bugs with severity; they read as review findings. Planned changes and risks use new|change|remove|risk.`);
  }
  for (const s of a.sections || []) {
    if (/^[A-Z]+-\d+\b/.test(s.title || "")) { warn(`${b}/sections/${s.id}: title "${s.title}" looks like an issue; use an item with type "bug"`); }
    if (!s.title) { err(`${b}/sections/${s.id}: missing title`); }
  }
}
if (legacyLists) { warn(`uses the old issues/work/openQuestions lists (read as items). node scripts/migrate-plan.mjs converts them`); }
checkIds(plan.roadmap, "roadmap");
if (plan.api) {
  const types = plan.api.types || [];
  if (!Array.isArray(types)) { err("api.types must be an array"); }
  checkIds(types, "api/types");
  const areaIds = new Set((plan.areas || []).map(a => a.id));
  for (const t of types) {
    const b = `api/${t.id}`;
    if (!t.name) { err(`${b}: missing name`); }
    if (t.area && !areaIds.has(t.area)) { err(`${b}: area "${t.area}" does not exist`); }
    if (t.state && !["existing", "new", "proposed", "changed", "removed"].includes(t.state)) { warn(`${b}: state "${t.state}" is not existing|new|proposed|changed|removed`); }
    checkIds(t.members, `${b}/members`);
    for (const m of t.members || []) {
      if (!m.sig) { err(`${b}/members/${m.id}: missing sig`); }
      for (const p of m.params || []) {
        if (!p.name) { err(`${b}/members/${m.id}: param without name`); }
      }
    }
  }
}
if (plan.replies && typeof plan.replies !== "object") { err("replies must be an object keyed by note id"); }
for (const [id, r] of Object.entries(plan.replies || {})) {
  if (!r || !r.text) { err(`replies["${id}"] needs a text field`); }
}

for (const w of warnings) { console.log(`! ${w}`); }
for (const e of errors) { console.log(`✗ ${e}`); }
if (errors.length) {
  console.log(`\n${errors.length} error(s) in ${file}`);
  process.exit(1);
}
console.log(`✓ ${plan.title} v${plan.version}: ${plan.areas.length} areas, ${flowCount} flows${warnings.length ? `, ${warnings.length} warning(s)` : ""}`);
