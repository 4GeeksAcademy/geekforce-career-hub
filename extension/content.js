/* Watches job-board pages: remembers the job being viewed and, when the confirmation appears,
 * asks the background worker to log it in Career Hub. */
(function () {
  const site = window.GeekForceSites && window.GeekForceSites.current();
  if (!site) return;
  const sent = new Set();
  const KEY = `gf_lastJob_${site.key}`;

  const valid = (j) => j && j.role && j.company && j.role.length < 200 && j.company.length < 120;

  function remember() {
    if (site.isSuccess()) return;  // never overwrite the posting with confirmation-page text
    const j = site.getJob();
    if (valid(j)) chrome.storage.local.set({ [KEY]: { ...j, at: Date.now() } });
  }

  async function check() {
    remember();
    if (!site.isSuccess()) return;
    // Confirmation pages rarely show the job header, so prefer the job remembered from the posting (last hour).
    const stored = (await chrome.storage.local.get(KEY))[KEY];
    let job = stored && Date.now() - stored.at < 60 * 60 * 1000 ? stored : site.getJob();
    if (!valid(job)) return;
    const id = job.url || `${job.company}|${job.role}`;
    if (sent.has(id)) return;
    sent.add(id);
    const res = await chrome.runtime.sendMessage({ type: "track", job: { company: job.company, role: job.role, job_url: job.url }, source: `extension_${site.key}` });
    showOverlay(res);
  }

  function showOverlay(res) {
    if (!res) return;
    document.getElementById("gf-overlay")?.remove();
    const el = document.createElement("div");
    el.id = "gf-overlay";
    el.setAttribute("role", "status");
    const title = res.ok ? (res.created === false ? "Already tracked" : `Application tracked · +${res.pointsAdded ?? 3} points`)
      : res.queued ? "Saved offline · will sync automatically" : res.needsLogin ? "Sign in to GeekForce to track this" : "Couldn't track this application";
    const sub = res.ok ? `${res.role} at ${res.company}${res.thisWeek != null ? ` · ${res.thisWeek} of ${res.target} this week` : ""}`
      : res.needsLogin ? "Open the GeekForce extension and sign in." : (res.error || "");
    el.innerHTML = `<div class="gf-ico ${res.ok ? "" : "gf-warn"}">${res.ok ? "✓" : "!"}</div><div class="gf-txt"><strong></strong><span></span></div><button class="gf-x" aria-label="Close">×</button>`;
    el.querySelector("strong").textContent = title;
    el.querySelector("span").textContent = sub;
    el.querySelector(".gf-x").onclick = () => el.remove();
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 7000);
  }

  let t = null;
  const schedule = () => { clearTimeout(t); t = setTimeout(check, 800); };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: false });
  let last = location.href;
  setInterval(() => { if (location.href !== last) { last = location.href; schedule(); } }, 1000);
  schedule();

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type === "getJob") { const j = site.getJob(); reply(valid(j) ? { ...j, source: `extension_${site.key}` } : null); }
  });
})();
