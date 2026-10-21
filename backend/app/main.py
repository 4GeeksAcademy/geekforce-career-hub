"""GeekForce Career Hub API."""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import events  # noqa: F401 — registers the outbound-event listener
from .config import settings
from .db import Base, SessionLocal, engine
from .routers import admin_routes, auth_routes, jobs_routes, resume_routes, staff_routes, student_routes

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("geekforce")


@asynccontextmanager
async def lifespan(app: FastAPI):
    from . import models  # noqa: F401 — register tables
    from .seed import ensure_initial_admin, seed_demo
    if settings.sqlalchemy_url.startswith("sqlite") or settings.seed_demo:
        Base.metadata.create_all(engine)  # Postgres in production uses Alembic migrations (see start.sh)
    with SessionLocal() as db:
        ensure_initial_admin(db)
        if settings.seed_demo:
            seed_demo(db)
    sched = None
    if settings.enable_scheduler:
        from .jobs import start_scheduler
        sched = start_scheduler()
        log.info("Scheduler started (%s)", settings.timezone)
    yield
    if sched:
        sched.shutdown()


app = FastAPI(title="GeekForce Career Hub API", version="1.0.0", lifespan=lifespan,
              docs_url="/api/docs", openapi_url="/api/openapi.json")

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins or ["*"], allow_origin_regex=r"chrome-extension://.*",
                   allow_credentials=False, allow_methods=["*"], allow_headers=["*"])

API = "/api/v1"
for r in (auth_routes.router, student_routes.router, staff_routes.router, jobs_routes.router, resume_routes.router, admin_routes.router,
          admin_routes.cron_router):
    app.include_router(r, prefix=API)


@app.get("/api/health")
def health():
    return {"ok": True}


# Serve the built React app (single Railway service).
static_dir = Path(settings.static_dir) if settings.static_dir else None
if static_dir and static_dir.exists():
    app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str, request: Request):
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        f = static_dir / full_path
        if full_path and f.is_file():
            return FileResponse(f)
        return FileResponse(static_dir / "index.html")
