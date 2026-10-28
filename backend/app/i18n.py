"""Messages in the reader's language (English / Spanish).

    M("You're now in {stage}", stage=LABEL[stage])     # a translatable message; str() is the English text
    tr(msg, "es")                                     # → "Ahora estás en Etapa 1 · Perfil"

Templates are looked up in ES (app/i18n_es.py) by their English text. Variables that are themselves known
English strings (stage labels, statuses…) are translated too. Dates passed with D() are formatted per language.
Anything without a translation falls back to English, so nothing ever breaks.
"""
from contextvars import ContextVar
from datetime import date, datetime

# Language of the current request (the app sends X-Lang); used by L() for text generated in API responses.
request_lang: ContextVar[str] = ContextVar("request_lang", default="en")

LANGS = ("en", "es")
SPANISH_REGIONS = {"latam", "spain", "es"}

MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
             "noviembre", "diciembre"]
DAYS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


class D:
    """A date to show in the reader's language. style: 'short' (Mar 3), 'long' (Tuesday, Mar 3), 'datetime'."""

    def __init__(self, value: date | datetime, style: str = "short"):
        self.value, self.style = value, style

    def render(self, lang: str) -> str:
        v = self.value
        if lang == "es":
            s = f"{v.day} de {MONTHS_ES[v.month - 1]}"
            if self.style in ("long", "datetime"):
                s = f"{DAYS_ES[v.weekday()]} {s}"
            if self.style == "datetime" and isinstance(v, datetime):
                s += f" a las {v:%H:%M}"
            return s
        if self.style == "long":
            return f"{v:%A, %b %d}".replace(" 0", " ")
        if self.style == "datetime":
            return f"{v:%A, %b %d at %I:%M %p}".replace(" 0", " ")
        return f"{v:%b %d}".replace(" 0", " ")

    def __str__(self):
        return self.render("en")

    def __format__(self, spec):
        return str(self)


def _render_var(v, lang):
    if isinstance(v, D):
        return v.render(lang)
    if isinstance(v, (M, Cat)):
        return v.to(lang)
    if isinstance(v, str) and lang == "es":
        from .i18n_es import ES
        return ES.get(v, v)
    return v


def _fill(template: str, vars: dict, lang: str) -> str:
    vals = {k: _render_var(v, lang) for k, v in vars.items()}
    try:
        return template.format(**vals)
    except (KeyError, IndexError, ValueError):
        return template


class M(str):
    """A translatable message. Behaves like its English text everywhere a str is expected."""

    def __new__(cls, template: str, **vars):
        obj = str.__new__(cls, _fill(template, vars, "en"))
        obj.template, obj.vars = template, vars
        return obj

    def to(self, lang: str) -> str:
        if lang == "es":
            from .i18n_es import ES
            return _fill(ES.get(self.template, self.template), self.vars, "es")
        return str(self)


class Cat(str):
    """Several messages joined (e.g. an advisor's note + a standard sentence). Plain strings stay as written."""

    def __new__(cls, *parts, sep: str = "\n\n"):
        parts = [p for p in parts if p]
        obj = str.__new__(cls, sep.join(str(p) for p in parts))
        obj.parts, obj.sep = parts, sep
        return obj

    def to(self, lang: str) -> str:
        return self.sep.join(p.to(lang) if isinstance(p, (M, Cat)) else str(p) for p in self.parts)


def tr(text, lang: str | None) -> str:
    """Render a message (M, Cat or plain str) in a language."""
    if text is None:
        return None
    lang = lang if lang in LANGS else "en"
    if isinstance(text, (M, Cat)):
        return text.to(lang)
    if lang == "es":
        from .i18n_es import ES
        return ES.get(text, text)
    return str(text)


def lang_of(user) -> str:
    """The user's chosen language, or Spanish by default for students in LATAM / Spain cohorts."""
    if user is None:
        return "en"
    if getattr(user, "language", None) in LANGS:
        return user.language
    st = getattr(user, "student", None)
    if st is not None and st.cohort is not None and (st.cohort.region or "").lower() in SPANISH_REGIONS:
        return "es"
    return "en"


def L(template: str, **vars) -> str:
    """Text for the current API response, in the language the app asked for (X-Lang header)."""
    return M(template, **vars).to(request_lang.get())
