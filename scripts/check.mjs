#!/usr/bin/env node
// Validates a Plan Explorer plan.js: structure, unique ids, note-safe ids, and a static lint of
// sequence diagrams that catches the usual Mermaid errors without a browser.
// Usage: node check.mjs path/to/plan.js
// Also imported by live.mjs (checkPlanFile), which runs it after every plan.js edit while live.
import { readFileSync, realpathSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ID = /^[a-z0-9][a-z0-9-]*$/;
// Message arrows Mermaid accepts in sequence diagrams.
const ARROW = "<<-{1,2}>>|-{1,2}(?:>>|>|x|\\))";
const MESSAGE = new RegExp(`^(.+?)\\s*(${ARROW})\\s*([+-]?)\\s*(.+?)\\s*:(.*)$`);
// A line that has an arrow-ish token but isn't a valid message.
const ARROWISH = /(?:<|=|-)+(?:>|x|\))|->|--|=>/;
const BLOCK_OPEN = /^(loop|alt|opt|par|par_over|critical|break|rect|box)\b/i;
const NOTE = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:(.*)$/i;
const DECL = /^(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/i;
const PARTICIPANT_ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;

// Counts messages the way the engine numbers steps (1-based, skipping %% lines).
export function messageCount(src) {
  let n = 0;
  for (const line of String(src || "").split("\n")) {
    const t = line.trim();
    if (!t.startsWith("%%") && MESSAGE.test(t)) {
      n++;
    }
  }
  return n;
}

// Static lint of one sequenceDiagram. Returns { errors, warnings, participants }, each message prefixed "line N".
export function lintSequence(src) {
  const errors = [];
  const warnings = [];
  const declared = new Map();
  const used = new Set();
  const stack = [];
  let maxDepth = 0;
  const lines = String(src || "").split("\n");
  const at = i => `line ${i + 1}`;
  const first = lines.findIndex(l => l.trim() && !l.trim().startsWith("%%"));
  const textIssues = (i, text, what) => {
    if (text.includes(";")) {
      errors.push(`${at(i)}: ";" in ${what} ends the statement in Mermaid; write "and" or "then"`);
    }
    if (/#/.test(text) && !text.includes(";")) {
      warnings.push(`${at(i)}: "#" in ${what}; "#name;" is read as an entity code, so spell it out ("number", "no.")`);
    }
    if (/[{}]/.test(text)) {
      warnings.push(`${at(i)}: braces in ${what}; keep message text plain`);
    }
    if (/[<>]/.test(text.replace(/<br\s*\/?>/gi, ""))) {
      warnings.push(`${at(i)}: raw "<" or ">" in ${what}; write it out or use <br> only`);
    }
  };
  const use = (i, id, role) => {
    used.add(id);
    if (declared.size && !declared.has(id)) {
      errors.push(`${at(i)}: unknown participant "${id}" in ${role} (declared: ${[...declared.keys()].join(", ")})`);
    }
  };
  lines.forEach((raw, i) => {
    const t = raw.trim();
    if (!t || t.startsWith("%%")) {
      return;
    }
    if (i === first) {
      if (t !== "sequenceDiagram") {
        errors.push(`${at(i)}: expected "sequenceDiagram"`);
      }
      return;
    }
    const destroy = t.match(/^destroy\s+(\S+)$/i);
    if (destroy) {
      use(i, destroy[1], "destroy");
      return;
    }
    const decl = t.replace(/^create\s+/i, "").match(DECL);
    if (decl) {
      const id = decl[2].trim();
      if (!PARTICIPANT_ID.test(id)) {
        errors.push(`${at(i)}: participant id "${id}" must be one word (letters, digits, _); put the readable name after "as"`);
      } else if (id.includes("-")) {
        warnings.push(`${at(i)}: participant id "${id}" has a hyphen, which reads like an arrow; use letters, digits and _`);
      } else if (id.toLowerCase() === "end") {
        errors.push(`${at(i)}: "end" can't be a participant id; it closes a block`);
      }
      if (declared.has(id)) {
        warnings.push(`${at(i)}: participant "${id}" declared twice`);
      }
      if (used.has(id)) {
        warnings.push(`${at(i)}: participant "${id}" declared after it was used; declare everyone up front`);
      }
      declared.set(id, decl[3] ? decl[3].trim() : id);
      if (decl[3]) {
        textIssues(i, decl[3], "a participant label");
      }
      return;
    }
    if (/^(create|destroy)\s+/i.test(t)) {
      return;
    }
    const block = t.match(BLOCK_OPEN);
    if (block) {
      stack.push({ kind: block[1].toLowerCase(), line: i });
      maxDepth = Math.max(maxDepth, stack.filter(b => b.kind !== "rect" && b.kind !== "box").length);
      textIssues(i, t.slice(block[1].length), "a block label");
      return;
    }
    if (/^else\b/i.test(t) || /^and\b/i.test(t) || /^option\b/i.test(t)) {
      const word = t.split(/\s/)[0].toLowerCase();
      const want = { else: "alt", and: "par", option: "critical" }[word];
      const top = stack[stack.length - 1];
      if (!top || (top.kind !== want && !(word === "and" && top.kind === "par_over"))) {
        errors.push(`${at(i)}: "${word}" outside ${want}/end`);
      }
      textIssues(i, t.slice(word.length), "a block label");
      return;
    }
    if (/^end$/i.test(t)) {
      if (!stack.pop()) {
        errors.push(`${at(i)}: "end" without an open alt/opt/loop/par block`);
      }
      return;
    }
    if (/^(autonumber)\b/i.test(t)) {
      warnings.push(`${at(i)}: autonumber adds noise; notes already identify messages`);
      return;
    }
    if (/^(title|accTitle|accDescr)\b/i.test(t) || /^links?\s/i.test(t)) {
      return;
    }
    const act = t.match(/^(activate|deactivate)\s+(\S+)$/i);
    if (act) {
      use(i, act[2], act[1].toLowerCase());
      return;
    }
    const note = t.match(NOTE);
    if (note) {
      for (const id of note[2].split(",").map(s => s.trim())) {
        use(i, id, "a Note");
      }
      textIssues(i, note[3], "a Note");
      return;
    }
    if (/^note\b/i.test(t)) {
      errors.push(`${at(i)}: Note needs "left of", "right of" or "over" <participant>, then ":"`);
      return;
    }
    const msg = t.match(MESSAGE);
    if (msg) {
      const from = msg[1].trim();
      const to = msg[4].trim();
      if (/^[-<>=)]|[-<>=]$/.test(to) || /[<>=]$/.test(from)) {
        errors.push(`${at(i)}: bad arrow "${t.slice(0, t.indexOf(":"))}"; use ->> (call), -->> (reply) or -x (failure)`);
      } else {
        use(i, from, "a message");
        use(i, to, "a message");
      }
      textIssues(i, msg[5], "message text");
      return;
    }
    if (ARROWISH.test(t)) {
      errors.push(t.includes(":")
        ? `${at(i)}: bad arrow in "${t}"; use ->> (call), -->> (reply) or -x (failure)`
        : `${at(i)}: message without text; add ": what happens"`);
      return;
    }
    errors.push(`${at(i)}: Mermaid can't parse "${t.length > 60 ? t.slice(0, 59) + "…" : t}"`);
  });
  for (const b of stack) {
    errors.push(`${at(b.line)}: "${b.kind}" is never closed with "end"`);
  }
  if (maxDepth > 1) {
    warnings.push(`blocks nest ${maxDepth} deep; keep alt/opt/loop/par to one level`);
  }
  if (!declared.size && used.size) {
    warnings.push("no participant declarations; declare each one up front (participant <id> as <Label>) so typos are caught");
  }
  return { errors, warnings, participants: declared.size ? new Set(declared.keys()) : used };
}

// Validates a plan object. Returns { errors, warnings, flowCount }.
export function checkPlan(plan) {
  const errors = [];
  const warnings = [];
  const err = m => errors.push(m);
  const warn = m => warnings.push(m);

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
  if (plan.version != null && typeof plan.version !== "number") { warn("plan.version should be a number"); }
  if (!plan.kind) {
    warn('plan.kind is not set. Use "review" (findings with severity) or "plan" (an implementation plan: work items, no severity). It decides how items read.');
  } else if (!["review", "plan"].includes(plan.kind)) {
    warn(`plan.kind "${plan.kind}" is not review|plan`);
  }
  if (!Array.isArray(plan.areas) || !plan.areas.length) { err("plan.areas must be a non-empty array"); }

  checkIds(plan.areas, "areas");
  const typeIds = new Set(((plan.api || {}).types || []).map(t => t.id));

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
      const fb = `${b}/flows/${f.id}`;
      const src = String(f.mermaid || "").trim();
      if (!f.title) { err(`${fb}: missing title`); }
      if (!src) {
        err(`${fb}: empty mermaid`);
        continue;
      }
      const sequence = src.startsWith("sequenceDiagram");
      if (!sequence) {
        warn(`${fb}: not a sequenceDiagram; per-message notes only work on sequence diagrams (not linted; run verify.sh)`);
      }
      const lint = sequence ? lintSequence(src) : { errors: [], warnings: [], participants: null };
      lint.errors.forEach(m => err(`${fb} ${m}`));
      lint.warnings.forEach(m => warn(`${fb} ${m}`));
      for (const [pid, tid] of Object.entries(f.actors || {})) {
        if (!typeIds.has(tid)) { err(`${fb}: actors.${pid} → "${tid}" is not an api type id`); }
        if (lint.participants && !lint.participants.has(pid)) { warn(`${fb}: actors.${pid} is not a participant id`); }
      }
      if (lint.participants && lint.participants.size > 8) { warn(`${fb}: ${lint.participants.size} participants; split it into smaller flows`); }
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
  return { errors, warnings, flowCount };
}

// Loads and checks a plan.js file. Returns { plan, errors, warnings, flowCount }.
export function checkPlanFile(file) {
  let plan;
  try {
    const ctx = { window: {} };
    vm.runInNewContext(readFileSync(file, "utf8"), ctx, { filename: file, timeout: 2000 });
    plan = ctx.window.PLAN;
  } catch (e) {
    return { plan: null, errors: [`${file} does not run: ${e.message}`], warnings: [], flowCount: 0 };
  }
  if (!plan) {
    return { plan: null, errors: ["plan.js must set window.PLAN"], warnings: [], flowCount: 0 };
  }
  return { plan, ...checkPlan(plan) };
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node check.mjs path/to/plan.js");
    process.exit(2);
  }
  const { plan, errors, warnings, flowCount } = checkPlanFile(file);
  for (const w of warnings) { console.log(`! ${w}`); }
  for (const e of errors) { console.log(`✗ ${e}`); }
  if (errors.length) {
    console.log(`\n${errors.length} error(s) in ${file}`);
    process.exit(1);
  }
  const version = plan.version != null ? ` v${plan.version}` : "";
  console.log(`✓ ${plan.title}${version}: ${plan.areas.length} areas, ${flowCount} flows${warnings.length ? `, ${warnings.length} warning(s)` : ""}`);
}

const isMain = () => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch (e) {
    return false;
  }
};
if (process.argv[1] && isMain()) {
  main();
}
