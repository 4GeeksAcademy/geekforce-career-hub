"""AI Resume Builder: text extraction, Claude analysis (server-side only — the key never reaches the browser),
and .docx generation of the tailored resume."""
import io
import json
import logging
import re

from fastapi import HTTPException

from ..config import settings

log = logging.getLogger("geekforce.resume")

SYSTEM = """You are a senior tech career coach at 4Geeks Academy helping bootcamp graduates land developer roles.
Compare the candidate's resume with the job description and respond with ONLY a JSON object, no prose, using exactly this shape:
{
  "tailoring_score": <0-100 integer: how well the CURRENT resume matches the job>,
  "projected_score": <0-100 integer: the expected match after applying your suggestions>,
  "keyword_gaps": [<important skills/keywords from the job that the resume lacks>],
  "feedback": [{"type": "good"|"warn"|"bad", "text": <one specific sentence>}],
  "suggested_summary": <a 2-3 sentence professional summary tailored to this job, truthful to the resume>,
  "suggested_bullets": [{"before": <an existing weak bullet, quoted from the resume>, "after": <stronger, quantified rewrite>}],
  "tailored_resume": {
     "name": <candidate name>, "headline": <target title>, "contact": <one line of contact info from the resume>,
     "sections": [{"heading": <e.g. Summary, Skills, Experience, Projects, Education>, "items": [<lines or bullets>]}]
  }
}
Rules: never invent employers, degrees, dates or metrics the resume doesn't support; if you suggest a metric the
candidate must confirm, wrap it in [brackets]. Give 4-7 feedback items mixing good/warn/bad. Mention the 4Geeks
Academy program in Education if it appears in the resume."""


def extract_text(filename: str, data: bytes) -> str:
    name = (filename or "").lower()
    try:
        if name.endswith(".pdf"):
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(data))
            return "\n".join(p.extract_text() or "" for p in reader.pages).strip()
        if name.endswith(".docx"):
            import docx
            d = docx.Document(io.BytesIO(data))
            return "\n".join(p.text for p in d.paragraphs).strip()
        if name.endswith((".txt", ".md")):
            return data.decode("utf-8", errors="ignore").strip()
    except Exception as e:  # noqa: BLE001 — any parser failure becomes a friendly 422
        log.warning("resume parse failed: %s", e)
        raise HTTPException(422, "We couldn't read that file. Try a different .pdf or .docx, or paste the text.")
    raise HTTPException(422, "Upload a .pdf or .docx file, or paste your resume as text.")


def analyze(resume_text: str, job_description: str) -> dict:
    if not settings.anthropic_api_key:
        raise HTTPException(503, "The AI resume builder isn't configured yet (missing ANTHROPIC_API_KEY).")
    if len(resume_text) < 200:
        raise HTTPException(422, "Your resume text looks too short. Upload the full resume.")
    if len(job_description) < 100:
        raise HTTPException(422, "Paste the full job description so the analysis is accurate.")
    import anthropic
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    try:
        msg = client.messages.create(
            model=settings.anthropic_model, max_tokens=4000, system=SYSTEM,
            messages=[{"role": "user", "content":
                       f"<resume>\n{resume_text[:20000]}\n</resume>\n\n<job_description>\n{job_description[:12000]}\n</job_description>"}],
        )
    except anthropic.APIError as e:
        log.error("Claude API error: %s", e)
        raise HTTPException(502, "The AI service is unavailable right now. Try again in a minute.")
    text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    m = re.search(r"\{.*\}", text, re.S)
    try:
        data = json.loads(m.group(0) if m else text)
    except (json.JSONDecodeError, AttributeError):
        log.error("Claude returned non-JSON: %s", text[:500])
        raise HTTPException(502, "The analysis came back malformed. Try again.")
    data.setdefault("keyword_gaps", [])
    data.setdefault("feedback", [])
    data.setdefault("suggested_bullets", [])
    return data


def build_docx(analysis: dict) -> bytes:
    import docx
    from docx.shared import Pt, RGBColor

    tr = analysis.get("tailored_resume") or {}
    d = docx.Document()
    st = d.styles["Normal"]
    st.font.name, st.font.size = "Arial", Pt(10.5)
    h = d.add_paragraph()
    run = h.add_run(tr.get("name") or "Your Name")
    run.bold, run.font.size = True, Pt(20)
    if tr.get("headline"):
        r2 = d.add_paragraph().add_run(tr["headline"])
        r2.font.size, r2.font.color.rgb = Pt(12), RGBColor(0x1B, 0x6F, 0xE0)
    if tr.get("contact"):
        d.add_paragraph(tr["contact"])
    sections = tr.get("sections") or [{"heading": "Summary", "items": [analysis.get("suggested_summary", "")]}]
    for sec in sections:
        p = d.add_paragraph()
        rr = p.add_run(sec.get("heading", "").upper())
        rr.bold, rr.font.size = True, Pt(11)
        for item in sec.get("items", []):
            d.add_paragraph(str(item), style="List Bullet" if len(sec.get("items", [])) > 1 else None)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()
