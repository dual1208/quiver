from __future__ import annotations

import json
import os
import tempfile
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any

from .config import LabConfig, Platform


class InventoryParseError(ValueError):
    """Raised when vendor discovery output violates its supported schema."""


class DeviceState(StrEnum):
    CONNECTED = "connected"
    PAIRED = "paired"
    OFFLINE = "offline"
    UNAUTHORIZED = "unauthorized"


@dataclass(frozen=True, slots=True)
class Device:
    identifier: str
    platform: Platform
    model: str | None
    state: DeviceState
    services_available: bool | None = None

    @property
    def connected(self) -> bool:
        return self.state is DeviceState.CONNECTED


@dataclass(frozen=True, slots=True)
class MatchedDevice:
    alias: str
    platform: Platform
    identifier: str
    expected_model: str
    model: str | None
    state: DeviceState | None
    available: bool
    reason: str | None

    def to_dict(self) -> dict[str, object]:
        return {
            "alias": self.alias,
            "platform": self.platform.value,
            "id": self.identifier,
            "expectedModel": self.expected_model,
            "model": self.model,
            "state": self.state.value if self.state else "missing",
            "available": self.available,
            "reason": self.reason,
        }

@dataclass(frozen=True, slots=True)
class InventoryReport:
    devices: tuple[MatchedDevice, ...]
    extra_count: int

    @property
    def strict_ok(self) -> bool:
        return all(device.available for device in self.devices)

    def to_dict(self) -> dict[str, object]:
        return {
            "schemaVersion": 1,
            "strictOk": self.strict_ok,
            "devices": [device.to_dict() for device in self.devices],
            "extraDeviceCount": self.extra_count,
        }

def _object(value: Any, field: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise InventoryParseError(f"{field} must be an object")
    return value


def _required_string(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise InventoryParseError(f"{field} must be a non-empty string")
    return value.strip()


def _parse_apple_platform(value: Any) -> Platform:
    platform = _required_string(value, "hardwareProperties.platform")
    if platform.casefold() != "ios":
        raise InventoryParseError(f"unsupported CoreDevice platform: {platform}")
    return Platform.IOS


def parse_devicectl_json(payload: Any) -> tuple[Device, ...]:
    root = _object(payload, "root")
    info = _object(root.get("info"), "info")
    version = info.get("jsonVersion")
    if type(version) is not int or version != 3:
        raise InventoryParseError(f"unsupported devicectl JSON version: {version!r}")
    if info.get("outcome") != "success":
        raise InventoryParseError(f"devicectl outcome was not success: {info.get('outcome')!r}")
    result = _object(root.get("result"), "result")
    raw_devices = result.get("devices")
    if not isinstance(raw_devices, list):
        raise InventoryParseError("result.devices must be an array")

    devices: list[Device] = []
    seen: set[tuple[Platform, str]] = set()
    for index, raw in enumerate(raw_devices):
        item = _object(raw, f"result.devices[{index}]")
        identifier = _required_string(item.get("identifier"), f"devices[{index}].identifier")
        connection = _object(
            item.get("connectionProperties"), f"devices[{index}].connectionProperties"
        )
        properties = _object(
            item.get("deviceProperties"), f"devices[{index}].deviceProperties"
        )
        hardware = _object(
            item.get("hardwareProperties"), f"devices[{index}].hardwareProperties"
        )
        platform = _parse_apple_platform(hardware.get("platform"))
        marketing_name = hardware.get("marketingName")
        model = (
            marketing_name.strip()
            if isinstance(marketing_name, str) and marketing_name.strip()
            else None
        )
        pairing = connection.get("pairingState")
        tunnel = connection.get("tunnelState")
        if pairing == "paired" and tunnel == "connected":
            state = DeviceState.CONNECTED
        elif pairing == "paired":
            state = DeviceState.PAIRED
        else:
            state = DeviceState.OFFLINE
        services = properties.get("ddiServicesAvailable")
        services_available = services if isinstance(services, bool) else None
        identity = (platform, identifier)
        if identity in seen:
            raise InventoryParseError(f"duplicate CoreDevice identifier: {identifier}")
        seen.add(identity)
        devices.append(
            Device(
                identifier=identifier,
                platform=platform,
                model=model,
                state=state,
                services_available=services_available,
            )
        )
    return tuple(devices)


def parse_adb_devices(text: str) -> tuple[Device, ...]:
    devices: list[Device] = []
    seen: set[str] = set()
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped == "List of devices attached":
            continue
        fields = stripped.split()
        if len(fields) < 2:
            raise InventoryParseError(f"malformed ADB device line for serial: {fields[0]}")
        identifier, raw_state = fields[:2]
        if identifier in seen:
            raise InventoryParseError(f"duplicate ADB serial: {identifier}")
        seen.add(identifier)
        properties: dict[str, str] = {}
        for token in fields[2:]:
            if ":" in token:
                key, value = token.split(":", 1)
                properties[key] = value
        state = {
            "device": DeviceState.CONNECTED,
            "unauthorized": DeviceState.UNAUTHORIZED,
            "offline": DeviceState.OFFLINE,
        }.get(raw_state, DeviceState.OFFLINE)
        devices.append(
            Device(
                identifier=identifier,
                platform=Platform.ANDROID,
                model=properties.get("model"),
                state=state,
            )
        )
    return tuple(devices)


def match_inventory(config: LabConfig, discovered: Sequence[Device]) -> InventoryReport:
    exact = {(device.platform, device.identifier): device for device in discovered}
    configured_keys = {(device.platform, device.identifier) for device in config.devices}
    matches: list[MatchedDevice] = []
    for configured in config.devices:
        key = (configured.platform, configured.identifier)
        live = exact.get(key)
        if live is None:
            wrong_platform = next(
                (
                    device
                    for device in discovered
                    if device.identifier == configured.identifier
                ),
                None,
            )
            reason = "platform mismatch" if wrong_platform is not None else "missing"
            matches.append(
                MatchedDevice(
                    alias=configured.alias,
                    platform=configured.platform,
                    identifier=configured.identifier,
                    expected_model=configured.model_contains,
                    model=wrong_platform.model if wrong_platform else None,
                    state=wrong_platform.state if wrong_platform else None,
                    available=False,
                    reason=reason,
                )
            )
            continue
        if not live.connected:
            reason = live.state.value
        elif live.model is None:
            reason = "model missing"
        elif configured.model_contains not in live.model:
            reason = "model mismatch"
        else:
            reason = None
        matches.append(
            MatchedDevice(
                alias=configured.alias,
                platform=configured.platform,
                identifier=configured.identifier,
                expected_model=configured.model_contains,
                model=live.model,
                state=live.state,
                available=reason is None,
                reason=reason,
            )
        )
    extra_count = sum(
        1 for device in discovered if (device.platform, device.identifier) not in configured_keys
    )
    return InventoryReport(devices=tuple(matches), extra_count=extra_count)


def discover_devicectl(
    *,
    log_path: Path,
    runner: Callable[..., object] | None = None,
) -> tuple[Device, ...]:
    if runner is None:
        from .process import run_checked

        runner = run_checked
    descriptor, raw_path = tempfile.mkstemp(prefix="quiver-devicectl-", suffix=".json")
    os.close(descriptor)
    output_path = Path(raw_path)
    try:
        runner(
            [
                "xcrun",
                "devicectl",
                "list",
                "devices",
                "--quiet",
                "--json-output",
                str(output_path),
            ],
            log_path=log_path,
        )
        try:
            payload = json.loads(output_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise InventoryParseError(f"unable to parse devicectl JSON output: {exc}") from exc
        return parse_devicectl_json(payload)
    finally:
        output_path.unlink(missing_ok=True)


def discover_adb(
    *,
    log_path: Path,
    runner: Callable[..., object] | None = None,
) -> tuple[Device, ...]:
    if runner is None:
        from .process import run_checked

        runner = run_checked
    result = runner(["adb", "devices", "-l"], log_path=log_path)
    output = getattr(result, "output", None)
    if not isinstance(output, str):
        raise InventoryParseError("ADB runner did not provide text output")
    return parse_adb_devices(output)
