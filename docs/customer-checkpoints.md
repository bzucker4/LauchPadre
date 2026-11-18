# Customer Git checkpoints

Customer accounts can connect repositories provisioned by the workspace operator, create checkpoints of committed HEAD, and restore a checkpoint after confirmation. Existing repository and task records continue to work without a Git connection.

## Configure and provision

Set `LAUNCHPADRE_CUSTOMER_GIT_ROOT` to an existing absolute directory reserved for customer repositories. Keep this directory and the SQLite workspace database on persistent storage.

Each customer has a separate directory at `<root>/<customer ID>`. The connection form displays that customer's ID. The operator places a regular Git working repository at `<root>/<customer ID>/<relative path>`. The customer then selects their existing repository record and enters only the relative path, such as `my-project`, in the Git connection form.

Git connections are fixed to their original repository path. Moving or renaming the on-disk directory requires operator assistance. The same path cannot be attached to multiple repository records for the same customer. Absolute paths, traversal, symlink aliases, bare repositories and linked worktrees are rejected. Customer directories must be ordinary directories directly beneath the configured root.

The operator is responsible for source access, ownership verification and provisioning. This workflow does not add a GitHub authorization or clone service.

## Create and restore

Commit work before creating a checkpoint. Names accept 1–64 lowercase letters, digits, underscores or hyphens. A checkpoint is a lightweight Git tag prefixed with `panic_room_launchpadre_`. Repeating a saved name returns the existing checkpoint, including when a request is retried after interruption. Git refs remain the checkpoint records after a server restart.

Free Developer allows one checkpoint per connected repository. Paid plans allow unlimited checkpoints. Existing checkpoints remain visible and restorable after downgrade. Quota checks use the current stored customer plan and run under a SQLite write lock together with checkpoint creation.

Restore requires confirmation, the HEAD shown in the workspace, and the selected checkpoint's recorded commit. The server rejects a changed HEAD, a changed tag, an active Git index lock, and any tracked, untracked or ignored worktree changes. Before resetting, it writes the previous HEAD to a unique `refs/launchpadre/recovery/<UUID>` ref. The success message includes this ref. An operator can inspect it with `git show <ref>` or create a recovery branch with `git branch recovered-work <ref>`.

Git hooks, checkout filters, filesystem monitors and recursive submodule updates are disabled during server Git operations. Checkpoints reference committed Git objects. Provision repositories whose files can be restored directly from those objects. Git LFS downloads and custom checkout transformations require separate operator handling.

## Verification

`node --import tsx --test tests/customerCheckpoints.test.ts` exercises actual temporary Git repositories and a persistent SQLite database. It covers customer isolation, path traversal and symlinks, unborn HEAD, duplicate requests, free and paid limits, downgrade behavior, changed HEAD and tags, untracked and ignored files, disabled executable filters, recovery refs and restart persistence.

On November 18, 2026, the Chromebook production build and TypeScript checks passed. HTTP checks verified binding, checkpoint creation, the free quota, account isolation and rejected dirty/stale restores. Chrome's confirmation flow restored a disposable repository's real HEAD and file contents. Its prior commit remained reachable through the returned recovery ref.
