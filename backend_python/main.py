"""
LaunchPadre — Complete Systems Engine Specification
Target: Python 3.11+ | FastAPI | SQLAlchemy 2.0 (asyncpg) | GitPython | Stripe | Requests | PostgreSQL 15

Phase 1: Core Webhook Ingestion, HMAC-SHA256 Security & Markdown Kanban Layout
Phase 2: Panic Room Rollback Engine, Unborn HEAD Patch & Three-Layer Data Sovereignty
Phase 3: Stripe Billing Lifecycle & Zenodo Academic DOI Minting Engine
"""

from __future__ import annotations

import enum
import hashlib
import hmac
import json
import logging
import os
import re
import sys
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any, AsyncGenerator

from fastapi import Depends, FastAPI, Header, HTTPException, Path as PathParam, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import selectinload

# Core Modules & Models
from backend_python.models import (
    AcademicDoiRegistry,
    Base,
    Commit,
    Repository,
    Task,
    TaskCommitLink,
    TaskStatus,
    User,
)
from backend_python.panic_room import (
    PanicRoomError,
    PanicRoomManager,
    RollbackResult,
    SnapshotNotFoundError,
    SnapshotRecord,
)
from backend_python.middleware import (
    DYNAMIC_ROBOTS_TXT_BODY,
    DataSovereigntyMiddleware,
)
import backend_python.billing as billing_module
from backend_python.billing import (
    CheckoutSessionRequest,
    CheckoutSessionResponse,
    BillingWebhookResponse,
)
from backend_python.zenodo import (
    AcademicDoiResponse,
    ZenodoError,
    ZenodoMintRequest,
    ZenodoPublisher,
)


# ============================================================================
# 1. CONFIGURATION & LOCAL-OFFSET STRUCTURED LOGGING
# ============================================================================

class Settings:
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://launchpadre:launchpadre_secret@localhost:5432/launchpadre_db",
    )
    WEBHOOK_SECRET: str = os.getenv(
        "WEBHOOK_SECRET",
        "whsec_launchpadre_forgejo_9f8e7d6c5b4a3f2e1d0c",
    )
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO").upper()
    DB_POOL_SIZE: int = int(os.getenv("DB_POOL_SIZE", "20"))
    DB_MAX_OVERFLOW: int = int(os.getenv("DB_MAX_OVERFLOW", "10"))
    GIT_REPOSITORIES_ROOT: str = os.getenv("GIT_REPOSITORIES_ROOT", "/var/git/launchpadre")
    STRIPE_SECRET_KEY: str = os.getenv("STRIPE_SECRET_KEY", "sk_test_launchpadre_mock_secret_key_4092")
    STRIPE_WEBHOOK_SECRET: str = os.getenv("STRIPE_WEBHOOK_SECRET", "whsec_launchpadre_stripe_webhook_99a8b7c6")
    ZENODO_BASE_URL: str = os.getenv("ZENODO_BASE_URL", "https://zenodo.org")
    ZENODO_ACCESS_TOKEN: str = os.getenv("ZENODO_ACCESS_TOKEN", "zenodo_pat_test_token_academic_4092")


settings = Settings()


def now_local_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def format_dt_local_offset(dt: datetime | None) -> str:
    if dt is None:
        return now_local_iso()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone().isoformat(timespec="seconds")


class LocalOffsetJsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_date = datetime.fromtimestamp(record.created, tz=timezone.utc).astimezone()
        payload: dict[str, Any] = {
            "timestamp": log_date.isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if hasattr(record, "correlation_id"):
            payload["correlation_id"] = getattr(record, "correlation_id")
        return json.dumps(payload, ensure_ascii=False)


def configure_logger() -> logging.Logger:
    logger = logging.getLogger("launchpadre.engine")
    logger.setLevel(getattr(logging, settings.LOG_LEVEL, logging.INFO))
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(LocalOffsetJsonFormatter())
        logger.addHandler(handler)
    logger.propagate = False
    return logger


logger = configure_logger()


# ============================================================================
# 2. ASYNC DATABASE ENGINE & DEPENDENCIES
# ============================================================================

engine: AsyncEngine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


billing_module.get_db_session = get_db_session


# ============================================================================
# 3. PANIC ROOM & ZENODO SINGLETONS
# ============================================================================

panic_room_manager = PanicRoomManager(default_base_dir=settings.GIT_REPOSITORIES_ROOT)
zenodo_publisher = ZenodoPublisher(
    base_url=settings.ZENODO_BASE_URL,
    access_token=settings.ZENODO_ACCESS_TOKEN,
)


async def resolve_repo_fs_path(repo: Repository) -> Path:
    if repo.local_path and Path(repo.local_path).exists():
        return Path(repo.local_path)
    candidate = Path(settings.GIT_REPOSITORIES_ROOT) / repo.full_name.replace("/", "_")
    if not candidate.exists():
        candidate.mkdir(parents=True, exist_ok=True)
    return candidate


# ============================================================================
# 4. APPLICATION SETUP & MIDDLEWARES
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("Booting LaunchPadre Core Engine")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()
    logger.info("Shutting down LaunchPadre Core Engine")


app = FastAPI(
    title="LaunchPadre Systems Engine",
    version="2.0.0",
    description="Git Webhook Worker, Panic Room Rollback, Stripe Billing & Zenodo Academic DOI Minting.",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

app.add_middleware(DataSovereigntyMiddleware)
app.include_router(billing_module.router)


# ============================================================================
# 5. ERROR HANDLERS
# ============================================================================

@app.exception_handler(ZenodoError)
async def zenodo_exception_handler(request: Request, exc: ZenodoError) -> JSONResponse:
    correlation_id = str(uuid.uuid4())
    logger.error(f"Zenodo DOI minting failed: {exc.message}", extra={"correlation_id": correlation_id})
    return JSONResponse(
        status_code=status.HTTP_502_BAD_GATEWAY,
        content={
            "error": {
                "code": status.HTTP_502_BAD_GATEWAY,
                "message": f"Zenodo Academic Publishing Gateway Error: {exc.message}",
                "correlation_id": correlation_id,
                "timestamp": now_local_iso(),
            }
        },
    )


@app.exception_handler(PanicRoomError)
async def panic_room_exception_handler(request: Request, exc: PanicRoomError) -> JSONResponse:
    correlation_id = str(uuid.uuid4())
    status_code = status.HTTP_404_NOT_FOUND if isinstance(exc, SnapshotNotFoundError) else status.HTTP_500_INTERNAL_SERVER_ERROR
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": status_code,
                "message": exc.message,
                "details": exc.details,
                "correlation_id": correlation_id,
                "timestamp": now_local_iso(),
            }
        },
    )


@app.exception_handler(HTTPException)
async def custom_http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    correlation_id = str(uuid.uuid4())
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.status_code,
                "message": exc.detail,
                "correlation_id": correlation_id,
                "timestamp": now_local_iso(),
            }
        },
    )


# ============================================================================
# 6. LAYER A: DYNAMIC ROBOTS.TXT
# ============================================================================

@app.get("/robots.txt", response_class=PlainTextResponse)
async def get_robots_txt() -> PlainTextResponse:
    """Layer A: Returns dynamic robots.txt blocking scrapers from public source trees."""
    return PlainTextResponse(
        content=DYNAMIC_ROBOTS_TXT_BODY,
        media_type="text/plain; charset=utf-8",
        headers={
            "Cache-Control": "public, max-age=3600",
            "X-Robots-Tag": "noindex, nofollow, noarchive",
        },
    )


# ============================================================================
# 7. PANIC ROOM SNAPSHOTS & EMERGENCY HARD RESET
# ============================================================================

class CreateSnapshotRequest(BaseModel):
    repo_id: int = Field(..., gt=0)
    snapshot_name: str = Field(..., min_length=1, max_length=128)
    message: str | None = None


class SnapshotResponse(BaseModel):
    status: str = "created"
    repository_id: int
    forgejo_repo_id: int
    tag_name: str
    sanitized_name: str
    target_commit_sha: str
    commit_message: str
    author_name: str
    author_email: str
    created_at: str
    is_head_commit: bool


class RollbackRequest(BaseModel):
    repo_id: int = Field(..., gt=0)
    snapshot_name: str = Field(..., min_length=1, max_length=128)


class RollbackResponse(BaseModel):
    status: str = "rolled_back"
    repository_id: int
    forgejo_repo_id: int
    tag_name: str
    target_commit_sha: str
    previous_head_sha: str
    purged_untracked_count: int
    purged_entries: list[str]
    executed_at: str
    repository_path: str


@app.post(
    "/api/v1/panic/snapshots",
    response_model=SnapshotResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_panic_snapshot(
    payload: CreateSnapshotRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> SnapshotResponse:
    """Creates a safe haven tag formatted as panic_room_launchpadre_<name> linked to HEAD."""
    repo_stmt = select(Repository).where(
        (Repository.forgejo_repo_id == payload.repo_id) | (Repository.id == payload.repo_id)
    )
    repo = (await session.execute(repo_stmt)).scalars().first()
    if repo is None:
        raise HTTPException(status_code=404, detail=f"Repository '{payload.repo_id}' not found.")

    fs_path = await resolve_repo_fs_path(repo)
    snapshot = await panic_room_manager.create_safe_snapshot(
        repo_path=fs_path,
        custom_name=payload.snapshot_name,
        message=payload.message,
    )

    return SnapshotResponse(
        status="created",
        repository_id=repo.id,
        forgejo_repo_id=repo.forgejo_repo_id,
        tag_name=snapshot.tag_name,
        sanitized_name=snapshot.sanitized_name,
        target_commit_sha=snapshot.target_commit_sha,
        commit_message=snapshot.commit_message,
        author_name=snapshot.author_name,
        author_email=snapshot.author_email,
        created_at=snapshot.created_at_iso,
        is_head_commit=snapshot.is_head_commit,
    )


@app.post(
    "/api/v1/panic/rollback",
    response_model=RollbackResponse,
    status_code=status.HTTP_200_OK,
)
async def execute_emergency_rollback(
    payload: RollbackRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> RollbackResponse:
    """Atomic emergency rollback: git reset --hard <tag> followed by git clean -fd filesystem sweep."""
    repo_stmt = select(Repository).where(
        (Repository.forgejo_repo_id == payload.repo_id) | (Repository.id == payload.repo_id)
    )
    repo = (await session.execute(repo_stmt)).scalars().first()
    if repo is None:
        raise HTTPException(status_code=404, detail=f"Repository '{payload.repo_id}' not found.")

    fs_path = await resolve_repo_fs_path(repo)
    result = await panic_room_manager.emergency_hard_reset(
        repo_path=fs_path,
        snapshot_name=payload.snapshot_name,
    )

    return RollbackResponse(
        status=result.status,
        repository_id=repo.id,
        forgejo_repo_id=repo.forgejo_repo_id,
        tag_name=result.tag_name,
        target_commit_sha=result.target_commit_sha,
        previous_head_sha=result.previous_head_sha,
        purged_untracked_count=result.purged_untracked_count,
        purged_entries=result.purged_entries,
        executed_at=result.executed_at_iso,
        repository_path=result.repository_path,
    )


# ============================================================================
# 8. ZENODO ACADEMIC DOI MINTING
# ============================================================================

@app.post(
    "/api/v1/academic/doi/mint",
    response_model=AcademicDoiResponse,
    status_code=status.HTTP_201_CREATED,
)
async def mint_academic_doi(
    payload: ZenodoMintRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AcademicDoiResponse:
    repo_stmt = select(Repository).where(
        (Repository.forgejo_repo_id == payload.repo_id) | (Repository.id == payload.repo_id)
    )
    repo = (await session.execute(repo_stmt)).scalars().first()
    if repo is None:
        raise HTTPException(status_code=404, detail=f"Repository '{payload.repo_id}' not found.")

    fs_path = await resolve_repo_fs_path(repo)
    target_sha = payload.commit_sha
    if not target_sha:
        latest_commit = (
            await session.execute(
                select(Commit).where(Commit.repository_id == repo.id).order_by(Commit.committed_at.desc()).limit(1)
            )
        ).scalar_one_or_none()
        target_sha = latest_commit.commit_sha if latest_commit else "0000000000000000000000000000000000000000"

    zip_path = zenodo_publisher.create_repository_zip(
        source_dir=fs_path,
        repo_name=repo.name,
        commit_sha=target_sha,
    )

    result = zenodo_publisher.publish_deposition(
        zip_path=zip_path,
        title=payload.title,
        description=payload.description,
        creator_name=payload.creator_name,
        creator_affiliation=payload.creator_affiliation,
    )

    registry_entry = AcademicDoiRegistry(
        repository_id=repo.id,
        commit_sha=target_sha,
        deposition_id=result.deposition_id,
        doi=result.doi,
        doi_url=result.doi_url,
        badge_url=result.badge_url,
        title=result.title,
        archive_filename=result.archive_filename,
        archive_size_bytes=result.archive_size_bytes,
        creator_name=result.creator_name,
        creator_affiliation=result.creator_affiliation,
        metadata_json=result.raw_metadata,
    )
    session.add(registry_entry)
    await session.commit()
    await session.refresh(registry_entry)

    return AcademicDoiResponse(
        id=registry_entry.id,
        repository_id=repo.id,
        forgejo_repo_id=repo.forgejo_repo_id,
        commit_sha=registry_entry.commit_sha,
        deposition_id=registry_entry.deposition_id,
        doi=registry_entry.doi,
        doi_url=registry_entry.doi_url,
        badge_url=registry_entry.badge_url,
        title=registry_entry.title,
        archive_filename=registry_entry.archive_filename,
        archive_size_bytes=registry_entry.archive_size_bytes,
        creator_name=registry_entry.creator_name,
        creator_affiliation=registry_entry.creator_affiliation,
        minted_at=format_dt_local_offset(registry_entry.minted_at),
    )


# ============================================================================
# 9. GIT WEBHOOK & KANBAN ROUTES
# ============================================================================

TODO_DIRECTIVE_PATTERN = re.compile(r"^\s*(?:[-*]\s*)?todo\s*:\s*(?P<title>[^\r\n]+?)\s*$", re.I | re.M)
RESOLVE_DIRECTIVE_PATTERN = re.compile(r"^\s*(?:[-*]\s*)?(?P<verb>fix|close)\s*:\s*(?P<title>[^\r\n]+?)\s*$", re.I | re.M)


async def verify_gitea_signature(
    request: Request,
    x_gitea_signature: Annotated[str | None, Header(alias="X-Gitea-Signature")] = None,
) -> bytes:
    if not x_gitea_signature:
        raise HTTPException(status_code=401, detail="Missing X-Gitea-Signature header.")
    raw_body = await request.body()
    digest = hmac.new(settings.WEBHOOK_SECRET.encode(), raw_body, hashlib.sha256).hexdigest()
    clean_sig = x_gitea_signature.lower().replace("sha256=", "")
    if not hmac.compare_digest(digest, clean_sig):
        raise HTTPException(status_code=401, detail="Invalid X-Gitea-Signature digest.")
    return raw_body


@app.post("/api/v1/webhooks/git-core")
async def ingest_git_webhook(
    raw_body: Annotated[bytes, Depends(verify_gitea_signature)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    payload = json.loads(raw_body.decode())
    repo_data = payload["repository"]
    commits_data = payload.get("commits", [])

    async with session.begin():
        stmt = select(Repository).where(Repository.forgejo_repo_id == repo_data["id"])
        repo = (await session.execute(stmt)).scalar_one_or_none()
        if not repo:
            repo = Repository(
                forgejo_repo_id=repo_data["id"],
                name=repo_data["name"],
                full_name=repo_data.get("full_name", repo_data["name"]),
                default_branch=repo_data.get("default_branch", "main"),
            )
            session.add(repo)
            await session.flush()

        for c in commits_data:
            existing = (await session.execute(select(Commit).where(Commit.commit_sha == c["id"]))).scalar_one_or_none()
            if existing:
                continue
            commit_row = Commit(
                repository_id=repo.id,
                commit_sha=c["id"],
                message=c["message"],
                author_name=c.get("author", {}).get("name", "Unknown"),
                author_email=c.get("author", {}).get("email", "dev@launchpadre.local"),
                committed_at=datetime.fromisoformat(c.get("timestamp", datetime.now(timezone.utc).isoformat())),
            )
            session.add(commit_row)
            await session.flush()

            for line in c["message"].splitlines():
                todo_match = TODO_DIRECTIVE_PATTERN.match(line)
                if todo_match:
                    title = " ".join(todo_match.group("title").split())
                    task = Task(
                        repository_id=repo.id,
                        title=title,
                        status=TaskStatus.TODO,
                        markdown_file_path=f".launchpadre/tasks/{re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')}.md",
                    )
                    session.add(task)
                    await session.flush()
                    session.add(TaskCommitLink(task_id=task.id, commit_id=commit_row.id, action_type="created_todo"))

                resolve_match = RESOLVE_DIRECTIVE_PATTERN.match(line)
                if resolve_match:
                    title = " ".join(resolve_match.group("title").split())
                    target_task = (
                        await session.execute(
                            select(Task).where(Task.repository_id == repo.id, func.lower(Task.title) == title.lower())
                        )
                    ).scalars().first()
                    if target_task:
                        target_task.status = TaskStatus.DONE
                        session.add(TaskCommitLink(task_id=target_task.id, commit_id=commit_row.id, action_type="resolved_fix"))

    return {"status": "committed", "repository_id": repo.id, "processed_commits": len(commits_data)}


@app.get("/api/v1/repositories/{repo_id}/tasks")
async def get_repository_kanban_tasks(
    repo_id: int,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, Any]:
    repo = (
        await session.execute(
            select(Repository).where((Repository.forgejo_repo_id == repo_id) | (Repository.id == repo_id))
        )
    ).scalars().first()
    if not repo:
        raise HTTPException(status_code=404, detail=f"Repository '{repo_id}' not found.")

    tasks = (
        await session.execute(
            select(Task)
            .where(Task.repository_id == repo.id)
            .options(selectinload(Task.commit_links).selectinload(TaskCommitLink.commit))
        )
    ).scalars().all()

    return {
        "repository_id": repo.id,
        "forgejo_repo_id": repo.forgejo_repo_id,
        "repository_name": repo.full_name,
        "todo": [t for t in tasks if t.status == TaskStatus.TODO],
        "in_progress": [t for t in tasks if t.status == TaskStatus.IN_PROGRESS],
        "done": [t for t in tasks if t.status == TaskStatus.DONE],
    }
