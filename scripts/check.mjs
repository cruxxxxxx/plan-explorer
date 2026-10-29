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

function messageCount(src) {
  let n = 0;
  for (const line of String(src || "").split("\n")) {
    const t = line.trim();
    if (!t.startsWith("%%") && /^(.+?)\s*(<<-{1,2}>>|-{1,2}(?:>>|>|x|\)))\s*[+-]?\s*(.+?)\s*:/.test(t)) {
      n++;
    }
  }
  return n;
}

// v2 coupling: issue → flow + steps (1-based message numbers) + api types.
function checkIssueLinks(i, ib, a, flowIds) {
  if (i.flow && !flowIds.has(i.flow)) {
    err(`${ib}: flow "${i.flow}" is not a flow in area ${a.id}`);
  }
  if (i.steps) {
    if (!i.flow) {
      err(`${ib}: steps given without flow`);
    } else if (flowIds.has(i.flow)) {
      const n = messageCount(a.flows.find(f => f.id === i.flow).mermaid);
      for (const k of i.steps) {
        if (!Number.isInteger(k) || k < 1 || k > n) { err(`${ib}: step ${k} is outside 1..${n} (messages in ${i.flow})`); }
      }
    }
  }
  for (const t of i.types || []) {
    if (!typeIds.has(t)) { err(`${ib}: types → "${t}" is not an api type id`); }
  }
  if (!i.flow && (a.flows || []).length && !["fixed", "wontfix", "done", "dropped"].includes(i.status) && i.type !== "remove" && i.type !== "decision") {
    warn(`${ib}: not linked to a flow (add flow + steps so it shows on the diagram)`);
  }
}
let flowCount = 0;
for (const a of plan.areas || []) {
  const b = `areas/${a.id}`;
  if (!a.title) { err(`${b}: missing title`); }
  if (a.status && !["draft", "exploring", "settled"].includes(a.status)) { warn(`${b}: status "${a.status}" is not draft|exploring|settled`); }
  checkIds(a.flows, `${b}/flows`);
  checkIds(a.sections, `${b}/sections`);
  checkIds(a.options, `${b}/options`);
  checkIds(a.openQuestions, `${b}/openQuestions`);
  for (const f of a.flows || []) {
    flowCount++;
    const src = String(f.mermaid || "").trim();
    if (!f.title) { err(`${b}/flows/${f.id}: missing title`); }
    if (!src) {
      err(`${b}/flows/${f.id}: empty mermaid`);
    } else if (!src.startsWith("sequenceDiagram")) {
      warn(`${b}/flows/${f.id}: not a sequenceDiagram; per-message notes only work on sequence diagrams`);
    }
    const participants = new Set();
    for (const line of src.split("\n")) {
      if (line.trim().startsWith("%%")) {
        continue;
      }
      const m = line.trim().match(/^(.+?)\s*(<<-{1,2}>>|-{1,2}(?:>>|>|x|\)))\s*[+-]?\s*(.+?)\s*:/);
      if (m) {
        participants.add(m[1].trim());
        participants.add(m[3].trim());
      }
    }
    for (const [pid, tid] of Object.entries(f.actors || {})) {
      if (!typeIds.has(tid)) { err(`${b}/flows/${f.id}: actors.${pid} → "${tid}" is not an api type id`); }
      if (!new RegExp(`(participant|actor)\\s+${pid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(src)) { warn(`${b}/flows/${f.id}: actors.${pid} is not a participant id`); }
    }
    if (participants.size > 8) { warn(`${b}/flows/${f.id}: ${participants.size} participants; split it into smaller flows`); }
  }
  checkIds(a.issues, `${b}/issues`);
  const flowIds = new Set((a.flows || []).map(f => f.id));
  for (const i of a.issues || []) {
    const ib = `${b}/issues/${i.id}`;
    checkIssueLinks(i, ib, a, flowIds);
    if (!i.title) { err(`${ib}: missing title`); }
    if (i.severity && !["high", "medium", "low"].includes(i.severity)) { warn(`${ib}: severity "${i.severity}" is not high|medium|low`); }
    if (i.status && !["open", "fixing", "fixed", "wontfix"].includes(i.status)) { warn(`${ib}: status "${i.status}" is not open|fixing|fixed|wontfix`); }
    if (i.origin && !["pre-existing", "introduced"].includes(i.origin)) { warn(`${ib}: origin "${i.origin}" is not pre-existing|introduced`); }
    if (!i.category) { warn(`${ib}: no category (name the subsystem affected)`); }
    if (!i.where) { warn(`${ib}: no where (file:line)`); }
    if (/^[A-Z]+-\d+\b/.test(i.title || "")) { warn(`${ib}: title starts with a tracker-style id; titles describe the problem`); }
    if (i.severity !== "low" && !i.fix) { warn(`${ib}: no fix`); }
  }
  checkIds(a.work, `${b}/work`);
  const itemIds = new Set((a.issues || []).map(i => i.id));
  for (const w of a.work || []) {
    const wb = `${b}/work/${w.id}`;
    if (itemIds.has(w.id)) { err(`${wb}: id also used by an issue in this area`); }
    if (!w.title) { err(`${wb}: missing title`); }
    if (w.type && !["new", "change", "remove", "risk", "decision"].includes(w.type)) { warn(`${wb}: type "${w.type}" is not new|change|remove|risk|decision`); }
    if (w.status && !["todo", "doing", "done", "dropped"].includes(w.status)) { warn(`${wb}: status "${w.status}" is not todo|doing|done|dropped`); }
    if (w.severity) { warn(`${wb}: work items don't take severity (that's for review findings); use type`); }
    checkIssueLinks(w, wb, a, flowIds);
  }
  if (plan.kind === "plan" && (a.issues || []).length) {
    warn(`${b}: plan.kind is "plan" but the area has issues; issues render as review findings with severity. Use work for planned changes and risks.`);
  }
  for (const s of a.sections || []) {
    if (/^[A-Z]+-\d+\b/.test(s.title || "")) { warn(`${b}/sections/${s.id}: title "${s.title}" looks like an issue; use areas[].issues`); }
    if (!s.title) { err(`${b}/sections/${s.id}: missing title`); }
  }
  for (const q of a.openQuestions || []) {
    if (!q.text) { err(`${b}/openQuestions/${q.id}: missing text`); }
  }
}
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
