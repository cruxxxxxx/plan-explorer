// Engine test against examples/plan/plan.js: step anchors keep items (and notes) on their message
// when a message is inserted above them; numeric steps shift.
const out = [];
const ok = (name, cond, extra) => out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " :: " + extra : ""}`);
const wait = ms => new Promise(r => setTimeout(r, ms));
const q$ = sel => document.querySelector(sel);
const q$$ = sel => [...document.querySelectorAll(sel)];
const FLOW = "areas/local-store/flows/edit-offline";
const NOTES_KEY = "pe:offline-sync-build:notes";
// Notes load with the page, so seed them and reload once: one on the anchored message, and one saved
// with an old numeric nid on the same message.
const seeded = localStorage.getItem("atest-seeded") === "1";
if (!seeded) {
  localStorage.clear();
  localStorage.setItem(NOTES_KEY, JSON.stringify([
    { id: "na", mark: "!", status: "open", text: "anchored", anchor: { nid: `${FLOW}/msg/@append-op-insert`, kind: "element", quote: "append op (insert, pos, text)", label: "x" }, created: "", updated: "" },
    { id: "nn", mark: "?", status: "open", text: "numeric", anchor: { nid: `${FLOW}/msg/1`, kind: "element", quote: "append op (insert, pos, text)", label: "x" }, created: "", updated: "" }
  ]));
  localStorage.setItem("atest-seeded", "1");
  location.reload();
}
async function exported() {
  let captured = null;
  const orig = URL.createObjectURL;
  URL.createObjectURL = b => {
    captured = b;
    return orig.call(URL, b);
  };
  q$('[data-act="export"]').click();
  URL.createObjectURL = orig;
  return JSON.parse(await captured.text());
}

// The message whose step holds the given item: clicking a step opens its item (or the step's list) in the drawer.
function messageOf(itemTitle) {
  for (const text of q$$(`.canvas[data-flow="${FLOW}"] text.messageText`)) {
    text.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const hit = !q$("#drawer").hidden && q$("#drawer").textContent.includes(itemTitle);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (hit) { return text.textContent; }
  }
  return null;
}

async function run() {
  const { parseSeq, msgIndex } = window.planExplorer;
  const p = parseSeq("sequenceDiagram\n  A->>B: one\n  %% @two\n  B->>C: two\n  %% @orphan\n  Note over A: x\n  C->>A: three");
  ok("parseSeq reads anchors", p.anchors.two === 1 && p.msgs[1].anchor === "two" && p.anchors.orphan == null && !p.msgs[2].anchor);

  const area = window.PLAN.areas.find(a => a.id === "local-store");
  const flow = area.flows.find(f => f.id === "edit-offline");
  area.items.push({ id: "numeric-probe", type: "change", title: "Numeric probe", flow: "edit-offline", steps: [2] });
  location.hash = "explore/local-store";
  await wait(2500);

  const appendEl = q$$(`.canvas[data-flow="${FLOW}"] text.messageText`).find(t => t.textContent.startsWith("append op"));
  ok("anchored message nid", appendEl && appendEl.getAttribute("data-nid") === `${FLOW}/msg/@append-op-insert`, appendEl && appendEl.getAttribute("data-nid"));
  ok("msgIndex resolves anchor", msgIndex(`${FLOW}/msg/@append-op-insert`) === 1);
  ok("unanchored message keeps a numeric nid", !!q$(`.canvas[data-flow="${FLOW}"] text.messageText[data-nid="${FLOW}/msg/0"]`));
  ok("before insert: anchored item on 'append op'", /^append op/.test(messageOf("Op log table") || ""), messageOf("Op log table"));
  ok("before insert: numeric item on 'append op' too", /^append op/.test(messageOf("Numeric probe") || ""), messageOf("Numeric probe"));
  ok("old numeric note nid resolves to the anchor", appendEl.classList.contains("pe-has-svg"));

  // Insert a message above everything, as an agent editing the plan would.
  flow.mermaid = flow.mermaid.replace("  U->>UI: types a sentence", "  U->>UI: opens a note\n  U->>UI: types a sentence");
  location.hash = "explore";
  await wait(300);
  location.hash = "explore/local-store";
  await wait(2500);

  ok("after insert: anchored item stays on 'append op'", /^append op/.test(messageOf("Op log table") || ""), messageOf("Op log table"));
  ok("after insert: anchored risk stays too", /^append op/.test(messageOf("Append must be durable") || ""), messageOf("Append must be durable"));
  ok("after insert: anchored multi-step item stays", /^apply op/.test(messageOf("Note view reads") || ""), messageOf("Note view reads"));
  ok("after insert: numeric item shifted to 'types a sentence'", messageOf("Numeric probe") === "types a sentence", messageOf("Numeric probe"));
  const drawerStep = (() => {
    q$('[data-open-issue="local-store/op-log-table"]').click();
    const t = q$("#drawer").textContent;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return t;
  })();
  ok("drawer shows the new step number", /step 3\b/.test(drawerStep));
  const appendAfter = q$$(`.canvas[data-flow="${FLOW}"] text.messageText`).find(t => t.textContent.startsWith("append op"));
  ok("anchored note still on its message", appendAfter.classList.contains("pe-has-svg"));
  location.hash = "notes";
  await wait(800);
  const j = await exported();
  const by = id => j.notes.find(n => n.id === id);
  ok("anchored note: ok on @append-op-insert", by("na").anchorState === "ok" && by("na").nid === `${FLOW}/msg/@append-op-insert`, JSON.stringify(by("na")));
  ok("numeric-nid note: lands on the same message", by("nn").nid === `${FLOW}/msg/@append-op-insert` && by("nn").anchorState !== "orphaned", `${by("nn").anchorState} ${by("nn").nid}`);
  localStorage.removeItem("atest-seeded");
}
addEventListener("load", () => {
  if (!seeded) {
    return;
  }
  run().catch(e => out.push("FAIL exception " + e.stack)).finally(() => {
    q$("#results").textContent = out.join("\n");
  });
});
