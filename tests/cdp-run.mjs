#!/usr/bin/env node
// Opens a URL in headless Chrome over the DevTools protocol and waits (real time) until
// document.title === "DONE", then prints #results. Console errors are printed too.
// Usage: node cdp-run.mjs <url> <profile-dir> [timeout-ms]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [url, profile, timeoutArg] = process.argv.slice(2);
const TIMEOUT = Number(timeoutArg || 60000);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const quit = code => {
  chrome.kill();
  process.exit(code);
};
setTimeout(() => {
  console.log("FAIL cdp-run timed out");
  quit(1);
}, TIMEOUT + 15000).unref();

let port = null;
for (let i = 0; i < 100 && !port; i++) {
  try {
    port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0];
  } catch (e) {
    await sleep(100);
  }
}
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener("open", r));
let seq = 0;
const waiting = new Map();
ws.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) {
    waiting.get(m.id)(m.result);
    waiting.delete(m.id);
  } else if (m.method === "Runtime.exceptionThrown") {
    console.log("PAGE EXCEPTION " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    console.log("PAGE ERROR " + m.params.args.map(a => a.value ?? a.description).join(" "));
  }
});
const send = (method, params = {}) => new Promise(r => {
  const id = ++seq;
  waiting.set(id, r);
  ws.send(JSON.stringify({ id, method, params }));
});
await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url });
const t0 = Date.now();
const evalStr = async expr => (await send("Runtime.evaluate", { expression: expr, returnByValue: true }))?.result?.value;
while (Date.now() - t0 < TIMEOUT) {
  if ((await evalStr("document.title")) === "DONE") {
    break;
  }
  await sleep(250);
}
console.log((await evalStr("document.querySelector('#results') ? document.querySelector('#results').textContent : 'no #results'")) || "");
quit(0);
