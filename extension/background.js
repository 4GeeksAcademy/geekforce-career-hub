/* Service worker: owns the token, talks to the Career Hub API, queues failed requests offline,
 * and keeps the toolbar badge in sync (today's count, or "!" when something needs attention). */
import { DEFAULT_HUB_URL } from "./config.js";

const get = (k) => chrome.storage.local.get(k);
const set = (o) => chrome.storage.local.set(o);
const todayKey = () => new Date().toISOString().slice(0, 10);

async function hub() {
  const { hubUrl, token } = await get(["hubUrl", "token"]);
  return { base: (hubUrl || DEFAULT_HUB_URL).replace(/\/$/, ""), token };
}

async function api(path, opts = {}) {
  const { base, token } = await hub();
  if (!token) return { status: 401 };
  const res = await fetch(`${base}/api/v1${path}`, {
    ...opts, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch (_) { /* empty */ }
  return { status: res.status, body };
}

async function updateBadge() {
  const { queue = [], token, today = {} } = await get(["queue", "token", "today"]);
  const n = (today.date === todayKey() ? today.items.length : 0);
  if (!token) { chrome.action.setBadgeText({ text: "!" }); chrome.action.setBadgeBackgroundColor({ color: "#E5484D" }); return; }
  if (queue.length) { chrome.action.setBadgeText({ text: `${queue.length}↻` }); chrome.action.setBadgeBackgroundColor({ color: "#F5B93E" }); return; }
  chrome.action.setBadgeText({ text: n ? String(n) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#1B6FE0" });
}

async function rememberToday(item) {
  const { today = {} } = await get("today");
  const items = today.date === todayKey() ? today.items : [];
  if (!items.find((x) => x.id === item.id)) items.unshift(item);
  await set({ today: { date: todayKey(), items: items.slice(0, 50) } });
}

async function track(job, source) {
  let r;
  try {
    r = await api("/applications", { method: "POST", body: JSON.stringify({ ...job, source }) });
  } catch (e) {
    const { queue = [] } = await get("queue");
    queue.push({ job, source, at: Date.now() });
    await set({ queue });
    await updateBadge();
    return { ok: false, queued: true };
  }
  if (r.status === 401) { await set({ token: null }); await updateBadge(); return { ok: false, needsLogin: true }; }
  if (r.status >= 300) return { ok: false, error: (r.body && r.body.detail) || `Error ${r.status}` };
  const a = r.body.application;
  if (r.body.created) await rememberToday({ id: a.id, company: a.company, role: a.role, at: Date.now() });
  await set({ lastPoints: r.body.points });
  await updateBadge();
  return { ok: true, created: r.body.created, company: a.company, role: a.role, points: r.body.points,
    thisWeek: r.body.this_week, target: r.body.target, pointsAdded: 3 };
}

async function flushQueue() {
  const { queue = [] } = await get("queue");
  if (!queue.length) return;
  const remaining = [];
  for (const q of queue) {
    try {
      const r = await api("/applications", { method: "POST", body: JSON.stringify({ ...q.job, source: q.source }) });
      if (r.status === 401) { remaining.push(q); break; }
      if (r.status < 300 && r.body.created) {
        const a = r.body.application;
        await rememberToday({ id: a.id, company: a.company, role: a.role, at: Date.now() });
      }
    } catch (_) { remaining.push(q); }
  }
  await set({ queue: remaining });
  await updateBadge();
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.type === "track") return reply(await track(msg.job, msg.source));
    if (msg.type === "hubToken") {
      const cur = await get(["token"]);
      if (msg.token && msg.token !== cur.token) { await set({ token: msg.token, hubUrl: msg.hubUrl }); await flushQueue(); }
      await updateBadge();
      return reply({ ok: true });
    }
    if (msg.type === "login") {
      const { base } = await hub();
      try {
        const res = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: msg.email, password: msg.password }) });
        const body = await res.json();
        if (!res.ok) return reply({ ok: false, error: body.detail || "Wrong email or password" });
        await set({ token: body.token, user: body.user });
        await flushQueue(); await updateBadge();
        return reply({ ok: true, user: body.user });
      } catch (_) { return reply({ ok: false, error: "Can't reach Career Hub. Check the address in Settings." }); }
    }
    if (msg.type === "logout") { await set({ token: null, user: null }); await updateBadge(); return reply({ ok: true }); }
    if (msg.type === "summary") {
      const r = await api("/students/me/dashboard").catch(() => ({ status: 0 }));
      if (r.status === 401) { await set({ token: null }); await updateBadge(); return reply({ needsLogin: true }); }
      const { queue = [], today = {} } = await get(["queue", "today"]);
      return reply({ dashboard: r.status === 200 ? r.body : null, queue: queue.length,
        today: today.date === todayKey() ? today.items : [] });
    }
    if (msg.type === "flush") { await flushQueue(); return reply({ ok: true }); }
    reply(null);
  })();
  return true;  // async reply
});

chrome.alarms.create("flush", { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "flush") flushQueue(); });
chrome.runtime.onStartup.addListener(() => { flushQueue(); updateBadge(); });
chrome.runtime.onInstalled.addListener(() => updateBadge());
