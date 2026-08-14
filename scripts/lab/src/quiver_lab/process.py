from __future__ import annotations

import os
import shlex
import subprocess
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class ProcessResult:
    args: tuple[str, ...]
    exit_code: int
    duration_seconds: float
    log_path: Path
    output: str


class ProcessFailure(RuntimeError):
    def __init__(self, result: ProcessResult):
        self.result = result
        self.exit_code = result.exit_code
        self.log_path = result.log_path
        super().__init__(
            f"command failed with exit code {result.exit_code}; see log: {result.log_path}"
        )


def _validated_args(args: Sequence[str]) -> tuple[str, ...]:
    if isinstance(args, (str, bytes)):
        raise TypeError("command must be an argument array, not a shell string")
    values = tuple(args)
    if not values:
        raise ValueError("command argument array must not be empty")
    if any(not isinstance(value, str) for value in values):
        raise TypeError("every command argument must be a string")
    return values


def _redactor(patterns: Sequence[str]):
    sanitized_patterns = tuple(
        sorted({value for value in patterns if value}, key=len, reverse=True)
    )

    def redact(value: str) -> str:
        for pattern in sanitized_patterns:
            value = value.replace(pattern, "<redacted>")
        return value

    return redact


def run_checked(
    args: Sequence[str],
    *,
    log_path: Path,
    redactions: Sequence[str] = (),
    cwd: Path | None = None,
    env: Mapping[str, str] | None = None,
) -> ProcessResult:
    command = _validated_args(args)
    redact = _redactor(redactions)
    sanitized_args = tuple(redact(value) for value in command)
    log_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(descriptor, 0o600)
    started = time.monotonic()
    output_parts: list[str] = []
    exit_code = -1
    with os.fdopen(descriptor, "w", encoding="utf-8") as log:
        log.write(f"$ {shlex.join(sanitized_args)}\n")
        log.flush()
        try:
            child = subprocess.Popen(
                command,
                cwd=cwd,
                env=dict(env) if env is not None else None,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                shell=False,
            )
        except OSError as exc:
            message = redact(f"unable to start command: {exc}\n")
            output_parts.append(message)
            log.write(message)
        else:
            assert child.stdout is not None
            for line in child.stdout:
                sanitized_line = redact(line)
                output_parts.append(sanitized_line)
                log.write(sanitized_line)
                log.flush()
            exit_code = child.wait()
        duration = time.monotonic() - started
        log.flush()
        os.fsync(log.fileno())
    result = ProcessResult(
        args=sanitized_args,
        exit_code=exit_code,
        duration_seconds=duration,
        log_path=log_path,
        output="".join(output_parts),
    )
    if exit_code != 0:
        raise ProcessFailure(result)
    return result
