// Engine test for history.json: a page served without the live server's PLAN_AUTO line fetches history.json
// next to plan.js and shows its version, date and Changed tags. run-engine-test.sh appends a fetch stub to
// plan.js that answers "history.json" with { version: 7, updated: "2026-11-02", changed: [item view-from-log] }.
localStorage.clear();
const out = [];
const ok = (name, cond, extra) => out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " :: " + extra : ""}`);
const wait = ms => new Promise(r => setTimeout(r, ms));
const q$ = sel => document.querySelector(sel);
const q$$ = sel => [...document.querySelectorAll(sel)];

async function run() {
  location.hash = "explore";
  await wait(2000);
  ok("history: engine fetched history.json", window.PLAN_AUTO && window.PLAN_AUTO.version === 7);
  ok("history: sidebar shows history version and date", q$("#side .pmeta").textContent.trim() === "v7 · 2026-11-02", q$("#side .pmeta").textContent);
  ok("history: changed item tagged Changed v7", !!q$('[data-open-issue="local-store/view-from-log"] .tag.new') && q$('[data-open-issue="local-store/view-from-log"] .tag.new').textContent === "Changed v7");
  ok("history: unchanged item untagged", !q$('[data-open-issue="local-store/op-log-table"] .tag.new'));
  ok("history: only one Changed tag on Explore (rev ignored for other versions)", q$$("#page .tag.new").length === 1, String(q$$("#page .tag.new").length));
}
run().catch(e => out.push("FAIL exception " + e.stack)).finally(() => {
  q$("#results").textContent = out.join("\n");
});
