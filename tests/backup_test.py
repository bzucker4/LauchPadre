import importlib.util
from pathlib import Path
import sqlite3
from contextlib import closing
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('backup', Path(__file__).parents[1] / 'scripts' / 'backup.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupTest(unittest.TestCase):
    def test_restore_preserves_database_and_git_refs_without_overwriting_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            database = root / 'original.db'
            with closing(sqlite3.connect(database)) as db:
                db.execute('CREATE TABLE accounts (email TEXT)')
                db.execute("INSERT INTO accounts VALUES ('customer@example.com')")
                db.commit()
            git_root = root / 'customer-git'
            repo = git_root / 'customer' / 'repo'
            repo.mkdir(parents=True)
            def git(*args):
                return subprocess.check_output(['git', '-C', str(repo), *args], stderr=subprocess.DEVNULL, text=True).strip()
            git('init')
            git('config', 'user.name', 'Backup Test')
            git('config', 'user.email', 'backup@example.com')
            (repo / 'file.txt').write_text('preserved work')
            git('add', '.')
            git('commit', '-m', 'Backup fixture')
            git('tag', 'panic_room_launchpadre_first')
            git('update-ref', 'refs/launchpadre/recovery/test', 'HEAD')
            (repo / 'untracked.txt').write_text('uncommitted work')
            (repo / 'link').symlink_to('file.txt')
            original_sha = git('rev-parse', 'HEAD')
            saved = backup.backup(database, root / 'saved', git_root)
            with closing(sqlite3.connect(database)) as db:
                db.execute("INSERT INTO accounts VALUES ('later@example.com')")
                db.commit()
            restored = backup.restore(saved, root / 'restored')
            with closing(sqlite3.connect(restored / 'workspace.db')) as db:
                self.assertEqual(db.execute('SELECT email FROM accounts').fetchall(), [('customer@example.com',)])
            with closing(sqlite3.connect(database)) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM accounts').fetchone()[0], 2)
            restored_repo = restored / 'customer-git/customer/repo'
            self.assertEqual((restored_repo / 'untracked.txt').read_text(), 'uncommitted work')
            self.assertTrue((restored_repo / 'link').is_symlink())
            for ref in ['HEAD', 'refs/tags/panic_room_launchpadre_first', 'refs/launchpadre/recovery/test']:
                result = subprocess.check_output(['git', '-C', str(restored_repo), 'rev-parse', ref], text=True).strip()
                self.assertEqual(result, original_sha)
            with self.assertRaises(FileExistsError):
                backup.restore(saved, restored)
            (saved / 'customer-git/customer/repo/untracked.txt').write_text('corrupted')
            with self.assertRaisesRegex(ValueError, 'checksums'):
                backup.restore(saved, root / 'refused')
            self.assertFalse((root / 'refused').exists())


if __name__ == '__main__':
    unittest.main()
