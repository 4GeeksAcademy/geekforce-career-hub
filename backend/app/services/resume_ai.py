"""Resume builder v2: one structured master resume per student, three templates, AI help.

AI access model (no student ever touches our Claude key):
  * Students use a copy-paste prompt. The hub writes the full prompt (their resume + the job + strict rules and an
    exact answer format); they paste it into their own free ChatGPT/Claude and paste the answer back. The hub
    validates the answer and shows each suggested change to accept or reject. Cost to 4Geeks: $0.
  * Advisors/admins can also press "Run with AI": the server calls Claude, logs tokens and an estimated cost, and
    refuses once the staff monthly budget (a rule) is used up.
"""
import copy
import io
import json
import logging
import re
from datetime import datetime

from fastapi import HTTPException

from ..config import settings

log = logging.getLogger("geekforce.resume_ai")

TEMPLATES = {"classic": "Classic", "modern": "Modern", "technical": "Technical (projects first)"}

EMPTY = {
    "basics": {"name": "", "headline": "", "email": "", "phone": "", "location": "", "links": []},
    "summary": "",
    "skills": [],          # [{"group": "Languages", "items": ["Python", "SQL"]}]
    "experience": [],      # [{"title","company","location","start","end","bullets":[...]}]
    "projects": [],        # [{"name","link","tech","bullets":[...]}]
    "education": [],       # [{"school","degree","start","end","details"}]
    "certifications": [],  # [{"name","issuer","date"}]
    "languages": [],       # ["English (native)", "Spanish (fluent)"]
}

SCHEMA_TEXT = """{
  "basics": {"name": "", "headline": "target job title", "email": "", "phone": "", "location": "City, ST",
             "links": [{"label": "LinkedIn", "url": ""}, {"label": "GitHub", "url": ""}]},
  "summary": "2-3 sentences",
  "skills": [{"group": "Languages", "items": ["Python", "JavaScript"]}, {"group": "Tools", "items": ["Git"]}],
  "experience": [{"title": "", "company": "", "location": "", "start": "MM/YYYY", "end": "MM/YYYY or Present",
                  "bullets": ["achievement with a result"]}],
  "projects": [{"name": "", "link": "", "tech": "React, FastAPI", "bullets": [""]}],
  "education": [{"school": "", "degree": "", "start": "", "end": "", "details": ""}],
  "certifications": [{"name": "", "issuer": "", "date": ""}],
  "languages": ["English (native)"]
}"""

RULES = """Rules:
- Use ONLY facts that appear in the resume. Never invent employers, job titles, dates, degrees, metrics or tools.
- If a number would make a bullet stronger but isn't in the resume, write it as [add number] for the candidate to fill in.
- Keep the candidate's own wording where it is already strong. Be concise: bullets under 30 words.
- Answer with ONLY the JSON below, no explanations before or after it."""


def import_prompt(cv_text: str) -> str:
    return f"""You are a career coach at 4Geeks Academy. Convert the resume below into structured data.
{RULES}
- Keep every job, project and school. Keep bullets as close to the original as possible.

Answer with JSON in exactly this format:
{SCHEMA_TEXT}

RESUME:
\"\"\"
{cv_text.strip()[:20000]}
\"\"\""""


def tailor_prompt(data: dict, job_text: str, job_title: str = "", company: str = "") -> str:
    return f"""You are a senior tech career coach at 4Geeks Academy. Tailor this candidate's resume to the job below.
{RULES}
- Suggest at most 10 changes. Prefer rewriting the summary, the headline, skills order and the weakest bullets.
- "path" points at the exact place to change, using the resume JSON below, for example:
  "basics.headline", "summary", "skills.0.items", "experience.0.bullets.2", "projects.1.bullets.0".
  To add a new bullet at the end of a list use the index "+", for example "experience.0.bullets.+".
- "before" must copy the current text exactly ("" when adding). For "skills.N.items" use a list of strings.

Answer with JSON in exactly this format:
{{
  "match_score": 0-100,
  "missing_keywords": ["keywords from the job that the resume lacks and the candidate could honestly add"],
  "summary_of_fit": "one or two sentences",
  "changes": [{{"path": "summary", "before": "", "after": "", "reason": "why this helps for this job"}}]
}}

JOB{f' · {job_title}' if job_title else ''}{f' at {company}' if company else ''}:
\"\"\"
{job_text.strip()[:12000]}
\"\"\"

CANDIDATE RESUME (JSON):
{json.dumps(data, ensure_ascii=False, indent=1)[:20000]}"""


# ── parsing & validation ──

def parse_answer(text: str) -> dict:
    """Accept the AI answer as pasted: tolerate code fences and chatter around the JSON."""
    t = (text or "").strip()
    if not t:
        raise HTTPException(422, "Paste the AI's answer first.")
    t = re.sub(r"^```(?:json)?|```$", "", t.strip(), flags=re.M).strip()
    start, end = t.find("{"), t.rfind("}")
    if start < 0 or end <= start:
        raise HTTPException(422, "That doesn't look like the answer format. Paste the whole answer, starting at { and ending at }.")
    try:
        return json.loads(t[start:end + 1])
    except json.JSONDecodeError as e:
        raise HTTPException(422, f"The answer isn't valid JSON (line {e.lineno}). Ask the AI: \"Reply again with only valid JSON.\"")


def _s(v, n=500) -> str:
    return str(v or "").strip()[:n]


def _bullets(v) -> list[str]:
    return [_s(b, 400) for b in (v or []) if _s(b)][:12] if isinstance(v, list) else []


def normalize(data: dict) -> dict:
    """Coerce any (pasted or edited) resume into the canonical shape with safe lengths."""
    d = data if isinstance(data, dict) else {}
    b = d.get("basics") if isinstance(d.get("basics"), dict) else {}
    out = copy.deepcopy(EMPTY)
    out["basics"] = {k: _s(b.get(k), 200) for k in ("name", "headline", "email", "phone", "location")}
    out["basics"]["links"] = [{"label": _s(l.get("label"), 40), "url": _s(l.get("url"), 300)}
                              for l in (b.get("links") or []) if isinstance(l, dict) and _s(l.get("url"))][:6]
    out["summary"] = _s(d.get("summary"), 1200)
    out["skills"] = [{"group": _s(g.get("group"), 60), "items": [_s(i, 60) for i in (g.get("items") or []) if _s(i)][:30]}
                     for g in (d.get("skills") or []) if isinstance(g, dict)][:10]
    out["experience"] = [{"title": _s(e.get("title"), 120), "company": _s(e.get("company"), 120),
                          "location": _s(e.get("location"), 120), "start": _s(e.get("start"), 20),
                          "end": _s(e.get("end"), 20), "bullets": _bullets(e.get("bullets"))}
                         for e in (d.get("experience") or []) if isinstance(e, dict)][:15]
    out["projects"] = [{"name": _s(p.get("name"), 120), "link": _s(p.get("link"), 300), "tech": _s(p.get("tech"), 200),
                        "bullets": _bullets(p.get("bullets"))}
                       for p in (d.get("projects") or []) if isinstance(p, dict)][:12]
    out["education"] = [{"school": _s(e.get("school"), 160), "degree": _s(e.get("degree"), 160),
                         "start": _s(e.get("start"), 20), "end": _s(e.get("end"), 20), "details": _s(e.get("details"), 400)}
                        for e in (d.get("education") or []) if isinstance(e, dict)][:8]
    out["certifications"] = [{"name": _s(c.get("name"), 160), "issuer": _s(c.get("issuer"), 120), "date": _s(c.get("date"), 20)}
                             for c in (d.get("certifications") or []) if isinstance(c, dict)][:10]
    out["languages"] = [_s(x, 60) for x in (d.get("languages") or []) if _s(x)][:8]
    return out


def is_empty(data: dict | None) -> bool:
    d = normalize(data or {})
    return not (d["summary"] or d["experience"] or d["projects"] or d["education"] or d["skills"])


def _resolve(data: dict, path: str):
    """Return (container, key) for a dotted path; key '+' means append. Raises ValueError when invalid."""
    parts = path.split(".")
    cur = data
    for p in parts[:-1]:
        if isinstance(cur, list):
            if not p.isdigit() or int(p) >= len(cur):
                raise ValueError(path)
            cur = cur[int(p)]
        elif isinstance(cur, dict) and p in cur:
            cur = cur[p]
        else:
            raise ValueError(path)
    last = parts[-1]
    if isinstance(cur, list):
        if last == "+" or (last.isdigit() and int(last) < len(cur)):
            return cur, last
        raise ValueError(path)
    if isinstance(cur, dict) and last in cur and not isinstance(cur[last], (dict,)):
        return cur, last
    raise ValueError(path)


def review_tailoring(answer: dict, data: dict) -> dict:
    """Keep only changes that point at real places in this resume."""
    changes, dropped = [], 0
    for c in (answer.get("changes") or [])[:15]:
        if not isinstance(c, dict) or not c.get("path") or c.get("after") in (None, ""):
            dropped += 1
            continue
        path = _s(c["path"], 80)
        try:
            cont, key = _resolve(copy.deepcopy(data), path)
        except ValueError:
            dropped += 1
            continue
        current = None if key == "+" else (cont[int(key)] if isinstance(cont, list) else cont[key])
        after = c["after"]
        if isinstance(current, list):
            after = [_s(x, 60) for x in (after if isinstance(after, list) else str(after).split(",")) if _s(x)]
        else:
            after = _s(after, 1200)
        changes.append({"id": f"c{len(changes)}", "path": path, "before": current if current is not None else "",
                        "after": after, "reason": _s(c.get("reason"), 300)})
    score = answer.get("match_score")
    return {"match_score": int(score) if isinstance(score, (int, float)) and 0 <= score <= 100 else None,
            "missing_keywords": [_s(k, 60) for k in (answer.get("missing_keywords") or []) if _s(k)][:15],
            "summary_of_fit": _s(answer.get("summary_of_fit"), 400), "changes": changes, "dropped": dropped}


def apply_changes(data: dict, changes: list[dict]) -> dict:
    out = normalize(copy.deepcopy(data))
    appends = []
    for c in changes:
        try:
            cont, key = _resolve(out, c["path"])
        except (ValueError, KeyError):
            continue
        if key == "+":
            appends.append((cont, c["after"]))
        elif isinstance(cont, list):
            cont[int(key)] = c["after"]
        else:
            cont[key] = c["after"]
    for cont, val in appends:  # append after replacements so indices stay valid
        cont.append(val)
    return normalize(out)


# ── staff-only Claude ──

def run_claude(prompt: str, max_tokens: int = 4000) -> tuple[str, int, int]:
    if not settings.anthropic_api_key:
        raise HTTPException(503, "AI isn't configured (missing ANTHROPIC_API_KEY). Use the copy-paste prompt instead.")
    import anthropic
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    try:
        msg = client.messages.create(model=settings.anthropic_model, max_tokens=max_tokens,
                                     messages=[{"role": "user", "content": prompt}])
    except anthropic.APIError as e:
        log.error("Claude API error: %s", e)
        raise HTTPException(502, "The AI service is unavailable right now. Try again, or use the copy-paste prompt.")
    text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    usage = getattr(msg, "usage", None)
    return text, int(getattr(usage, "input_tokens", 0) or 0), int(getattr(usage, "output_tokens", 0) or 0)


# ── documents (single column, no tables: safe for applicant tracking systems) ──

def build_docx(data: dict, template: str = "classic") -> bytes:
    import docx
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Pt, RGBColor, Inches

    d = normalize(data)
    blue = RGBColor(0x1B, 0x6F, 0xE0)
    ink = RGBColor(0x0B, 0x0B, 0x0F)
    doc = docx.Document()
    for s in doc.sections:
        s.left_margin = s.right_margin = Inches(0.8)
        s.top_margin = s.bottom_margin = Inches(0.7)
    normal = doc.styles["Normal"]
    normal.font.name, normal.font.size = ("Calibri" if template == "modern" else "Arial"), Pt(10.5)
    normal.paragraph_format.space_after = Pt(2)
    accent = blue if template in ("modern", "technical") else ink
    center = template == "classic"

    def para(text="", size=None, bold=False, color=None, italic=False, align_center=False, space_before=0):
        p = doc.add_paragraph()
        if align_center:
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(space_before)
        r = p.add_run(text)
        r.bold, r.italic = bold, italic
        if size:
            r.font.size = Pt(size)
        if color is not None:
            r.font.color.rgb = color
        return p

    b = d["basics"]
    para(b["name"] or "Your Name", 22 if template != "classic" else 20, True, accent if template == "modern" else ink, align_center=center)
    if b["headline"]:
        para(b["headline"], 12, False, accent, align_center=center)
    contact = " · ".join(x for x in [b["location"], b["email"], b["phone"], *[l["url"] for l in b["links"]]] if x)
    if contact:
        para(contact, 9.5, align_center=center)

    def heading(t):
        para(t.upper(), 11, True, accent, space_before=8)

    def bullets(items):
        for it in items:
            doc.add_paragraph(it, style="List Bullet")

    def sec_summary():
        if d["summary"]:
            heading("Summary")
            para(d["summary"])

    def sec_skills():
        if d["skills"]:
            heading("Skills")
            for g in d["skills"]:
                p = doc.add_paragraph()
                if g["group"]:
                    r = p.add_run(f"{g['group']}: ")
                    r.bold = True
                p.add_run(", ".join(g["items"]))

    def sec_experience():
        if d["experience"]:
            heading("Experience")
            for e in d["experience"]:
                p = doc.add_paragraph()
                p.paragraph_format.space_before = Pt(4)
                r = p.add_run(" · ".join(x for x in [e["title"], e["company"]] if x))
                r.bold = True
                dates = " – ".join(x for x in [e["start"], e["end"]] if x)
                if dates or e["location"]:
                    p.add_run("   " + " · ".join(x for x in [e["location"], dates] if x)).italic = True
                bullets(e["bullets"])

    def sec_projects():
        if d["projects"]:
            heading("Projects")
            for pr in d["projects"]:
                p = doc.add_paragraph()
                p.paragraph_format.space_before = Pt(4)
                r = p.add_run(pr["name"])
                r.bold = True
                extra = " · ".join(x for x in [pr["tech"], pr["link"]] if x)
                if extra:
                    p.add_run(f"   {extra}").italic = True
                bullets(pr["bullets"])

    def sec_education():
        if d["education"]:
            heading("Education")
            for e in d["education"]:
                p = doc.add_paragraph()
                r = p.add_run(" · ".join(x for x in [e["degree"], e["school"]] if x))
                r.bold = True
                dates = " – ".join(x for x in [e["start"], e["end"]] if x)
                if dates:
                    p.add_run(f"   {dates}").italic = True
                if e["details"]:
                    para(e["details"], 10)

    def sec_extra():
        if d["certifications"]:
            heading("Certifications")
            for c in d["certifications"]:
                para(" · ".join(x for x in [c["name"], c["issuer"], c["date"]] if x))
        if d["languages"]:
            heading("Languages")
            para(", ".join(d["languages"]))

    order = ([sec_summary, sec_skills, sec_projects, sec_experience, sec_education, sec_extra] if template == "technical"
             else [sec_summary, sec_experience, sec_projects, sec_skills, sec_education, sec_extra])
    for f in order:
        f()
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def filename(data: dict, label: str = "") -> str:
    name = re.sub(r"[^A-Za-z0-9]+", "-", (normalize(data)["basics"]["name"] or "resume")).strip("-")
    tag = re.sub(r"[^A-Za-z0-9]+", "-", label).strip("-")[:40]
    return f"{name}-Resume{('-' + tag) if tag else ''}-{datetime.now():%Y%m%d}.docx"
