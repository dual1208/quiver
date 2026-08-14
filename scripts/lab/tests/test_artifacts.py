from __future__ import annotations

import importlib
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest


def _api() -> Any:
    try:
        return importlib.import_module("quiver_lab.artifacts")
    except ModuleNotFoundError as exc:
        pytest.fail(f"artifact implementation is missing: {exc}")


def test_run_artifacts_use_utc_timestamp_and_short_commit(tmp_path: Path) -> None:
    artifacts = _api()

    run = artifacts.RunArtifacts.create(
        root=tmp_path / "artifacts",
        commit_sha="abcdef1234567890",
        now=datetime(2026, 8, 14, 5, 54, 59, tzinfo=UTC),
    )

    assert run.run_dir.name == "20260814T055459Z-abcdef12"
    assert run.run_dir.is_dir()
    assert run.manifest_path == run.run_dir / "manifest.json"
    assert run.log_path("inventory") == run.run_dir / "logs" / "inventory.log"
    assert run.log_path("inventory").parent.is_dir()


def test_run_artifacts_suffix_same_timestamp_without_overwriting_evidence(
    tmp_path: Path,
) -> None:
    artifacts = _api()
    root = tmp_path / "artifacts"
    timestamp = datetime(2026, 8, 14, 5, 54, 59, tzinfo=UTC)
    first = artifacts.RunArtifacts.create(
        root=root,
        commit_sha="abcdef1234567890",
        now=timestamp,
    )
    first.write_manifest(
        stage=artifacts.ManifestStage.INVENTORY,
        data={"evidence": "first"},
    )

    second = artifacts.RunArtifacts.create(
        root=root,
        commit_sha="abcdef1234567890",
        now=timestamp,
    )

    assert first.run_dir.name == "20260814T055459Z-abcdef12"
    assert second.run_dir.name == "20260814T055459Z-abcdef12-2"
    assert json.loads(first.manifest_path.read_text(encoding="utf-8"))["evidence"] == "first"
    assert second.manifest_path.exists() is False


def test_run_artifacts_allocate_suffixes_with_concurrent_exclusive_mkdir(
    tmp_path: Path,
) -> None:
    artifacts = _api()
    root = tmp_path / "artifacts"
    timestamp = datetime(2026, 8, 14, 5, 54, 59, tzinfo=UTC)

    def create() -> str:
        run = artifacts.RunArtifacts.create(
            root=root,
            commit_sha="abcdef1234567890",
            now=timestamp,
        )
        return run.run_dir.name

    with ThreadPoolExecutor(max_workers=8) as executor:
        names = set(executor.map(lambda _: create(), range(8)))

    assert names == {
        "20260814T055459Z-abcdef12",
        "20260814T055459Z-abcdef12-2",
        "20260814T055459Z-abcdef12-3",
        "20260814T055459Z-abcdef12-4",
        "20260814T055459Z-abcdef12-5",
        "20260814T055459Z-abcdef12-6",
        "20260814T055459Z-abcdef12-7",
        "20260814T055459Z-abcdef12-8",
    }


def test_log_path_rejects_directory_escape(tmp_path: Path) -> None:
    artifacts = _api()
    run = artifacts.RunArtifacts.create(root=tmp_path, commit_sha="abcdef12")

    with pytest.raises(ValueError):
        run.log_path("../outside")


def test_manifest_write_atomically_replaces_complete_json(tmp_path: Path) -> None:
    artifacts = _api()
    run = artifacts.RunArtifacts.create(
        root=tmp_path,
        commit_sha="abcdef12",
        now=datetime(2026, 8, 14, 5, 54, 59, tzinfo=UTC),
    )

    run.write_manifest(
        stage=artifacts.ManifestStage.INVENTORY,
        data={"commit": "abcdef1234567890", "results": []},
    )
    run.write_manifest(
        stage=artifacts.ManifestStage.COMPLETE,
        data={"commit": "abcdef1234567890", "results": [{"pass": True}]},
    )

    assert json.loads(run.manifest_path.read_text(encoding="utf-8")) == {
        "schemaVersion": 1,
        "stage": "complete",
        "commit": "abcdef1234567890",
        "results": [{"pass": True}],
    }
    assert (run.run_dir / "manifest.json.tmp").exists() is False
    assert run.manifest_path.stat().st_mode & 0o777 == 0o600


def test_manifest_rejects_reserved_keys_and_cleans_temporary_file(tmp_path: Path) -> None:
    artifacts = _api()
    run = artifacts.RunArtifacts.create(root=tmp_path, commit_sha="abcdef12")

    with pytest.raises(ValueError, match="reserved"):
        run.write_manifest(
            stage=artifacts.ManifestStage.INVENTORY,
            data={"stage": "wrong"},
        )

    assert (run.run_dir / "manifest.json.tmp").exists() is False


def test_lab_lock_is_private_and_records_holder_pid(tmp_path: Path) -> None:
    artifacts = _api()
    lock_path = tmp_path / "private" / "lab.lock"

    with artifacts.LabLock(lock_path):
        assert lock_path.read_text(encoding="ascii").strip().isdigit()
        assert lock_path.stat().st_mode & 0o777 == 0o600
        assert lock_path.parent.stat().st_mode & 0o777 == 0o700


def test_lab_lock_reports_active_pid_without_waiting(tmp_path: Path) -> None:
    artifacts = _api()
    lock_path = tmp_path / "lab.lock"
    holder_code = """
import fcntl
import os
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
with path.open("w+", encoding="ascii") as lock:
    fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
    lock.write(str(os.getpid()))
    lock.flush()
    os.fsync(lock.fileno())
    print("ready", flush=True)
    sys.stdin.readline()
"""
    child = subprocess.Popen(
        [sys.executable, "-c", holder_code, str(lock_path)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        assert child.stdout is not None
        assert child.stdout.readline() == "ready\n"

        with pytest.raises(artifacts.LabLockBusy) as raised:
            with artifacts.LabLock(lock_path):
                pytest.fail("contended lock must not be acquired")

        assert raised.value.active_pid == child.pid
        assert str(child.pid) in str(raised.value)
    finally:
        if child.stdin is not None:
            child.stdin.write("\n")
            child.stdin.flush()
        child.wait(timeout=5)
