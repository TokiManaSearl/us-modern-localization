"""Integration tests: only temporary fixtures, never the user's real home.

Run from the repository root: python -B -m unittest discover -s tests -v
"""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


INSTALLER = Path(__file__).resolve().parents[1] / "install.py"
SKILL_NAME = "us-modern-localization"


class InstallerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="local-skill-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.fixture = self.root / "fixture"
        self.fixture.mkdir()
        self.script = self.fixture / "install.py"
        shutil.copyfile(INSTALLER, self.script)
        self.source = self.fixture / "skills" / SKILL_NAME
        (self.source / "references").mkdir(parents=True)
        (self.source / "SKILL.md").write_text("---\nname: us-modern-localization\n---\nTest fixture.\n", encoding="utf-8")
        (self.source / "references" / "example.md").write_text("Reference fixture: café, 示例.\n", encoding="utf-8")
        self.parent = self.root / "chosen" / ".agents" / "skills"
        self.target = self.parent / SKILL_NAME
        self.environment = dict(os.environ)
        self.environment["CODEX_HOME"] = str(self.root / "codex-home")
        self.environment["PYTHONDONTWRITEBYTECODE"] = "1"
        # Also isolate home in case a regression ignores CODEX_HOME.
        self.environment["HOME"] = str(self.root / "isolated-home")
        self.environment["USERPROFILE"] = str(self.root / "isolated-home")

    def run_install(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, "-B", str(self.script), *map(str, arguments)],
            cwd=self.fixture,
            env=self.environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
            check=False,
        )

    def assert_failed(self, result: subprocess.CompletedProcess[str]) -> None:
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("Nothing was automatically deleted or overwritten", result.stderr)

    def make_symlink(self, path: Path, target: Path, directory: bool = False) -> None:
        try:
            path.symlink_to(target, target_is_directory=directory)
        except (OSError, NotImplementedError) as error:
            self.skipTest(f"Platform cannot create the required symlink: {error}")

    def assert_copied(self, target: Path) -> None:
        self.assertEqual((target / "SKILL.md").read_bytes(), (self.source / "SKILL.md").read_bytes())
        self.assertEqual((target / "references" / "example.md").read_bytes(), (self.source / "references" / "example.md").read_bytes())
        self.assertEqual(
            sorted(str(path.relative_to(target)) for path in target.rglob("*")),
            sorted(str(path.relative_to(self.source)) for path in self.source.rglob("*")),
        )
        self.assertFalse((target / "AGENTS.md").exists())

    def test_normal_copy_to_explicit_parent(self) -> None:
        result = self.run_install("--dest", self.parent)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_copied(self.target)
        self.assertFalse((self.root / "codex-home").exists())

    def test_codex_home_default_is_temporary(self) -> None:
        result = self.run_install()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_copied(self.root / "codex-home" / "skills" / SKILL_NAME)

    def test_repeat_refuses_and_preserves_existing_file(self) -> None:
        first = self.run_install("--dest", self.parent)
        self.assertEqual(first.returncode, 0, first.stderr)
        original = b"User changes must survive.\n"
        (self.target / "SKILL.md").write_bytes(original)
        result = self.run_install("--dest", self.parent)
        self.assert_failed(result)
        self.assertIn("already exists", result.stderr)
        self.assertEqual((self.target / "SKILL.md").read_bytes(), original)

    def test_existing_file_refused(self) -> None:
        self.parent.mkdir(parents=True)
        self.target.write_bytes(b"existing target")
        result = self.run_install("--dest", self.parent)
        self.assert_failed(result)
        self.assertEqual(self.target.read_bytes(), b"existing target")

    def test_dry_run_does_not_create_parents(self) -> None:
        before = sorted(str(path.relative_to(self.root)) for path in self.root.rglob("*"))
        result = self.run_install("--dest", self.parent, "--dry-run")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("No files or directories were written", result.stdout)
        self.assertFalse(self.parent.exists())
        after = sorted(str(path.relative_to(self.root)) for path in self.root.rglob("*"))
        self.assertEqual(before, after)

    def test_default_dry_run_does_not_create_codex_home(self) -> None:
        result = self.run_install("--dry-run")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.root / "codex-home").exists())

    def test_missing_skill_file_rejected_before_writes(self) -> None:
        (self.source / "SKILL.md").unlink()
        self.assert_failed(self.run_install("--dest", self.parent))
        self.assertFalse(self.parent.exists())

    def test_skill_file_cannot_be_directory(self) -> None:
        (self.source / "SKILL.md").unlink()
        (self.source / "SKILL.md").mkdir()
        self.assert_failed(self.run_install("--dest", self.parent))
        self.assertFalse(self.parent.exists())

    def test_source_root_must_be_directory(self) -> None:
        shutil.rmtree(self.source)
        self.source.write_text("not a directory", encoding="utf-8")
        self.assert_failed(self.run_install("--dest", self.parent))
        self.assertFalse(self.parent.exists())

    def test_source_symlink_rejected_even_for_internal_file(self) -> None:
        self.make_symlink(self.source / "reference-link", self.source / "references" / "example.md")
        result = self.run_install("--dest", self.parent)
        self.assert_failed(result)
        self.assertIn("Symlink, junction, or reparse point", result.stderr)
        self.assertFalse(self.parent.exists())

    def test_nested_escape_symlink_rejected_before_any_copy(self) -> None:
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "private.txt").write_bytes(b"must not copy")
        self.make_symlink(self.source / "references" / "zz-escape", outside, directory=True)
        self.assert_failed(self.run_install("--dest", self.parent))
        self.assertFalse(self.parent.exists())
        self.assertEqual((outside / "private.txt").read_bytes(), b"must not copy")

    def test_source_root_symlink_rejected(self) -> None:
        real_source = self.fixture / "real-source"
        self.source.rename(real_source)
        self.make_symlink(self.source, real_source, directory=True)
        self.assert_failed(self.run_install("--dest", self.parent))
        self.assertFalse(self.parent.exists())

    def test_broken_source_symlink_rejected(self) -> None:
        self.make_symlink(self.source / "broken-link", self.root / "missing")
        self.assert_failed(self.run_install("--dest", self.parent, "--dry-run"))
        self.assertFalse(self.parent.exists())

    def test_broken_destination_symlink_is_not_overwritten(self) -> None:
        self.parent.mkdir(parents=True)
        missing = self.root / "missing-target"
        self.make_symlink(self.target, missing, directory=True)
        original_link = self.target.readlink()
        result = self.run_install("--dest", self.parent)
        self.assert_failed(result)
        self.assertIn("already exists", result.stderr)
        self.assertTrue(self.target.is_symlink())
        self.assertEqual(self.target.readlink(), original_link)
        self.assertFalse(missing.exists())

    def test_destination_parent_symlink_rejected(self) -> None:
        outside = self.root / "outside-parent"
        outside.mkdir()
        link_parent = self.root / "linked-parent"
        self.make_symlink(link_parent, outside, directory=True)
        self.assert_failed(self.run_install("--dest", link_parent))
        self.assertEqual(list(outside.iterdir()), [])

    def test_overlapping_destination_rejected(self) -> None:
        self.assert_failed(self.run_install("--dest", self.source / "inside"))
        self.assertFalse((self.source / "inside").exists())

    def test_force_option_is_not_supported(self) -> None:
        result = self.run_install("--dest", self.parent, "--force")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unrecognized arguments", result.stderr)
        self.assertFalse(self.parent.exists())

    @unittest.skipUnless(os.name == "nt", "Windows junction test")
    def test_windows_junction_rejected(self) -> None:
        outside = self.root / "junction-target"
        outside.mkdir()
        junction = self.source / "references" / "junction"
        result = subprocess.run(
            ["cmd", "/d", "/c", "mklink", "/J", str(junction), str(outside)],
            capture_output=True, text=True, timeout=15, check=False,
        )
        if result.returncode != 0:
            self.skipTest(f"Platform cannot create a junction: {result.stderr}")
        self.assert_failed(self.run_install("--dest", self.parent))
        self.assertFalse(self.parent.exists())
        self.assertEqual(list(outside.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
