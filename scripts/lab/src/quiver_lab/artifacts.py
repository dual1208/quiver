from __future__ import annotations

import fcntl
import json
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Any, Self


DEFAULT_LOCK_PATH = Path("/Users/xie/Library/Caches/quiver-native/lab.lock")


class ManifestStage(StrEnum):
    INVENTORY = "inventory"
    BUILD = "build"
    INSTALL = "install"
    LAUNCH = "launch"
    SMOKE = "smoke"
    PERFORMANCE = "performance"
    COMPLETE = "complete"


@dataclass(frozen=True, slots=True)
class RunArtifacts:
    run_dir: Path
    manifest_path: Path

    @classmethod
    def create(
        cls,
        *,
        root: Path,
        commit_sha: str,
        now: datetime | None = None,
    ) -> Self:
        if not re.fullmatch(r"[0-9a-fA-F]{7,64}", commit_sha):
            raise ValueError("commit_sha must be a 7-64 character hexadecimal Git SHA")
        timestamp = now or datetime.now(UTC)
        if timestamp.tzinfo is None:
            raise ValueError("artifact timestamp must be timezone-aware")
        timestamp = timestamp.astimezone(UTC)
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        run_name = f"{timestamp:%Y%m%dT%H%M%SZ}-{commit_sha[:8].lower()}"
        run_dir = root / run_name
        run_dir.mkdir(mode=0o700)
        (run_dir / "logs").mkdir(mode=0o700)
        return cls(run_dir=run_dir, manifest_path=run_dir / "manifest.json")

    def log_path(self, name: str) -> Path:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", name):
            raise ValueError("log name must be a safe filename component")
        filename = name if name.endswith(".log") else f"{name}.log"
        return self.run_dir / "logs" / filename

    def write_manifest(
        self,
        *,
        stage: ManifestStage,
        data: Mapping[str, Any],
    ) -> Path:
        reserved = {"schemaVersion", "stage"} & data.keys()
        if reserved:
            raise ValueError(f"manifest data contains reserved keys: {', '.join(sorted(reserved))}")
        payload = {"schemaVersion": 1, "stage": stage.value, **data}
        temporary = self.run_dir / "manifest.json.tmp"
        descriptor = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_TRUNC,
            0o600,
        )
        os.fchmod(descriptor, 0o600)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                json.dump(payload, output, indent=2, sort_keys=True)
                output.write("\n")
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, self.manifest_path)
            directory_fd = os.open(self.run_dir, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            temporary.unlink(missing_ok=True)
        return self.manifest_path


class LabLockBusy(RuntimeError):
    def __init__(self, path: Path, active_pid: int | None):
        self.path = path
        self.active_pid = active_pid
        holder = str(active_pid) if active_pid is not None else "unknown"
        super().__init__(f"lab lock is already held by PID {holder}: {path}")


class LabLock:
    def __init__(self, path: Path = DEFAULT_LOCK_PATH):
        self.path = path
        self._descriptor: int | None = None

    def _read_pid(self, descriptor: int) -> int | None:
        os.lseek(descriptor, 0, os.SEEK_SET)
        raw = os.read(descriptor, 64).decode("ascii", errors="ignore").strip()
        try:
            value = int(raw)
        except ValueError:
            return None
        return value if value > 0 else None

    def acquire(self) -> None:
        if self._descriptor is not None:
            raise RuntimeError("lab lock is already acquired by this object")
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.path.parent, 0o700)
        descriptor = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o600)
        os.fchmod(descriptor, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            active_pid = self._read_pid(descriptor)
            os.close(descriptor)
            raise LabLockBusy(self.path, active_pid) from exc
        os.ftruncate(descriptor, 0)
        os.lseek(descriptor, 0, os.SEEK_SET)
        os.write(descriptor, f"{os.getpid()}\n".encode("ascii"))
        os.fsync(descriptor)
        self._descriptor = descriptor

    def release(self) -> None:
        if self._descriptor is None:
            return
        descriptor = self._descriptor
        self._descriptor = None
        try:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        finally:
            os.close(descriptor)

    def __enter__(self) -> Self:
        self.acquire()
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self.release()
