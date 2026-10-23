-- LaunchPadre (CraftGit) — Complete Relational Schema (Phases 1, 2 & 3)
-- Relational tables for Git repositories, Kanban tasks, commits, panic snapshots,
-- billing subscriptions, and Zenodo academic DOI registries.

CREATE EXTENSION IF NOT EXISTS citext;

DO $$ BEGIN
    CREATE TYPE task_status_enum AS ENUM ('todo', 'in_progress', 'done');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 1. User Profiles & Stripe Monetization State
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(128) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    plan VARCHAR(64) NOT NULL DEFAULT 'free', -- 'free', 'indie_solo', 'academic_tier'
    is_premium BOOLEAN NOT NULL DEFAULT FALSE,
    stripe_customer_id VARCHAR(255) UNIQUE,
    stripe_subscription_id VARCHAR(255) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users (stripe_customer_id);

-- 2. Git Forge Repositories
CREATE TABLE IF NOT EXISTS repositories (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    forgejo_repo_id INTEGER NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    full_name VARCHAR(512) NOT NULL,
    default_branch VARCHAR(128) NOT NULL DEFAULT 'main',
    local_path VARCHAR(1024) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_repositories_forgejo_repo_id ON repositories (forgejo_repo_id);

-- 3. Kanban Markdown Tasks
CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    status task_status_enum NOT NULL DEFAULT 'todo',
    markdown_file_path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_repo_lower_title ON tasks (repository_id, LOWER(title));
CREATE INDEX IF NOT EXISTS idx_tasks_repo_status ON tasks (repository_id, status);

-- 4. Commit Logs
CREATE TABLE IF NOT EXISTS commits (
    id SERIAL PRIMARY KEY,
    repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    commit_sha CHAR(40) NOT NULL UNIQUE CHECK (char_length(commit_sha) = 40),
    message TEXT NOT NULL,
    author_name VARCHAR(255) NOT NULL,
    author_email VARCHAR(255) NOT NULL,
    committed_at TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_commits_sha ON commits (commit_sha);
CREATE INDEX IF NOT EXISTS idx_commits_repo_id ON commits (repository_id);

-- 5. Task-to-Commit Junction Lineage
CREATE TABLE IF NOT EXISTS task_commit_links (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    commit_id INTEGER NOT NULL REFERENCES commits(id) ON DELETE CASCADE,
    action_type VARCHAR(32) NOT NULL DEFAULT 'referenced',
    linked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (task_id, commit_id)
);

CREATE INDEX IF NOT EXISTS idx_task_commit_links_commit_id ON task_commit_links (commit_id);

-- 6. Zenodo Academic DOI Minting Registries
CREATE TABLE IF NOT EXISTS academic_doi_registries (
    id SERIAL PRIMARY KEY,
    repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    commit_sha CHAR(40) NOT NULL,
    deposition_id VARCHAR(128) NOT NULL,
    doi VARCHAR(255) NOT NULL UNIQUE,
    doi_url VARCHAR(512) NOT NULL,
    badge_url VARCHAR(512) NOT NULL,
    title VARCHAR(500) NOT NULL,
    archive_filename VARCHAR(255) NOT NULL,
    archive_size_bytes BIGINT NOT NULL DEFAULT 0,
    creator_name VARCHAR(255) NOT NULL,
    creator_affiliation VARCHAR(512) NOT NULL,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    minted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_academic_doi_repo_id ON academic_doi_registries (repository_id);
CREATE INDEX IF NOT EXISTS idx_academic_doi_commit_sha ON academic_doi_registries (commit_sha);
