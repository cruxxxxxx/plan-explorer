// Engine test for live bookkeeping: live.mjs appends window.PLAN_AUTO to the served plan.js, and the engine
// tags exactly those ids as Changed and shows the server's version and date. run-engine-test.sh appends:
//   window.PLAN_AUTO = { version: 4, updated: "2026-10-30", changed: [work op-log-table, flow reconnect, area sync, member sync-client/sync] }
localStorage.clear();
const out = [];
const ok = (name, cond, extra) => out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " :: " + extra : ""}`);
const wait = ms => new Promise(r => setTimeout(r, ms));
const q$ = sel => document.querySelector(sel);
const q$$ = sel => [...document.querySelectorAll(sel)];

async function run() {
  location.hash = "explore";
  await wait(2000);
  ok("auto: sidebar shows server version and date", q$("#side .pmeta").textContent.trim() === "v4 · 2026-10-30", q$("#side .pmeta").textContent);
  const tags = q$$("#page .tag.new").map(t => t.textContent);
  ok("auto: tags read Changed v4", tags.length > 0 && tags.every(t => t === "Changed v4"), tags.join(","));
  ok("auto: changed work item tagged", !!q$('[data-open-issue="local-store/op-log-table"] .tag.new'));
  ok("auto: unchanged work item untagged", !q$('[data-open-issue="local-store/view-from-log"] .tag.new'));
  ok("auto: changed flow tagged", !!q$('[data-flow="areas/sync/flows/reconnect"]') && !!q$('.flow-head .tag.new'));
  ok("auto: only the changed area header is tagged", q$$(".xhead").filter(h => h.querySelector(".tag.new")).map(h => h.querySelector(".xt").textContent).join() === "Sync protocol", q$$(".xhead").map(h => h.textContent.replace(/\s+/g, " ")).join(" | "));
  location.hash = "api/sync-client";
  await wait(1200);
  ok("auto: changed API member tagged", q$$("#page .msig .tag.new").length === 1, String(q$$("#page .msig .tag.new").length));
}
run().catch(e => out.push("FAIL exception " + e.stack)).finally(() => {
  q$("#results").textContent = out.join("\n");
});
