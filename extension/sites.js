/* Per-site detection. Job boards change their markup often, so every extractor has fallbacks
 * (structured selectors → page title → URL), and success is detected by confirmation text/URL patterns.
 * To support a new site, add an entry with: match(url), getJob(), isSuccess(). */
(function () {
  const txt = (sel) => {
    for (const s of [].concat(sel)) {
      const el = document.querySelector(s);
      const t = el && (el.innerText || el.textContent || "").trim();
      if (t) return t.split("\n")[0].trim();
    }
    return "";
  };
  const bodyHas = (patterns) => {
    const t = (document.body && document.body.innerText) || "";
    return patterns.some((p) => p.test(t));
  };
  const NOT_A_TITLE = /thank you|application (sent|submitted|received)|you applied/i;
  const clean = (t) => (NOT_A_TITLE.test(t) ? "" : t);
  const titleParts = () => document.title.split(/\s[|\-–·]\s/).map((s) => s.trim()).filter(Boolean);

  const SITES = [
    {
      key: "linkedin",
      match: (u) => /(^|\.)linkedin\.com$/.test(u.hostname),
      getJob() {
        const role = txt([".job-details-jobs-unified-top-card__job-title", ".jobs-unified-top-card__job-title",
          ".t-24.job-details-jobs-unified-top-card__job-title", "h1.top-card-layout__title", ".jobs-details__main-content h1, h2.t-24"]);
        const company = txt([".job-details-jobs-unified-top-card__company-name", ".jobs-unified-top-card__company-name",
          "a.topcard__org-name-link", ".topcard__flavor"]);
        const p = titleParts();
        const id = new URLSearchParams(location.search).get("currentJobId") || (location.pathname.match(/jobs\/view\/(\d+)/) || [])[1];
        return { role: role || p[0] || "", company: company || p[1] || "",
          url: id ? `https://www.linkedin.com/jobs/view/${id}/` : location.href.split("?")[0] };
      },
      isSuccess: () => bodyHas([/your application was sent/i, /application sent/i]),
    },
    {
      key: "indeed",
      match: (u) => /(^|\.)indeed\.com$/.test(u.hostname),
      getJob() {
        const role = txt(["h1.jobsearch-JobInfoHeader-title", "[data-testid='jobsearch-JobInfoHeader-title']",
          ".ia-JobHeader-title", "[data-testid='job-title']", "h1"]);
        const company = txt(["[data-testid='inlineHeader-companyName']", "[data-company-name='true']",
          ".jobsearch-InlineCompanyRating div", ".ia-JobHeader-information span", "[data-testid='company-name']"]);
        const jk = new URLSearchParams(location.search).get("jk") || new URLSearchParams(location.search).get("vjk");
        return { role, company: company.replace(/\d(\.\d)?\s*out of.*$/i, "").trim(),
          url: jk ? `https://www.indeed.com/viewjob?jk=${jk}` : location.href.split("#")[0] };
      },
      isSuccess: () => /post-apply|\/applied/.test(location.pathname) ||
        bodyHas([/your application has been submitted/i, /application submitted/i]),
    },
    {
      key: "glassdoor",
      match: (u) => /(^|\.)glassdoor\.[a-z.]+$/.test(u.hostname),
      getJob() {
        const role = txt(["[data-test='job-title']", "h1[id^='jd-job-title']", "h1"]);
        const company = txt(["[data-test='employer-name']", "[data-test='employerName']", "h4"]);
        return { role, company: company.replace(/\d\.\d.*$/, "").trim(), url: location.href.split("?")[0] };
      },
      isSuccess: () => bodyHas([/your application has been submitted/i, /application submitted/i, /you applied/i]),
    },
    {
      key: "greenhouse",
      match: (u) => /greenhouse\.io$/.test(u.hostname),
      getJob() {
        const seg = location.pathname.split("/").filter(Boolean);
        const slug = seg[0] === "embed" ? new URLSearchParams(location.search).get("for") : seg[0];
        const role = clean(txt(["h1.app-title", ".job__title h1", "h1.section-header", "h1"]));
        const company = txt([".company-name", ".job__header .company"]).replace(/^at\s+/i, "") ||
          (slug || "").replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        return { role, company, url: location.href.split("?")[0].replace(/\/confirmation.*$/, "") };
      },
      isSuccess: () => /confirmation/.test(location.pathname) ||
        bodyHas([/thank you for applying/i, /application has been (submitted|received)/i]),
    },
    {
      key: "lever",
      match: (u) => u.hostname === "jobs.lever.co",
      getJob() {
        const seg = location.pathname.split("/").filter(Boolean);
        const role = clean(txt([".posting-headline h2", "h2"]));
        const company = txt([".main-header-logo img[alt]"]) ||
          (document.querySelector(".main-header-logo img") || {}).alt ||
          (seg[0] || "").replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        return { role, company, url: `https://jobs.lever.co/${seg.slice(0, 2).join("/")}` };
      },
      isSuccess: () => /\/thanks/.test(location.pathname) || bodyHas([/application submitted/i, /thanks for applying/i]),
    },
  ];

  window.GeekForceSites = {
    current() { const u = new URL(location.href); return SITES.find((s) => s.match(u)) || null; },
  };
})();
