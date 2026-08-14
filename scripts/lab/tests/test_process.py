from __future__ import annotations

import importlib
import sys
from pathlib import Path
from typing import Any

import pytest


def _api() -> Any:
    try:
        return importlib.import_module("quiver_lab.process")
    except ModuleNotFoundError as exc:
        pytest.fail(f"typed process implementation is missing: {exc}")


def test_run_checked_streams_output_and_redacts_command_and_log(tmp_path: Path) -> None:
    process = _api()
    secret = "registration-secret-value"
    log_path = tmp_path / "command.log"
    code = (
        "import sys, time; "
        "sys.stdout.write('first\\n'); sys.stdout.flush(); "
        "sys.stdout.write('registration-'); sys.stdout.flush(); "
        "time.sleep(0.02); "
        "sys.stdout.write('secret-value\\n'); sys.stdout.flush()"
    )

    result = process.run_checked(
        [sys.executable, "-c", code, secret],
        log_path=log_path,
        redactions=[secret],
    )

    logged = log_path.read_text(encoding="utf-8")
    assert result.exit_code == 0
    assert result.args[-1] == "<redacted>"
    assert result.output == "first\n<redacted>\n"
    assert result.duration_seconds >= 0
    assert secret not in logged
    assert "<redacted>" in logged
    assert logged.endswith("first\n<redacted>\n")


def test_run_checked_raises_sanitized_failure_with_log_path(tmp_path: Path) -> None:
    process = _api()
    secret = "do-not-leak-this"
    log_path = tmp_path / "failed.log"

    with pytest.raises(process.ProcessFailure) as raised:
        process.run_checked(
            [
                sys.executable,
                "-c",
                "import sys; print(sys.argv[1]); raise SystemExit(7)",
                secret,
            ],
            log_path=log_path,
            redactions=[secret],
        )

    failure = raised.value
    assert failure.exit_code == 7
    assert failure.log_path == log_path
    assert failure.result.exit_code == 7
    assert secret not in str(failure)
    assert secret not in log_path.read_text(encoding="utf-8")
    assert str(log_path) in str(failure)


@pytest.mark.parametrize(
    "args",
    [
        [],
        "echo unsafe",
        ["echo", 42],
    ],
)
def test_run_checked_rejects_non_argument_arrays(tmp_path: Path, args: Any) -> None:
    process = _api()

    with pytest.raises((TypeError, ValueError)):
        process.run_checked(args, log_path=tmp_path / "never.log")


def test_run_checked_creates_private_log_parent_and_file(tmp_path: Path) -> None:
    process = _api()
    log_path = tmp_path / "nested" / "command.log"

    process.run_checked(
        [sys.executable, "-c", "print('ok')"],
        log_path=log_path,
    )

    assert log_path.parent.exists()
    assert log_path.stat().st_mode & 0o777 == 0o600
