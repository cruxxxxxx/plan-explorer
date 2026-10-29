// Dumps what a plan renders as, so two plan.js files can be compared (tests/migrate-test.sh):
// every Explore page (open and all statuses), the API pages, the roadmap, and every item's drawer.
// Step dots are recorded by message position, not nid, so anchored and numeric steps compare equal.
localStorage.clear();
const lines = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
const q$ = sel => document.querySelector(sel);
const q$$ = sel => [...document.querySelectorAll(sel)];
const norm = s => String(s || "").replace(/\s+/g, " ").trim();

function snapshot(label) {
  const page = q$("#page");
  lines.push(`## ${label}`);
  lines.push(norm(page.innerText));
  for (const r of q$$("#page .irow")) {
    lines.push(`row ${r.getAttribute("data-open-issue")} ${r.className}`);
  }
  for (const d of q$$("#page .stepdot")) {
    const flow = d.closest(".canvas").getAttribute("data-flow");
    lines.push(`dot ${flow}#${window.planExplorer.msgIndex(d.getAttribute("data-nid"))} ${d.getAttribute("class")} ${norm(d.textContent)}`);
  }
}
async function go(hash) {
  location.hash = hash;
  await wait(1200);
}
async function run() {
  const P = window.PLAN;
  for (const status of ["open", "all"]) {
    await go("explore");
    const btn = q$(`[data-ex="status:${status}"]`);
    if (btn) {
      btn.click();
      await wait(600);
    }
    snapshot(`explore ${status}`);
    for (const a of P.areas) {
      await go(`explore/${a.id}`);
      snapshot(`area ${a.id} ${status}`);
    }
  }
  await go("explore");
  for (const row of q$$("#page .irow")) {
    row.click();
    lines.push(`## drawer ${row.getAttribute("data-open-issue")}`);
    lines.push(norm(q$("#drawer .dr-body").innerText));
  }
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  if (P.api && (P.api.types || []).length) {
    await go("api");
    snapshot("api");
    for (const t of P.api.types) {
      await go(`api/${t.id}`);
      snapshot(`api ${t.id}`);
    }
  }
  await go("roadmap");
  snapshot("roadmap");
}
addEventListener("load", () => {
  run().catch(e => lines.push("FAIL exception " + e.stack)).finally(() => {
    q$("#results").textContent = lines.join("\n");
  });
});
