#!/usr/bin/env python3
"""Back up SQLite and provisioned customer Git files, or restore to a new directory."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
from contextlib import closing
import sys


def inventory(directory):
    entries = {}
    for item in sorted(directory.rglob('*')):
        name = item.relative_to(directory).as_posix()
        if name in ('manifest.json', '.incomplete'):
            continue
        if item.is_symlink():
            entries[name] = {'kind': 'symlink', 'target': os.readlink(item)}
        elif item.is_file():
            digest = hashlib.sha256()
            with item.open('rb') as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(chunk)
            entries[name] = {'kind': 'file', 'sha256': digest.hexdigest()}
        elif item.is_dir():
            entries[name] = {'kind': 'directory'}
        else:
            raise ValueError('Backup contains an unsupported special file')
    return entries


def check_database(filename):
    with closing(sqlite3.connect(filename.as_uri() + '?mode=ro', uri=True)) as db:
        if db.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
            raise ValueError('SQLite integrity check failed')


def backup(database, destination, git_root=None):
    database = database.resolve(strict=True)
    destination = destination.resolve()
    if git_root:
        git_root = git_root.resolve(strict=True)
        if destination == git_root or git_root in destination.parents:
            raise ValueError('Place backups outside the customer Git root')
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    marker = destination / '.incomplete'
    marker.touch(mode=0o600)
    # Serialize app database/Git mutations for the duration of the snapshot.
    # External tools editing provisioned repositories must also be paused.
    lock = sqlite3.connect(database.as_uri() + '?mode=rw', uri=True, timeout=30)
    try:
        lock.execute('BEGIN IMMEDIATE')
        source = sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)
        output = sqlite3.connect(destination / 'workspace.db')
        try:
            source.backup(output)
        finally:
            output.close()
            source.close()
        if git_root:
            shutil.copytree(git_root, destination / 'customer-git', symlinks=True)
        check_database(destination / 'workspace.db')
        manifest = {'version': 1, 'entries': inventory(destination)}
        (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        marker.unlink()
    finally:
        lock.rollback()
        lock.close()
    return destination


def restore(source, destination):
    source = source.resolve(strict=True)
    destination = destination.resolve()
    if destination == source or source in destination.parents:
        raise ValueError('Restore to a new directory outside the backup')
    if (source / '.incomplete').exists():
        raise ValueError('Backup did not finish')
    manifest = json.loads((source / 'manifest.json').read_text())
    if manifest.get('version') != 1 or manifest.get('entries') != inventory(source):
        raise ValueError('Backup manifest or checksums do not match')
    if (source / 'workspace.db').is_symlink():
        raise ValueError('Backup database must be a regular file')
    check_database(source / 'workspace.db')
    # Never replace an existing workspace or database.
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    shutil.copy2(source / 'workspace.db', destination / 'workspace.db')
    if (source / 'customer-git').exists():
        if (source / 'customer-git').is_symlink():
            raise ValueError('Backup Git root must be an ordinary directory')
        shutil.copytree(source / 'customer-git', destination / 'customer-git', symlinks=True)
    check_database(destination / 'workspace.db')
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('backup')
    create.add_argument('database', type=Path)
    create.add_argument('destination', type=Path)
    create.add_argument('--git-root', type=Path)
    recover = commands.add_parser('restore')
    recover.add_argument('source', type=Path)
    recover.add_argument('destination', type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        result = backup(args.database, args.destination, args.git_root) if args.command == 'backup' else restore(args.source, args.destination)
        print('Completed:', result)
    except (OSError, ValueError, sqlite3.Error) as error:
        print('Backup operation failed:', error, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
