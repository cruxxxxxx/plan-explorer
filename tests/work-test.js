// Engine test against examples/plan/plan.js: an implementation plan reads as work, not as a bug report.
// Also checks the API tree on deep paths.
localStorage.clear();
const out = [];
const ok = (name, cond, extra) => out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " :: " + extra : ""}`);
const wait = ms => new Promise(r => setTimeout(r, ms));
const q$ = sel => document.querySelector(sel);
const q$$ = sel => [...document.querySelectorAll(sel)];

async function run() {
  location.hash = "explore";
  await wait(2500);
  const page = q$("#page");
  ok("no severity anywhere", !page.querySelector('[class*="sev-"]') && !/Severity/.test(page.textContent));
  ok("filters folded by default", !q$(".fpanel"));
  q$('[data-act="facets"]').click();
  await wait(200);
  ok("Type facet instead", q$$(".fpanel .kicker").some(k => k.textContent === "Type") && !q$$(".fpanel .kicker").some(k => k.textContent === "Severity"));
  q$('[data-act="facets"]').click();
  await wait(200);
  ok("kind chip says Work", q$$('[data-ex="kind:issue"]').some(b => b.textContent === "Work"));
  ok("status chips say To do / Done", !!q$$('[data-ex="status:open"]').find(b => b.textContent.startsWith("To do")) && !!q$$('[data-ex="status:closed"]').find(b => b.textContent.startsWith("Done")));
  ok("work rows under flows", !!q$('.irows.inflow [data-open-issue="local-store/op-log-table"]'));
  ok("rows stay quiet (no file names)", !q$("#page .irow .im code"));
  ok("row tone by type", q$('[data-open-issue="local-store/op-log-table"]').classList.contains("ty-new") && q$('[data-open-issue="local-store/append-durability"]').classList.contains("ty-risk"));
  ok("work ordered by step", (() => {
    const ids = q$$('.irows.inflow [data-open-issue^="local-store/"]').map(b => b.dataset.openIssue.split("/")[1]);
    return ids.indexOf("view-from-log") > ids.indexOf("op-log-table");
  })());
  ok("done work hidden by default", !q$('[data-open-issue="sync/cursor-storage"]'));
  ok("step dot uses type tone", !!q$('.stepdot.ty-new') || !!q$('.stepdot.ty-risk'), q$$(".stepdot").map(g => g.getAttribute("class")).join(","));
  ok("area pills by type", !!q$('.xpills [data-ex="type:new"]') && !q$('.xpills [data-ex^="sev:"]'));
  q$('[data-ex="type:risk"]').click();
  await wait(300);
  ok("type filter", q$$("#page .irow").length === 1 && !!q$('[data-open-issue="local-store/append-durability"]'));
  ok("active filter pill shows", !!q$('.factive .fpill[data-ex="type:risk"]'));
  q$('.factive .fpill[data-ex="type:risk"]').click();
  await wait(300);
  ok("pill clears filter", !q$(".factive") && q$$("#page .irow").length > 1);
  q$('[data-open-issue="local-store/op-log-table"]').click();
  ok("drawer steps through items", /1 \/ \d+/.test(q$(".dr-nav").textContent));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
  ok("j goes to next item", /2 \/ \d+/.test(q$(".dr-nav").textContent));
  q$('[data-open-issue="local-store/append-durability"]').click();
  ok("drawer shows work fields", /Mitigation/.test(q$("#drawer").textContent) && /Risk/.test(q$("#drawer").textContent) && !/Severity|High|Medium/.test(q$("#drawer").textContent));
  ok("work nid", !!q$('#drawer [data-nid="areas/local-store/work/append-durability"]'));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  ok("sidebar count title", /open work/.test(q$("#side .cnt").getAttribute("title") || ""));

  // ── API tree on deep paths ──
  window.PLAN.api.types.push(
    { id: "deep-a", name: "CellLogicRunner", kind: "class", source: "src/game/grid/cells/logic/runtime/CellLogicRunner.ts", summary: "x", members: [] },
    { id: "deep-b", name: "CellLogicCache", kind: "class", source: "src/game/grid/cells/logic/runtime/CellLogicCache.ts", summary: "x", members: [] }
  );
  location.hash = "api";
  await wait(1500);
  const dirs = q$$("#apitree .tdh .dl").map(e => e.textContent);
  ok("single-child chain compacted", dirs.includes("game/grid/cells/logic/runtime"), dirs.join(" | "));
  const row = q$('#apitree a[href="#api/deep-a"]');
  const tree = q$("#apitree");
  const indent = row.getBoundingClientRect().left - tree.getBoundingClientRect().left;
  ok("deep row indent stays small", indent < 40, `${Math.round(indent)}px`);
  const tn = row.querySelector(".tn");
  ok("type name not truncated", tn.scrollWidth <= tn.clientWidth + 1, `${tn.scrollWidth} vs ${tn.clientWidth}`);
}
addEventListener("load", () => {
  run().catch(e => out.push("FAIL exception " + e.stack)).finally(() => {
    q$("#results").textContent = out.join("\n");
  });
});
