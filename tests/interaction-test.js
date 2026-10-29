// Headless interaction test for the v2 engine against examples/plan.js.
// Drives the page with synthetic DOM events and writes PASS/FAIL lines into #results.
if (localStorage.getItem("itest-phase") !== "2") { localStorage.clear(); }
const out = [];
const ok = (name, cond, extra) => out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " :: " + extra : ""}`);
const wait = ms => new Promise(r => setTimeout(r, ms));
const q$ = sel => document.querySelector(sel);
const q$$ = sel => [...document.querySelectorAll(sel)];
const click = sel => q$(sel).click();
const notesNow = () => JSON.parse(localStorage.getItem("pe:offline-sync:notes") || "[]");
const altClick = (el, x = 300, y = 300) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true, clientX: x, clientY: y }));
const pop = () => document.getElementById("pop");
function saveNote(text) {
  pop().querySelector("textarea").value = text;
  pop().querySelector("textarea").dispatchEvent(new Event("input", { bubbles: true }));
  pop().querySelector('[data-pop="save"]').click();
}

async function phase1() {
  location.hash = "explore/local-store";
  await wait(2500);
  // ── notes on prose, svg, selection ──
  const p = q$('[data-nid="areas/local-store/summary/p0"]');
  altClick(p, 300, 200);
  ok("alt-click opens popover", !pop().hidden && pop().textContent.includes("Local store › Summary › ¶1"));
  pop().querySelector("textarea").value = "? why sqlite";
  pop().querySelector("textarea").dispatchEvent(new Event("input", { bubbles: true }));
  ok("prefix highlights mark", pop().querySelector('[data-mark="?"]').classList.contains("on"));
  pop().querySelector('[data-pop="save"]').click();
  let ns = notesNow();
  ok("note saved", ns.length === 1 && ns[0].mark === "?" && ns[0].text === "why sqlite");
  ok("pin drawn", q$$("#pins .pin").length === 1);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
  ok("note mode on", document.body.classList.contains("notemode"));
  const msg = q$('text.messageText[data-nid="areas/local-store/flows/edit-offline/msg/1"]');
  ok("svg message stamped", !!msg);
  msg.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 500, clientY: 500 }));
  ok("note-mode click on step opens popover (not drawer)", !pop().hidden && document.getElementById("drawer").hidden);
  pop().querySelector('[data-mark="!"]').click();
  saveNote("fsync this");
  ok("svg note saved", notesNow().some(n => n.anchor.nid.endsWith("edit-offline/msg/1")));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  ok("note mode off", !document.body.classList.contains("notemode"));
  const li = q$('[data-nid="areas/local-store/sections/op-format/li0"]');
  const tn = [...li.childNodes].find(n => n.nodeType === 3 && n.data.includes("orders"));
  const r = document.createRange();
  const i = tn.data.indexOf("orders ops");
  r.setStart(tn, i);
  r.setEnd(tn, i + "orders ops".length);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
  li.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  await wait(50);
  ok("selection shows button", !q$("#selbtn").hidden);
  q$("#selbtn").click();
  saveNote("+ batch per burst");
  ns = notesNow();
  const tnote = ns.find(n => n.anchor.kind === "text");
  ok("text note quote", tnote && tnote.anchor.quote === "orders ops" && tnote.mark === "+");
  ok("quote wrapped in mark", !!q$("mark.pe-q"));
  q$("mark.pe-q").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
  ok("mark opens existing note", !pop().hidden && pop().querySelector("textarea").value === "batch per burst");
  pop().querySelector('[data-pop="resolve"]').click();
  ok("resolve", notesNow().find(n => n.anchor.kind === "text").status === "resolved");

  // ── coupling: step dots, tooltips, drawer ──
  const dot = q$('#page .stepdot[data-nid="areas/local-store/flows/edit-offline/msg/1"]');
  ok("step dot on linked step", !!dot && dot.classList.contains("sev-high"));
  ok("no dot on unlinked step", !q$('#page .stepdot[data-nid="areas/local-store/flows/edit-offline/msg/0"]'));
  msg.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: 400, clientY: 400 }));
  await wait(200);
  ok("tooltip on step shows issue", !q$("#tip").hidden && q$("#tip").textContent.includes("Append returns before the op is durable"));
  const actor = q$('#page [data-type="op-log"]');
  ok("actor linked to type", !!actor);
  actor.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: 400, clientY: 300 }));
  await wait(200);
  ok("tooltip on actor shows type", q$("#tip").textContent.includes("OpLog") && q$("#tip").textContent.includes("Append-only log"));
  msg.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  ok("click step opens issue drawer", !q$("#drawer").hidden && q$("#drawer").textContent.includes("synchronous=NORMAL"));
  click('#drawer [data-open-type="op-log"]');
  ok("drawer → type", q$("#drawer").textContent.includes("Append-only log") && !!q$('#drawer [data-dr="back"]'));
  click('#drawer [data-dr="back"]');
  ok("drawer back", q$("#drawer").textContent.includes("synchronous=NORMAL"));
  const fixEl = q$('#drawer [data-nid="areas/local-store/issues/append-not-durable/fix/p0"]');
  altClick(fixEl);
  saveNote("! needs a migration too");
  ok("note on issue field in drawer", notesNow().some(n => n.anchor.nid === "areas/local-store/issues/append-not-durable/fix/p0"));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  ok("Esc closes drawer", q$("#drawer").hidden);

  // ── explore filters ──
  ok("issue rows under their flow", !!q$('#page .irows.inflow [data-open-issue="local-store/append-not-durable"]'));
  ok("loose issues hidden when fixed", !q$('#page [data-open-issue="local-store/migration-log-noise"]'));
  click('#page .xpills [data-ex="sev:high"]');
  await wait(300);
  ok("severity pill filters", q$$("#page .irow").length === 1 && !!q$('#page [data-open-issue="local-store/append-not-durable"]'));
  click('#page .xpills [data-ex="sev:high"]');
  await wait(300);
  ok("severity pill toggles off", q$$("#page .irow").length === 2);
  click('[data-ex="kind:issue"]');
  await wait(300);
  ok("show issues only", q$$("#page figure.flow").length === 0 && q$$("#page .irow").length === 2);
  click('[data-ex="status:all"]');
  await wait(300);
  ok("status all includes fixed", q$$("#page .irow").length === 3);
  const exq = q$("#exq");
  exq.value = "compaction";
  exq.dispatchEvent(new Event("input", { bubbles: true }));
  ok("search filters", q$$("#page .irow").length === 1);
  exq.value = "";
  exq.dispatchEvent(new Event("input", { bubbles: true }));
  click('[data-ex="kind:all"]');
  click('[data-ex="status:open"]');
  await wait(300);

  // ── pan & zoom ──
  const canvas = q$('#page .canvas[data-flow="areas/local-store/flows/edit-offline"]');
  const before = canvas.querySelector(".pz").style.transform;
  canvas.querySelector('[data-pz="in"]').click();
  ok("zoom in changes transform", canvas.querySelector(".pz").style.transform !== before);
  canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -50, clientX: 500, clientY: 500 }));
  ok("pinch zoom (ctrl+wheel)", canvas.classList.contains("zoomed"));
  canvas.querySelector('[data-pz="fit"]').click();
  ok("fit resets", !canvas.classList.contains("zoomed"));
  canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 400, clientY: 400 }));
  document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 460, clientY: 420 }));
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  msg.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  ok("drag suppresses the click after it", q$("#drawer").hidden);
  await wait(120);
  canvas.querySelector('[data-pz="full"]').click();
  ok("full screen lightbox", !q$("#lightbox").hidden && !!q$("#lightbox .pz svg"));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  // ── API explorer ──
  localStorage.setItem("pe:apiLevel", "sigs");
  location.hash = "api";
  await wait(2500);
  ok("api tree lists types", q$$("#apitree .trow").length === 4);
  ok("api graph rendered", !!q$('#page .canvas[data-flow="api/graph"] svg'));
  const apiq = q$("#apiq");
  apiq.value = "cursor";
  apiq.dispatchEvent(new Event("input", { bubbles: true }));
  ok("tree filter", q$$("#apitree .trow").length === 3, q$$("#apitree .trow .tn").map(e => e.textContent).join(","));
  apiq.value = "";
  apiq.dispatchEvent(new Event("input", { bubbles: true }));
  click('#apitree [data-tree-dir="store"]');
  ok("tree folder folds", !q$('#apitree a[href="#api/op-log"]'));
  click('#apitree [data-tree-dir="store"]');
  q$('#page g.node[data-goto-type="sqlite-db"]').dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await wait(2000);
  ok("graph node opens type", location.hash === "#api/sqlite-db" && q$(".tdetail .type-name").textContent === "SqliteDb");
  location.hash = "api/op-log";
  await wait(2000);
  ok("type page: members", !!q$('[data-nid="api/op-log/m/append"]') && !q$('[data-nid="api/op-log/m/append/param/op"]'));
  ok("type page: depends on + used by", /Depends on/.test(q$(".tdetail").textContent) && /Used by\s*SyncClient/.test(q$(".tdetail").textContent));
  ok("type page: issues by file", q$$(".tdetail .irow").length === 2);
  ok("type page: in flows", q$(".tdetail").textContent.includes("Editing while offline"));
  ok("type page: neighbourhood graph", !!q$('#page .canvas[data-flow="api/op-log/graph"] svg'));
  click('[data-api-level="full"]');
  await wait(300);
  ok("full level shows params", !!q$('[data-nid="api/op-log/m/append/param/op"]'));
  const tx = q$('[data-nid="api/op-log/m/compact"]');
  altClick(tx);
  saveNote("? acked cursor only");
  ok("note on api member", notesNow().some(n => n.anchor.nid === "api/op-log/m/compact"));

  // stash for phase 2: a note whose nid is gone but quote survives
  const n0 = notesNow();
  n0.push({ id: "nx", mark: "?", status: "open", text: "moved?", anchor: { nid: "areas/local-store/old-id", kind: "text", quote: "materialized view", label: "x" }, created: "", updated: "" });
  localStorage.setItem("pe:offline-sync:notes", JSON.stringify(n0));
  location.hash = "notes";
  location.reload();
}

async function phase2() {
  await wait(2500);
  ok("reload keeps notes", notesNow().length === 6, String(notesNow().length));
  const html = q$("#page").innerHTML;
  ok("inbox shows moved state", html.includes(">moved<"));
  let captured = null;
  const orig = URL.createObjectURL;
  URL.createObjectURL = b => { captured = b; return orig.call(URL, b); };
  click('[data-act="export"]');
  const j = JSON.parse(await captured.text());
  ok("export format", j.format === "plan-explorer-notes" && j.plan === "offline-sync" && j.notes.length === 6 && j.counts.resolved === 1, JSON.stringify(j.counts));
  const moved = j.notes.find(n => n.id === "nx");
  ok("export moved nid", moved.anchorState === "moved" && moved.nid === "areas/local-store/summary/p0", moved.nid);
  click('[data-theme-set="dark"]');
  ok("theme dark", document.documentElement.dataset.theme === "dark");
  const card = q$$(".ncard").find(c => c.textContent.includes("needs a migration"));
  card.querySelector('[data-act="goto"]').click();
  await wait(2500);
  ok("goto issue note → explore + drawer", location.hash === "#explore/local-store" && !q$("#drawer").hidden && q$("#drawer").textContent.includes("synchronous=NORMAL"));
  localStorage.removeItem("itest-phase");
  q$("#results").textContent = JSON.parse(localStorage.getItem("itest-out") || "[]").concat(out).join("\n");
  localStorage.removeItem("itest-out");
}

addEventListener("load", () => {
  if (localStorage.getItem("itest-phase") === "2") {
    phase2().catch(e => {
      out.push("FAIL exception " + e.stack);
      q$("#results").textContent = JSON.parse(localStorage.getItem("itest-out") || "[]").concat(out).join("\n");
    });
  } else {
    phase1().catch(e => {
      out.push("FAIL exception " + e.stack);
      q$("#results").textContent = out.join("\n");
    });
  }
});
addEventListener("beforeunload", () => {
  if (localStorage.getItem("itest-phase") !== "2") {
    localStorage.setItem("itest-out", JSON.stringify(out));
    localStorage.setItem("itest-phase", "2");
  }
});
