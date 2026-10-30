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
  return parseFlow(src).msgs.length;
}

// Messages of a sequence diagram in order, with the anchors that `%% @name` lines directly above
// them give. anchors maps name → 0-based message index. problems: [{ level: "error"|"warning", text }].
export const ANCHOR_LINE = /^%%\s*@(\S+)\s*$/;
export function parseFlow(src) {
  const msgs = [];
  const anchors = {};
  const problems = [];
  const warnAt = text => problems.push({ level: "warning", text });
  let pending = null;
  for (const line of String(src || "").split("\n")) {
    const t = line.trim();
    const a = t.match(ANCHOR_LINE);
    if (a) {
      if (pending) {
        warnAt(`anchor @${pending} is not directly above a message`);
      }
      pending = a[1];
      if (!ID.test(pending)) {
        problems.push({ level: "error", text: `anchor @${pending} must be lowercase kebab-case` });
      }
      continue;
    }
    if (!t || t.startsWith("%%")) {
      continue;
    }
    if (MESSAGE.test(t)) {
      if (pending) {
        if (anchors[pending] != null) {
          problems.push({ level: "error", text: `anchor @${pending} is used twice` });
        } else {
          anchors[pending] = msgs.length;
        }
      }
      msgs.push(t);
    } else if (pending) {
      warnAt(`anchor @${pending} is not directly above a message`);
    }
    pending = null;
  }
  if (pending) {
    warnAt(`anchor @${pending} is not directly above a message`);
  }
  return { msgs, anchors, problems };
}

// One item model: areas[].items. The old issues / work / openQuestions lists are read as aliases.
export const ITEM_TYPES = ["bug", "risk", "new", "change", "remove", "decision", "question"];
export const ITEM_STATUSES = ["open", "doing", "done", "dropped"];
const LEGACY_STATUS = { todo: "open", fixing: "doing", fixed: "done", wontfix: "dropped" };
const LEGACY_TYPE = { issues: "bug", work: "change", openQuestions: "question" };
export const ITEM_LISTS = ["items", "issues", "work", "openQuestions"];
export function itemsOf(area, kind) {
  const out = [];
  for (const list of ITEM_LISTS) {
    for (const raw of (area && area[list]) || []) {
      if (!raw || typeof raw !== "object") {
        continue;
      }
      let type = LEGACY_TYPE[list];
      if (ITEM_TYPES.includes(raw.type)) {
        type = raw.type;
      } else if (list === "items") {
        type = kind === "review" ? "bug" : "change";
      }
      out.push({ raw, list, type, title: raw.title ?? raw.text, status: LEGACY_STATUS[raw.status] || raw.status || "open" });
    }
  }
  return out;
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
        checkSteps(i.steps, ib, f);
      }
    }
    for (const t of i.types || []) {
      if (!typeIds.has(t)) { err(`${ib}: types → "${t}" is not an api type id`); }
    }
    if (!i.flow && (a.flows || []).length && ["open", "doing"].includes(it.status) && !["remove", "decision", "question"].includes(it.type)) {
      warn(`${ib}: not linked to a flow (add flow + steps so it shows on the diagram)`);
    }
  }
  function checkSteps(steps, ib, f) {
    const { msgs, anchors } = f.parsed;
    const anchored = Object.keys(anchors).length > 0;
    for (const k of steps) {
      if (typeof k === "string" && !/^\d+$/.test(k)) {
        const name = k.replace(/^@/, "");
        if (anchors[name] == null) {
          err(`${ib}: step "${k}" is not an anchor in ${f.id} (known: ${Object.keys(anchors).map(x => "@" + x).join(", ") || "none"})`);
        }
      } else if (!Number.isInteger(Number(k)) || k < 1 || k > msgs.length) {
        err(`${ib}: step ${k} is outside 1..${msgs.length} (messages in ${f.id})`);
      } else if (anchored) {
        warn(`${ib}: step ${k} is a number in ${f.id}, which has anchors; numbers shift when a message is inserted above. Put \`%% @name\` above that message and use "name"`);
      }
    }
  }
  function checkFlow(f, b) {
    const fb = `${b}/flows/${f.id}`;
    const src = String(f.mermaid || "").trim();
    const parsed = parseFlow(src);
    if (!f.title) { err(`${fb}: missing title`); }
    if (!src) {
      err(`${fb}: empty mermaid`);
      return { id: f.id, parsed };
    }
    for (const p of parsed.problems) {
      (p.level === "error" ? err : warn)(`${fb}: ${p.text}`);
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
    return { id: f.id, parsed };
  }
  function checkItem(it, b, a, flows) {
    const i = it.raw;
    const ib = `${b}/items/${i.id}`;
    checkLinks(it, ib, a, flows);
    if (!it.title) { err(`${ib}: missing title`); }
    if (i.type != null && !ITEM_TYPES.includes(i.type)) { warn(`${ib}: type "${i.type}" is not ${ITEM_TYPES.join("|")}`); }
    if (i.status != null && !ITEM_STATUSES.includes(it.status)) { warn(`${ib}: status "${i.status}" is not ${ITEM_STATUSES.join("|")}`); }
    if (it.type !== "bug") {
      if (i.severity) { warn(`${ib}: severity only applies to bugs (findings in a review); this is a ${it.type}`); }
      return;
    }
    if (i.severity && !["high", "medium", "low"].includes(i.severity)) { warn(`${ib}: severity "${i.severity}" is not high|medium|low`); }
    if (i.origin && !["pre-existing", "introduced"].includes(i.origin)) { warn(`${ib}: origin "${i.origin}" is not pre-existing|introduced`); }
    if (!i.category) { warn(`${ib}: no category (name the subsystem affected)`); }
    if (!i.where) { warn(`${ib}: no where (file:line)`); }
    if (/^[A-Z]+-\d+\b/.test(it.title || "")) { warn(`${ib}: title starts with a tracker-style id; titles describe the problem`); }
    if (i.severity !== "low" && !i.how && !i.fix) { warn(`${ib}: no how (the fix)`); }
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
      flows.set(f.id, checkFlow(f, b));
    }
    const items = itemsOf(a, plan.kind);
    legacyLists += ["issues", "work", "openQuestions"].filter(k => Array.isArray(a[k])).length;
    checkIds(items.map(x => x.raw), `${b}/items`);
    for (const it of items) {
      checkItem(it, b, a, flows);
    }
    if (plan.kind === "plan" && items.some(x => x.type === "bug" && x.raw.severity && x.list !== "issues")) {
      warn(`${b}: plan.kind is "plan" but the area has bugs with severity; they read as review findings. Planned changes and risks use new|change|remove|risk.`);
    }
    for (const s of a.sections || []) {
      if (/^[A-Z]+-\d+\b/.test(s.title || "")) { warn(`${b}/sections/${s.id}: title "${s.title}" looks like an issue; use an item with type "bug"`); }
      if (!s.title) { err(`${b}/sections/${s.id}: missing title`); }
    }
  }
  if (legacyLists) { warn("uses the old issues/work/openQuestions lists (read as items). node scripts/migrate-plan.mjs converts them"); }
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
