"""
LaunchPadre Phase 2 — Panic Room Rollback Engine Specification
Target: Python 3.11+ | GitPython 3.1+ | Asyncio Thread-Safe Mutual Exclusion

Provides isolated, thread-safe Git repository snapshotting, atomic hard resets,
and filesystem sweep routines to eliminate AI-generated untracked file slop.
"""

from __future__ import annotations

import asyncio
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import git
from git.exc import GitCommandError, InvalidGitRepositoryError, NoSuchPathError


NAME_SANITIZE_REGEX = re.compile(r"[^a-zA-Z0-9_\-]+")
INIT_TRACKER_FILENAME = ".launchpadre_init"
TAG_PREFIX = "panic_room_launchpadre_"


@dataclass(frozen=True)
class SnapshotRecord:
    tag_name: str
    sanitized_name: str
    target_commit_sha: str
    commit_message: str
    author_name: str
    author_email: str
    created_at_iso: str
    is_head_commit: bool


@dataclass(frozen=True)
class RollbackResult:
    status: str
    tag_name: str
    target_commit_sha: str
    previous_head_sha: str
    purged_untracked_count: int
    purged_entries: list[str]
    executed_at_iso: str
    repository_path: str


class PanicRoomError(Exception):
    """Base exception for LaunchPadre Panic Room operations."""
    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class SnapshotNotFoundError(PanicRoomError):
    """Raised when the specified Panic Room snapshot does not exist."""
    pass


class PanicRoomManager:
    """
    Manages local Git repository safety snapshots and emergency rollbacks for LaunchPadre.
    Guarantees mutual exclusion across concurrent worker threads for any given repository,
    formats tags as `panic_room_launchpadre_<name>`, and executes atomic hard resets + filesystem purges.
    """

    def __init__(self, default_base_dir: str | Path | None = None) -> None:
        self.base_dir = Path(default_base_dir or os.getenv("GIT_REPOSITORIES_ROOT", "/var/git/launchpadre"))
        self._repo_locks: dict[str, asyncio.Lock] = {}
        self._global_lock = asyncio.Lock()

    async def _get_repo_lock(self, repo_key: str) -> asyncio.Lock:
        """Retrieve or create an asyncio.Lock keyed strictly to the repository identifier."""
        async with self._global_lock:
            if repo_key not in self._repo_locks:
                self._repo_locks[repo_key] = asyncio.Lock()
            return self._repo_locks[repo_key]

    @staticmethod
    def sanitize_snapshot_name(name: str) -> str:
        """
        Sanitize user-provided snapshot names into valid Git tag segments.
        Strips invalid characters, enforces lowercase, and clamps length to 64 chars.
        """
        clean = NAME_SANITIZE_REGEX.sub("_", name.strip().lower()).strip("_")
        if not clean:
            clean = "manual_checkpoint"
        return clean[:64]

    @staticmethod
    def format_tag_name(sanitized_name: str) -> str:
        """Construct the canonical LaunchPadre Panic Room Git tag name."""
        return f"{TAG_PREFIX}{sanitized_name}"

    def _open_git_repo(self, repo_path: str | Path) -> git.Repo:
        """Safely open, initialize, and validate a local Git repository."""
        target_path = Path(repo_path)
        if not target_path.exists():
            target_path.mkdir(parents=True, exist_ok=True)
            return git.Repo.init(target_path)
        try:
            return git.Repo(target_path)
        except InvalidGitRepositoryError:
            return git.Repo.init(target_path)
        except NoSuchPathError as exc:
            raise PanicRoomError(f"No such directory: {target_path}", {"path": str(target_path)}) from exc

    def ensure_valid_head(self, repo: git.Repo) -> None:
        """
        Unborn HEAD Guard:
        If repo.head.is_valid() returns False (indicating an unborn HEAD state because
        no commits exist yet), programmatically stage an empty tracker file (.launchpadre_init)
        and run a system commit to establish a valid HEAD for subsequent snapshots.
        """
        if not repo.head.is_valid():
            working_dir = Path(repo.working_tree_dir or repo.git_dir)
            tracker_file = working_dir / INIT_TRACKER_FILENAME
            now_str = datetime.now().astimezone().isoformat()
            tracker_file.write_text(
                f"# LaunchPadre Initialized Repository Tracker\nTimestamp: {now_str}\n",
                encoding="utf-8",
            )
            try:
                repo.index.add([str(tracker_file.name)])
                repo.index.commit("Initial empty commit for LaunchPadre snapshot tracking verification")
            except GitCommandError as exc:
                raise PanicRoomError(
                    f"Failed to bootstrap unborn HEAD on repository: {exc.stderr or str(exc)}"
                ) from exc

    async def create_safe_snapshot(
        self,
        repo_path: str | Path,
        custom_name: str,
        message: str | None = None,
    ) -> SnapshotRecord:
        """
        Safely creates an un-detached Git tag formatted as panic_room_launchpadre_<name>
        linked to the current HEAD commit. Thread-safe via per-repository lock.
        """
        repo_key = str(Path(repo_path).resolve())
        lock = await self._get_repo_lock(repo_key)

        async with lock:
            return await asyncio.to_thread(self._sync_create_snapshot, repo_path, custom_name, message)

    async def create_snapshot(
        self,
        repo_path: str | Path,
        custom_name: str,
        message: str | None = None,
    ) -> SnapshotRecord:
        """Alias for create_safe_snapshot."""
        return await self.create_safe_snapshot(repo_path, custom_name, message)

    def _sync_create_snapshot(
        self,
        repo_path: str | Path,
        custom_name: str,
        message: str | None = None,
    ) -> SnapshotRecord:
        repo = self._open_git_repo(repo_path)
        self.ensure_valid_head(repo)

        sanitized = self.sanitize_snapshot_name(custom_name)
        tag_name = self.format_tag_name(sanitized)

        try:
            head_commit = repo.head.commit
        except (ValueError, AttributeError) as exc:
            raise PanicRoomError("Repository has an unborn HEAD even after bootstrap.") from exc

        tag_message = message or f"LaunchPadre Panic Room Snapshot: {sanitized} at commit {head_commit.hexsha[:8]}"

        try:
            # Overwrite or create tag pointing to current HEAD commit
            tag = repo.create_tag(
                path=tag_name,
                ref=head_commit,
                message=tag_message,
                force=True,
            )

            commit_obj = tag.commit if tag.tag else head_commit
            now_iso = datetime.now().astimezone().isoformat(timespec="seconds")
            return SnapshotRecord(
                tag_name=tag_name,
                sanitized_name=sanitized,
                target_commit_sha=commit_obj.hexsha,
                commit_message=commit_obj.message.strip(),
                author_name=str(commit_obj.author.name or "LaunchPadre System"),
                author_email=str(commit_obj.author.email or "system@launchpadre.local"),
                created_at_iso=now_iso,
                is_head_commit=True,
            )
        except GitCommandError as exc:
            raise PanicRoomError(
                f"Failed to generate LaunchPadre Panic Room snapshot tag '{tag_name}': {exc.stderr or str(exc)}",
                {"stderr": exc.stderr, "status": exc.status},
            ) from exc

    async def emergency_hard_reset(
        self,
        repo_path: str | Path,
        snapshot_name: str,
    ) -> RollbackResult:
        """
        Execute an atomic emergency rollback:
        1. Hard resets HEAD and index to the targeted tag (git reset --hard).
        2. Executes a filesystem clean sweep (git clean -fd) to wipe untracked AI assistant slop.
        Thread-safe via per-repository lock.
        """
        repo_key = str(Path(repo_path).resolve())
        lock = await self._get_repo_lock(repo_key)

        async with lock:
            return await asyncio.to_thread(self._sync_emergency_hard_reset, repo_path, snapshot_name)

    def _sync_emergency_hard_reset(
        self,
        repo_path: str | Path,
        snapshot_name: str,
    ) -> RollbackResult:
        repo = self._open_git_repo(repo_path)
        self.ensure_valid_head(repo)

        sanitized = self.sanitize_snapshot_name(snapshot_name)
        canonical_tag = self.format_tag_name(sanitized)

        # Search for tag matching either formatted canonical name, user input, or legacy format
        target_tag: git.TagReference | None = None
        for tag in repo.tags:
            if tag.name == canonical_tag or tag.name == snapshot_name or tag.name.endswith(sanitized):
                target_tag = tag
                canonical_tag = tag.name
                break

        if target_tag is None:
            available_tags = [t.name for t in repo.tags if "panic_room" in t.name]
            raise SnapshotNotFoundError(
                f"LaunchPadre Panic Room snapshot tag '{canonical_tag}' does not exist.",
                {"target_tag": canonical_tag, "available_panic_room_snapshots": available_tags},
            )

        previous_head_sha = repo.head.commit.hexsha
        target_commit_sha = target_tag.commit.hexsha

        try:
            # 1. Hard reset active HEAD index to the targeted snapshot tag commit
            repo.git.reset("--hard", canonical_tag)

            # 2. Inspect untracked files before running clean sweep
            untracked_before = list(repo.untracked_files)

            # 3. Filesystem Purge: clean sweep of untracked files and directories (-f force, -d directories)
            clean_output = repo.git.clean("-fd")
            purged_lines = [line.strip() for line in clean_output.splitlines() if line.strip()]

            all_purged_items = list(dict.fromkeys([*untracked_before, *purged_lines]))
            now_iso = datetime.now().astimezone().isoformat(timespec="seconds")

            return RollbackResult(
                status="rolled_back",
                tag_name=canonical_tag,
                target_commit_sha=target_commit_sha,
                previous_head_sha=previous_head_sha,
                purged_untracked_count=len(all_purged_items),
                purged_entries=all_purged_items,
                executed_at_iso=now_iso,
                repository_path=str(repo_path),
            )
        except GitCommandError as exc:
            raise PanicRoomError(
                f"Emergency rollback failed on repository '{repo_path}': {exc.stderr or str(exc)}",
                {"stderr": exc.stderr, "status": exc.status},
            ) from exc

    async def list_snapshots(self, repo_path: str | Path) -> list[SnapshotRecord]:
        """List all active LaunchPadre Panic Room snapshots in chronological order."""
        repo_key = str(Path(repo_path).resolve())
        lock = await self._get_repo_lock(repo_key)

        async with lock:
            return await asyncio.to_thread(self._sync_list_snapshots, repo_path)

    def _sync_list_snapshots(self, repo_path: str | Path) -> list[SnapshotRecord]:
        repo = self._open_git_repo(repo_path)
        if not repo.head.is_valid():
            return []

        head_sha = repo.head.commit.hexsha if repo.head.is_valid() else ""
        records: list[SnapshotRecord] = []

        for tag in repo.tags:
            if not tag.name.startswith(TAG_PREFIX) and not tag.name.startswith("panic_room_"):
                continue

            sanitized = (
                tag.name[len(TAG_PREFIX):]
                if tag.name.startswith(TAG_PREFIX)
                else tag.name[len("panic_room_"):]
            )
            commit_obj = tag.commit
            committed_dt = datetime.fromtimestamp(commit_obj.committed_date, tz=timezone.utc).astimezone()

            records.append(
                SnapshotRecord(
                    tag_name=tag.name,
                    sanitized_name=sanitized,
                    target_commit_sha=commit_obj.hexsha,
                    commit_message=commit_obj.message.strip(),
                    author_name=str(commit_obj.author.name or "Unknown"),
                    author_email=str(commit_obj.author.email or "dev@launchpadre.local"),
                    created_at_iso=committed_dt.isoformat(timespec="seconds"),
                    is_head_commit=(commit_obj.hexsha == head_sha),
                )
            )

        records.sort(key=lambda r: r.created_at_iso, reverse=True)
        return records
