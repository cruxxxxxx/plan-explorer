// Engine test against tests/fixtures/legacy-review.js: the old issues / openQuestions shape still renders as
// before, and notes saved against the old nids (issues/…, questions/…, cause/fix) land on the new ones.
const out = [];
const ok = (name, cond, extra) => out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " :: " + extra : ""}`);
const wait = ms => new Promise(r => setTimeout(r, ms));
const q$ = sel => document.querySelector(sel);
const q$$ = sel => [...document.querySelectorAll(sel)];
const NOTES_KEY = "pe:offline-sync:notes";
const note = (id, nid, quote) => ({ id, mark: "?", status: "open", text: id, anchor: { nid, kind: "element", quote, label: "x" }, created: "", updated: "" });

// Notes load with the page, so seed them and reload once.
const seeded = localStorage.getItem("ctest-seeded") === "1";
if (!seeded) {
  localStorage.clear();
  localStorage.setItem(NOTES_KEY, JSON.stringify([
    note("n-issue", "areas/local-store/issues/append-not-durable", "Append returns before the op is durable"),
    note("n-fix", "areas/local-store/issues/append-not-durable/fix/p0", "Open the log connection"),
    note("n-cause", "areas/local-store/issues/append-not-durable/cause/p0", "resolves after"),
    note("n-q", "areas/local-store/questions/compaction", "When do we compact the op log"),
    note("n-ans", "areas/local-store/questions/limits/answer", "Soft cap of 10k ops")
  ]));
  localStorage.setItem("ctest-seeded", "1");
  location.reload();
}

async function run() {
  location.hash = "explore/local-store";
  await wait(2500);
  ok("legacy issues render as rows under flows", !!q$('.irows.inflow [data-open-issue="local-store/append-not-durable"]'));
  ok("severity tone kept", q$('[data-open-issue="local-store/append-not-durable"]').classList.contains("sev-high"));
  ok("step dot from numeric step", !!q$('.stepdot.sev-high[data-nid="areas/local-store/flows/edit-offline/msg/1"]'));
  ok("legacy open question listed as a question row", !!q$('[data-open-issue="local-store/compaction"].ty-question'));
  ok("answered question is done (hidden while Open)", !q$('[data-open-issue="local-store/limits"]'));
  ok("question rows aren't counted", /Open 2/.test(q$('[data-ex="status:open"]').textContent), q$('[data-ex="status:open"]').textContent);
  q$('[data-open-issue="local-store/append-not-durable"]').click();
  const d = q$("#drawer").textContent;
  ok("drawer keeps bug labels (Cause, Fix)", /Cause/.test(d) && /Fix/.test(d) && /When/.test(d) && !/Why|How\b/.test(d));
  ok("item nid is items/…", !!q$('#drawer [data-nid="areas/local-store/items/append-not-durable/how/p0"]'));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  location.hash = "notes";
  await wait(1000);
  let captured = null;
  const orig = URL.createObjectURL;
  URL.createObjectURL = b => {
    captured = b;
    return orig.call(URL, b);
  };
  q$('[data-act="export"]').click();
  const j = JSON.parse(await captured.text());
  const by = id => j.notes.find(n => n.id === id);
  ok("old issue nid → items, ok", by("n-issue").anchorState === "ok" && by("n-issue").nid === "areas/local-store/items/append-not-durable", JSON.stringify(by("n-issue")));
  ok("old fix nid → how, ok", by("n-fix").anchorState === "ok" && by("n-fix").nid === "areas/local-store/items/append-not-durable/how/p0", by("n-fix").nid);
  ok("old cause nid → why, ok", by("n-cause").anchorState === "ok" && by("n-cause").nid === "areas/local-store/items/append-not-durable/why/p0", by("n-cause").nid);
  ok("old question nid → items, ok", by("n-q").anchorState === "ok" && by("n-q").nid === "areas/local-store/items/compaction", by("n-q").nid);
  ok("old answer nid → items/…/answer/p0, ok", by("n-ans").anchorState === "ok" && by("n-ans").nid === "areas/local-store/items/limits/answer/p0", by("n-ans").nid);
  ok("originalNid kept", by("n-fix").originalNid === "areas/local-store/issues/append-not-durable/fix/p0");
  localStorage.removeItem("ctest-seeded");
}
addEventListener("load", () => {
  if (!seeded) {
    return;
  }
  run().catch(e => out.push("FAIL exception " + e.stack)).finally(() => {
    q$("#results").textContent = out.join("\n");
  });
});
