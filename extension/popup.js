import { DEFAULT_HUB_URL } from "./config.js";

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

async function hubUrl() {
  const { hubUrl } = await chrome.storage.local.get("hubUrl");
  return (hubUrl || DEFAULT_HUB_URL).replace(/\/$/, "");
}

async function render() {
  $("hubUrl").value = await hubUrl();
  const { token, user } = await chrome.storage.local.get(["token", "user"]);
  if (!token) { $("login").hidden = false; $("main").hidden = true; $("who").textContent = ""; return; }
  const s = await send({ type: "summary" });
  if (!s || s.needsLogin) { $("login").hidden = false; $("main").hidden = true; return; }
  $("login").hidden = true; $("main").hidden = false;
  const d = s.dashboard;
  $("who").textContent = (d && d.student.name) || (user && user.name) || "";
  $("todayN").textContent = s.today.length;
  if (d) {
    $("pts").textContent = d.points;
    $("ptsTile").className = "tile" + (d.status === "at_risk" ? " risk" : d.status === "suspended" ? " bad" : "");
    const w = d.week;
    $("weekTxt").textContent = `${w.applications} of ${w.target}`;
    $("weekBar").style.width = `${Math.min(100, (w.applications / w.target) * 100)}%`;
    $("weekBar").style.background = w.applications >= w.target ? "#2381FF" : "#F5B93E";
    const left = w.target - w.applications;
    $("weekNote").textContent = left > 0 ? `${left} more by Sunday for the +${w.weekly_bonus} bonus` : "Weekly goal met. Bonus lands Monday.";
  }
  $("queue").hidden = !s.queue;
  $("queue").textContent = `${s.queue} application${s.queue === 1 ? "" : "s"} waiting to sync. Retrying automatically.`;
  const list = $("todayList");
  list.textContent = "";
  if (!s.today.length) { const p = document.createElement("div"); p.className = "cap"; p.textContent = "Nothing yet today. Apply on a supported site and it shows up here."; list.appendChild(p); }
  for (const it of s.today.slice(0, 6)) {
    const row = document.createElement("div"); row.className = "item";
    const l = document.createElement("span"); const b = document.createElement("strong"); b.textContent = it.company;
    l.append(b, ` · ${it.role}`);
    const r = document.createElement("b"); r.textContent = "+3";
    row.append(l, r); list.appendChild(row);
  }
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginErr").hidden = true;
  const r = await send({ type: "login", email: $("email").value, password: $("password").value });
  if (!r.ok) { $("loginErr").textContent = r.error; $("loginErr").hidden = false; return; }
  render();
});

$("trackPage").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const msg = $("trackMsg");
  msg.hidden = false;
  let job = null;
  try { job = await chrome.tabs.sendMessage(tab.id, { type: "getJob" }); } catch (_) { /* not a supported page */ }
  if (!job) { msg.textContent = "Open a job posting on a supported site, or add it in Career Hub → Job Tracker."; return; }
  const r = await send({ type: "track", job: { company: job.company, role: job.role, job_url: job.url }, source: job.source });
  msg.textContent = r.ok ? (r.created ? `Tracked: ${r.role} at ${r.company} · +3` : "Already tracked") : (r.error || (r.queued ? "Saved offline, will sync." : "Sign in first."));
  render();
});

$("openHub").addEventListener("click", async () => chrome.tabs.create({ url: await hubUrl() }));
$("saveUrl").addEventListener("click", async () => { await chrome.storage.local.set({ hubUrl: $("hubUrl").value.replace(/\/$/, "") }); render(); });
$("logout").addEventListener("click", async () => { await send({ type: "logout" }); render(); });

render();
