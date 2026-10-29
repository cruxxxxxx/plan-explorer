#!/usr/bin/env node
// Static Mermaid lint (check.mjs) against cases calibrated on real Mermaid: every diagram Mermaid rejects
// must be an error, and valid syntax must not be. No browser needed.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lintSequence, checkPlan, checkPlanFile } from "../scripts/check.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const head = "sequenceDiagram\n  participant A as Alpha\n  participant B as Beta\n  ";
let fails = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && extra ? " :: " + extra : ""}`);
  if (!cond) {
    fails++;
  }
};

// Mermaid fails to render these (checked in headless Chrome with the engine's pinned Mermaid).
const broken = {
  "semicolon in message": "A->>B: load; then save",
  "message without text": "A->>B",
  "triple arrow": "A->>>B: x",
  "fat arrow": "A=>>B: x",
  "dash dash without head": "A--B: x",
  "alt never closed": "alt x\n  A->>B: y",
  "stray end": "A->>B: y\n  end",
  "else outside alt": "A->>B: y\n  else z",
  "end as participant id": "participant end as End\n  A->>end: y",
  "note without position": "Note A: hi",
  "activate unknown participant": "activate C\n  A->>B: x"
};
// Mermaid renders these, but they break the skill's rules (a typo makes a ghost participant).
const ruleErrors = {
  "unknown participant in message": "A->>C: x",
  "unknown participant in note": "Note over Z: hi",
  "participant name with a space": "A->>B C: x"
};
// Valid: must produce no errors.
const valid = {
  "call": "A->>B: hello",
  "reply": "B-->>A: ok",
  "open arrow": "A->B: plain",
  "async": "A-)B: async",
  "failure": "A--xB: fail",
  "activation shorthand": "A->>+B: go\n  B-->>-A: back",
  "lowercase note": "note over A: hi",
  "note over two": "Note over A,B: shared",
  "colon in text": "A->>B: a: b",
  "quotes": "A->>B: say \"hi\"",
  "ampersand and percent": "A->>B: a & b, 50% done",
  "br": "A->>B: one<br>two",
  "hash without semicolon": "A->>B: issue #12",
  "blocks": "alt conflict\n    A->>A: merge\n  else clean\n    A->>B: apply\n  end\n  loop each op\n    B->>A: apply op\n  end\n  par one\n    A->>B: x\n  and two\n    B->>A: y\n  end",
  "activate declared": "activate B\n  A->>B: x\n  deactivate B",
  "comment": "%% a comment; with # chars\n  A->>B: x",
  "create and destroy": "create participant C as Cache\n  A->>C: fill\n  destroy C\n  C-->>A: gone"
};
for (const [name, body] of Object.entries(broken)) {
  const r = lintSequence(head + body);
  check(`lint catches: ${name}`, r.errors.length > 0, JSON.stringify(r.warnings));
}
for (const [name, body] of Object.entries(ruleErrors)) {
  check(`lint flags: ${name}`, lintSequence(head + body).errors.length > 0);
}
for (const [name, body] of Object.entries(valid)) {
  const r = lintSequence(head + body);
  check(`lint accepts: ${name}`, r.errors.length === 0, r.errors.join("; "));
}
check("lint errors carry the line number", /^line 4: /.test(lintSequence(head + "A->>B: x; y").errors[0] || ""));
check("lint warns on nesting deeper than one", lintSequence(head + "alt a\n  loop b\n  A->>B: x\n  end\n  end").warnings.some(w => /nest/.test(w)));
check("lint warns on raw < >", lintSequence(head + "A->>B: a < b").warnings.length === 1);

// Through checkPlan: lint errors are reported per flow, and steps count the same messages.
const plan = {
  id: "t", kind: "plan", title: "T",
  areas: [{ id: "a", title: "A", flows: [{ id: "f", title: "F", mermaid: head + "A->>B: one\n  B-->>A: two; three" }],
    work: [{ id: "w", title: "W", flow: "f", steps: [2] }] }]
};
const r = checkPlan(plan);
check("checkPlan reports flow lint with its path", r.errors.some(e => e.startsWith("areas/a/flows/f line 5: \";\"")), r.errors.join("; "));
check("version is optional (bookkeeping is automatic)", !r.warnings.some(w => /version/.test(w)), r.warnings.join("; "));
for (const ex of ["examples/plan/plan.js", "examples/review/plan.js"]) {
  const res = checkPlanFile(path.join(root, ex));
  check(`${ex} passes the lint`, res.errors.length === 0, res.errors.join("; "));
}
process.exit(fails ? 1 : 0);
