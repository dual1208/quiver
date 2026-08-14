from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import TextIO

from .artifacts import DEFAULT_LOCK_PATH, LabLock, LabLockBusy, ManifestStage, RunArtifacts
from .config import ConfigError, load_lab_config
from .inventory import (
    Device,
    InventoryParseError,
    discover_adb,
    discover_devicectl,
    match_inventory,
)
from .process import ProcessFailure, run_checked


Discovery = Callable[..., Sequence[Device]]


def run_inventory(
    *,
    config_path: Path,
    artifacts_root: Path,
    lock_path: Path,
    strict: bool,
    json_output: bool,
    output: TextIO,
    commit_sha: str,
    apple_discovery: Discovery = discover_devicectl,
    android_discovery: Discovery = discover_adb,
) -> int:
    config = load_lab_config(config_path)
    observed_at = datetime.now(UTC)
    with LabLock(lock_path):
        artifacts = RunArtifacts.create(
            root=artifacts_root,
            commit_sha=commit_sha,
            now=observed_at,
        )
        apple = apple_discovery(log_path=artifacts.log_path("devicectl"))
        android = android_discovery(log_path=artifacts.log_path("adb"))
        report = match_inventory(config, [*apple, *android])
        payload = report.to_dict()
        artifacts.write_manifest(
            stage=ManifestStage.INVENTORY,
            data={
                "commit": commit_sha,
                "observedAt": observed_at.isoformat().replace("+00:00", "Z"),
                "inventory": payload,
            },
        )
    if json_output:
        json.dump(payload, output, indent=2, sort_keys=True)
        output.write("\n")
    else:
        for device in report.devices:
            status = "available" if device.available else f"unavailable ({device.reason})"
            output.write(f"{device.alias}: {status}\n")
        if report.extra_count:
            output.write(f"extra unconfigured devices: {report.extra_count}\n")
    return 1 if strict and not report.strict_ok else 0


def _current_commit_sha() -> str:
    github_sha = os.environ.get("GITHUB_SHA", "")
    if re.fullmatch(r"[0-9a-fA-F]{7,64}", github_sha):
        return github_sha
    descriptor, raw_path = tempfile.mkstemp(prefix="quiver-git-", suffix=".log")
    os.close(descriptor)
    log_path = Path(raw_path)
    try:
        result = run_checked(["git", "rev-parse", "HEAD"], log_path=log_path)
        sha = result.output.strip()
        if not re.fullmatch(r"[0-9a-fA-F]{7,64}", sha):
            raise ValueError("git rev-parse returned an invalid commit SHA")
        return sha
    finally:
        log_path.unlink(missing_ok=True)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="quiver-lab")
    commands = parser.add_subparsers(dest="command", required=True)
    inventory = commands.add_parser("inventory", help="discover and validate physical devices")
    inventory.add_argument("--config", type=Path, default=Path("lab/devices.local.json"))
    inventory.add_argument("--artifacts-root", type=Path, default=Path("artifacts"))
    inventory.add_argument("--lock-path", type=Path, default=DEFAULT_LOCK_PATH)
    inventory.add_argument("--strict", action="store_true")
    inventory.add_argument("--json", action="store_true", dest="json_output")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "inventory":
            return run_inventory(
                config_path=args.config,
                artifacts_root=args.artifacts_root,
                lock_path=args.lock_path,
                strict=args.strict,
                json_output=args.json_output,
                output=sys.stdout,
                commit_sha=_current_commit_sha(),
            )
    except (
        ConfigError,
        InventoryParseError,
        ProcessFailure,
        LabLockBusy,
        OSError,
        ValueError,
    ) as exc:
        print(f"quiver-lab: {exc}", file=sys.stderr)
        return 2
    raise AssertionError(f"unhandled command: {args.command}")
