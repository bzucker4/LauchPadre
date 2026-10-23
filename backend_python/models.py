"""
LaunchPadre — Declarative SQLAlchemy 2.0 Relational Models
Provides models for Users, Repositories, Tasks, Commits, TaskCommitLinks, and AcademicDoiRegistries.
"""

from __future__ import annotations

import enum
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CHAR,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum as SqlEnum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class TaskStatus(str, enum.Enum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    DONE = "done"


class User(Base):
    """User profile record mapped to Stripe customer and subscription credentials."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    plan: Mapped[str] = mapped_column(String(64), nullable=False, default="free")
    is_premium: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    repositories: Mapped[list["Repository"]] = relationship("Repository", back_populates="owner")


class TaskCommitLink(Base):
    """Junction table connecting tasks to the commits that created, modified, or closed them."""

    __tablename__ = "task_commit_links"

    task_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True
    )
    commit_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("commits.id", ondelete="CASCADE"), primary_key=True
    )
    action_type: Mapped[str] = mapped_column(String(32), nullable=False, default="referenced")
    linked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    task: Mapped["Task"] = relationship("Task", back_populates="commit_links")
    commit: Mapped["Commit"] = relationship("Commit", back_populates="task_links")


class Repository(Base):
    """Tracks Forgejo/Gitea repository instances mapped to unique forgejo_repo_id."""

    __tablename__ = "repositories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    forgejo_repo_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(512), nullable=False)
    default_branch: Mapped[str] = mapped_column(String(128), nullable=False, default="main")
    local_path: Mapped[str] = mapped_column(String(1024), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    owner: Mapped["User | None"] = relationship("User", back_populates="repositories")
    tasks: Mapped[list["Task"]] = relationship(
        "Task", back_populates="repository", cascade="all, delete-orphan"
    )
    commits: Mapped[list["Commit"]] = relationship(
        "Commit", back_populates="repository", cascade="all, delete-orphan"
    )
    doi_registries: Mapped[list["AcademicDoiRegistry"]] = relationship(
        "AcademicDoiRegistry", back_populates="repository", cascade="all, delete-orphan"
    )


class Task(Base):
    """Kanban task entity backed by a repository Markdown document."""

    __tablename__ = "tasks"
    __table_args__ = (
        Index("idx_tasks_repo_lower_title", "repository_id", func.lower("title")),
        Index("idx_tasks_repo_status", "repository_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repository_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[TaskStatus] = mapped_column(
        SqlEnum(
            TaskStatus,
            name="task_status_enum",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
        default=TaskStatus.TODO,
    )
    markdown_file_path: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    repository: Mapped["Repository"] = relationship("Repository", back_populates="tasks")
    commit_links: Mapped[list["TaskCommitLink"]] = relationship(
        "TaskCommitLink", back_populates="task", cascade="all, delete-orphan"
    )


class Commit(Base):
    """Git commit log entry tied to a repository and linked tasks."""

    __tablename__ = "commits"
    __table_args__ = (
        CheckConstraint("char_length(commit_sha) = 40", name="ck_commits_sha_length_40"),
        UniqueConstraint("commit_sha", name="uq_commits_commit_sha"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repository_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False, index=True
    )
    commit_sha: Mapped[str] = mapped_column(CHAR(40), nullable=False, unique=True, index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    author_name: Mapped[str] = mapped_column(String(255), nullable=False)
    author_email: Mapped[str] = mapped_column(String(255), nullable=False)
    committed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    repository: Mapped["Repository"] = relationship("Repository", back_populates="commits")
    task_links: Mapped[list["TaskCommitLink"]] = relationship(
        "TaskCommitLink", back_populates="commit", cascade="all, delete-orphan"
    )


class AcademicDoiRegistry(Base):
    """Stores minted Zenodo academic digital object identifiers and citation metadata."""

    __tablename__ = "academic_doi_registries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repository_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False, index=True
    )
    commit_sha: Mapped[str] = mapped_column(CHAR(40), nullable=False, index=True)
    deposition_id: Mapped[str] = mapped_column(String(128), nullable=False)
    doi: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    doi_url: Mapped[str] = mapped_column(String(512), nullable=False)
    badge_url: Mapped[str] = mapped_column(String(512), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    archive_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    archive_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    creator_name: Mapped[str] = mapped_column(String(255), nullable=False)
    creator_affiliation: Mapped[str] = mapped_column(String(512), nullable=False)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    minted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    repository: Mapped["Repository"] = relationship("Repository", back_populates="doi_registries")
