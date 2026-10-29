// Page side of the live bridge test. The shell (live-test.sh) plays the agent.
const out = [];
const ok = (name, cond, extra) => {
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " :: " + extra : ""}`);
  document.querySelector("#results").textContent = out.join("\n") + "\n…";
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const q$ = sel => document.querySelector(sel);
async function until(fn, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) {
      return true;
    }
    await wait(150);
  }
  return false;
}
async function run() {
  ok("live badge shows", await until(() => !!q$("#side .live")), q$("#side .live") ? q$("#side .live").textContent : "");
  ok("token stripped from URL", !location.search.includes("t="));
  ok("diagrams render under the CSP", await until(() => !!document.querySelector("svg text.messageText")));
  ok("no export button in sidebar", !q$('#side [data-act="export"]'));
  location.hash = "explore/local-store";
  await wait(1500);
  const p = q$('[data-nid="areas/local-store/summary/p0"]');
  p.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true, clientX: 300, clientY: 200 }));
  ok("popover says Send", q$('#pop [data-pop="save"]').textContent === "Send");
  q$("#pop textarea").value = "? why a materialized view";
  q$("#pop textarea").dispatchEvent(new Event("input", { bubbles: true }));
  q$('#pop [data-pop="save"]').click();
  ok("note saved on send", JSON.parse(localStorage.getItem("pe:offline-sync:notes") || "[]").length === 1);
  location.hash = "notes";
  ok("card shows asking", await until(() => !!q$(".ncard .st-asking")));
  ok("working reply streams in", await until(() => !!q$(".ncard .reply.working")), "");
  ok("final reply shown", await until(() => q$(".ncard .reply") && q$(".ncard .reply").textContent.includes("Reads stay local")));
  ok("asking badge cleared", !q$(".ncard .st-asking"));
  ok("plan hot-reloads", await until(() => q$("#side .pmeta").textContent.includes("v3")), q$("#side .pmeta").textContent);
  ok("reloaded content", await until(() => {
    location.hash = "explore/local-store";
    return !!q$('[data-nid="areas/local-store/summary/p0"]') && q$('[data-nid="areas/local-store/summary/p0"]').textContent.includes("LIVE-EDIT");
  }));
}
run().catch(e => out.push("FAIL exception " + e.stack)).finally(() => {
  q$("#results").textContent = out.join("\n");
  document.title = "DONE";
});
