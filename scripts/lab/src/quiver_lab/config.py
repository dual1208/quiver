from __future__ import annotations

import json
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any


class ConfigError(ValueError):
    """Raised when the local lab inventory is invalid."""


class Platform(StrEnum):
    IOS = "ios"
    ANDROID = "android"


@dataclass(frozen=True, slots=True)
class ConfiguredDevice:
    alias: str
    platform: Platform
    identifier: str
    model_contains: str


@dataclass(frozen=True, slots=True)
class LabConfig:
    schema_version: int
    apple_team_id: str
    devices: tuple[ConfiguredDevice, ...]


def _nonempty_string(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"{field} must be a non-empty string")
    return value.strip()


def _parse_device(value: Any, index: int) -> ConfiguredDevice:
    if not isinstance(value, dict):
        raise ConfigError(f"devices[{index}] must be an object")
    required = {"alias", "platform", "id", "modelContains"}
    missing = sorted(required - value.keys())
    if missing:
        raise ConfigError(f"devices[{index}] missing fields: {', '.join(missing)}")
    unknown = sorted(value.keys() - required)
    if unknown:
        raise ConfigError(f"devices[{index}] has unknown fields: {', '.join(unknown)}")
    platform_value = _nonempty_string(value["platform"], f"devices[{index}].platform")
    try:
        platform = Platform(platform_value)
    except ValueError as exc:
        raise ConfigError(f"devices[{index}].platform is unsupported: {platform_value}") from exc
    return ConfiguredDevice(
        alias=_nonempty_string(value["alias"], f"devices[{index}].alias"),
        platform=platform,
        identifier=_nonempty_string(value["id"], f"devices[{index}].id"),
        model_contains=_nonempty_string(
            value["modelContains"], f"devices[{index}].modelContains"
        ),
    )


def parse_lab_config(payload: Any) -> LabConfig:
    if not isinstance(payload, dict):
        raise ConfigError("inventory root must be an object")
    expected = {"schemaVersion", "appleTeamId", "devices"}
    missing = sorted(expected - payload.keys())
    if missing:
        raise ConfigError(f"inventory missing fields: {', '.join(missing)}")
    unknown = sorted(payload.keys() - expected)
    if unknown:
        raise ConfigError(f"inventory has unknown fields: {', '.join(unknown)}")
    version = payload["schemaVersion"]
    if type(version) is not int or version != 1:
        raise ConfigError("schemaVersion must be integer 1")
    raw_devices = payload["devices"]
    if not isinstance(raw_devices, list):
        raise ConfigError("devices must be an array")
    devices = tuple(_parse_device(value, index) for index, value in enumerate(raw_devices))
    aliases: set[str] = set()
    identities: set[tuple[Platform, str]] = set()
    for device in devices:
        if device.alias in aliases:
            raise ConfigError(f"duplicate alias: {device.alias}")
        aliases.add(device.alias)
        identity = (device.platform, device.identifier)
        if identity in identities:
            raise ConfigError(
                f"duplicate device id for {device.platform.value}: {device.identifier}"
            )
        identities.add(identity)
    return LabConfig(
        schema_version=version,
        apple_team_id=_nonempty_string(payload["appleTeamId"], "appleTeamId"),
        devices=devices,
    )


def load_lab_config(path: Path) -> LabConfig:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ConfigError(f"unable to read inventory {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ConfigError(f"inventory is not valid JSON: {exc}") from exc
    return parse_lab_config(payload)
