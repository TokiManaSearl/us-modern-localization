#!/usr/bin/env python3
"""Install the bundled skill locally with Python 3.10+; never overwrite or delete.

Usage: python install.py [--dest SKILLS_PARENT] [--dry-run]
The default parent is $CODEX_HOME/skills or ~/.codex/skills. For example,
--dest ~/.agents/skills selects an alternative skills parent.
This script does not execute skill content, access the network, or edit user
configuration. Keep the source and destination private from concurrent writers.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import stat
import sys
from typing import NamedTuple


SKILL_NAME = "us-modern-localization"
REPARSE_POINT = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)


class InstallError(Exception):
    """A safety check rejected this installation."""


class Entry(NamedTuple):
    relative: Path
    is_directory: bool
    identity: tuple[int, int, int, int]


def identity(info: os.stat_result) -> tuple[int, int, int, int]:
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)


def inspect(path: Path) -> os.stat_result:
    """lstat also detects broken symlinks; reject every Windows reparse point."""
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & REPARSE_POINT:
        raise InstallError(f"Symlink, junction, or reparse point is not allowed: {path}")
    if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
        raise InstallError(f"Only ordinary directories and regular files are allowed: {path}")
    return info


def inspect_ancestors(path: Path) -> None:
    for parent in reversed(path.parents):
        try:
            info = inspect(parent)
        except FileNotFoundError:
            continue
        if not stat.S_ISDIR(info.st_mode):
            raise InstallError(f"Parent is not an ordinary directory: {parent}")


def exists_without_following(path: Path) -> bool:
    try:
        path.lstat()
    except FileNotFoundError:
        return False
    return True


def validate_source(source: Path) -> list[Entry]:
    inspect_ancestors(source)
    if not stat.S_ISDIR(inspect(source).st_mode):
        raise InstallError(f"Source is not an ordinary directory: {source}")
    if not stat.S_ISREG(inspect(source / "SKILL.md").st_mode):
        raise InstallError("Source must contain a regular SKILL.md file")
    root = source.resolve(strict=True)
    entries: list[Entry] = []

    def visit(directory: Path) -> None:
        with os.scandir(directory) as listing:
            children = sorted(listing, key=lambda item: item.name)
        for child in children:
            path = directory / child.name
            relative = path.relative_to(source)
            if relative.is_absolute() or any(part in ("", ".", "..") for part in relative.parts):
                raise InstallError(f"Unsafe source path: {path}")
            info = inspect(path)
            if not path.resolve(strict=True).is_relative_to(root):
                raise InstallError(f"Source path escapes the skill directory: {path}")
            is_directory = stat.S_ISDIR(info.st_mode)
            entries.append(Entry(relative, is_directory, identity(info)))
            if is_directory:
                visit(path)

    visit(source)
    return entries


def ensure_parent(parent: Path) -> None:
    """Create only missing ordinary parents, refusing symlinks and junctions."""
    for part in [*reversed(parent.parents), parent]:
        try:
            info = inspect(part)
        except FileNotFoundError:
            try:
                part.mkdir()  # Exclusive; a concurrent creator is rechecked below.
            except FileExistsError:
                pass
            info = inspect(part)
        if not stat.S_ISDIR(info.st_mode):
            raise InstallError(f"Destination parent is not an ordinary directory: {part}")


def copy_file(source: Path, destination: Path, expected: Entry) -> None:
    # O_NOFOLLOW protects the final component where supported. Rechecking all
    # parents also rejects links introduced since initial validation; portable
    # Python cannot eliminate all races in a tree writable by another process.
    inspect_ancestors(source)
    info = inspect(source)
    if identity(info) != expected.identity or not stat.S_ISREG(info.st_mode):
        raise InstallError(f"Source changed after validation: {source}")
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(source, flags)
    with os.fdopen(descriptor, "rb") as reader:
        if identity(os.fstat(reader.fileno())) != expected.identity:
            raise InstallError(f"Source changed while opening: {source}")
        inspect_ancestors(destination)
        with destination.open("xb") as writer:
            while block := reader.read(1024 * 1024):
                writer.write(block)
        if identity(os.fstat(reader.fileno())) != expected.identity:
            raise InstallError(f"Source changed during copying: {source}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest", type=Path, metavar="SKILLS_PARENT", help="Skill parent directory (not the final skill directory)")
    parser.add_argument("--dry-run", action="store_true", help="Validate and show the plan without writing anything")
    args = parser.parse_args(argv)
    default_home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
    parent = Path(os.path.abspath((args.dest if args.dest is not None else default_home / "skills").expanduser()))
    destination = parent / SKILL_NAME
    source = Path(os.path.abspath(__file__)).parent / "skills" / SKILL_NAME
    created = False
    try:
        # This validation is deliberately complete before any directory is made.
        entries = validate_source(source)
        inspect_ancestors(destination)
        if exists_without_following(destination):
            raise InstallError(f"Destination already exists; refusing to overwrite: {destination}")
        source_real = source.resolve(strict=True)
        destination_real = destination.resolve(strict=False)
        if destination_real.is_relative_to(source_real) or source_real.is_relative_to(destination_real):
            raise InstallError("Source and destination must not overlap")
        if args.dry_run:
            print(f"Dry run: source validated ({sum(not item.is_directory for item in entries)} files).")
            print(f"Would install: {source} -> {destination}")
            print("No files or directories were written.")
            return 0
        ensure_parent(parent)
        destination.mkdir()  # No exist_ok: never merge with any existing target.
        created = True
        for entry in entries:
            original = source / entry.relative
            output = destination / entry.relative
            inspect_ancestors(original)
            current = inspect(original)
            if identity(current) != entry.identity:
                raise InstallError(f"Source changed after validation: {original}")
            inspect_ancestors(output)
            if entry.is_directory:
                if not stat.S_ISDIR(current.st_mode):
                    raise InstallError(f"Source directory changed: {original}")
                output.mkdir()
            else:
                copy_file(original, output, entry)
        print(f"Installed {SKILL_NAME} to: {destination}")
        return 0
    except (OSError, InstallError, ValueError, KeyboardInterrupt) as error:
        print(f"Installation refused or failed: {error}", file=sys.stderr)
        if created:
            print(f"An incomplete destination may remain at: {destination}", file=sys.stderr)
        print("Nothing was automatically deleted or overwritten. Inspect any newly created directories manually before retrying.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
