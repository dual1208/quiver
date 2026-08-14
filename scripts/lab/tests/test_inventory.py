from __future__ import annotations

import importlib
import json
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest


def _api() -> tuple[Any, Any]:
    try:
        config = importlib.import_module("quiver_lab.config")
        inventory = importlib.import_module("quiver_lab.inventory")
    except ModuleNotFoundError as exc:
        pytest.fail(f"typed inventory implementation is missing: {exc}")
    return config, inventory


def _write_config(path: Path, devices: list[dict[str, str]]) -> None:
    path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "appleTeamId": "HPNQ87SHMK",
                "devices": devices,
            }
        ),
        encoding="utf-8",
    )


def _configured_devices() -> list[dict[str, str]]:
    return [
        {
            "alias": "ipad",
            "platform": "ios",
            "id": "EF7A9A29-939C-56D7-BC62-2AF09D48C724",
            "modelContains": "iPad Air 13-inch",
        },
        {
            "alias": "iphone",
            "platform": "ios",
            "id": "CAB0ED1D-913E-5EB9-8737-5E6D3888907F",
            "modelContains": "iPhone 15",
        },
        {
            "alias": "android-tablet",
            "platform": "android",
            "id": "4de5967c",
            "modelContains": "OPD2415",
        },
        {
            "alias": "android-phone",
            "platform": "android",
            "id": "ee6c6a88",
            "modelContains": "ONEPLUS_A6000",
        },
    ]


def _core_device(
    identifier: str,
    model: str,
    *,
    pairing: str = "paired",
    tunnel: str = "connected",
    services: bool = True,
) -> dict[str, Any]:
    return {
        "identifier": identifier,
        "capabilities": [],
        "tags": [],
        "visibilityClass": "default",
        "connectionProperties": {
            "authenticationType": "manualPairing",
            "isMobileDeviceOnly": False,
            "lastConnectionDate": "2026-08-14T00:00:00Z",
            "pairingState": pairing,
            "potentialHostnames": [],
            "transportType": "wired",
            "tunnelState": tunnel,
            "tunnelTransportProtocol": "tcp",
        },
        "deviceProperties": {
            "bootState": "booted",
            "bootedFromSnapshot": False,
            "bootedSnapshotName": "",
            "ddiServicesAvailable": services,
            "developerModeStatus": "enabled",
            "hasInternalOSBuild": False,
            "name": "<redacted>",
            "osBuildUpdate": "",
            "osVersionNumber": "26.6",
            "providerSpecificValues": {},
            "rootFileSystemIsWritable": False,
            "screenViewingURL": "",
            "supportsCheckedAllocations": False,
        },
        "hardwareProperties": {
            "cpuType": {},
            "deviceType": "iPad" if "iPad" in model else "iPhone",
            "ecid": 1,
            "hardwareModel": "synthetic",
            "internalStorageCapacity": 1,
            "isProductionFused": True,
            "marketingName": model,
            "platform": "iOS",
            "productType": "synthetic",
            "reality": "physical",
            "serialNumber": "<redacted>",
            "supportedCPUTypes": [],
            "supportedDeviceFamilies": [],
            "thinningProductType": "synthetic",
            "udid": "DIFFERENT-HARDWARE-UDID",
        },
    }


def _core_payload(devices: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "info": {
            "arguments": [],
            "commandType": "devicectl.list.devices",
            "environment": {},
            "jsonVersion": 3,
            "outcome": "success",
            "version": "518.33",
        },
        "result": {"devices": devices},
    }


def test_load_config_returns_typed_immutable_devices(tmp_path: Path) -> None:
    config, _ = _api()
    path = tmp_path / "devices.json"
    _write_config(path, _configured_devices())

    loaded = config.load_lab_config(path)

    assert loaded.schema_version == 1
    assert loaded.apple_team_id == "HPNQ87SHMK"
    assert loaded.devices[0].alias == "ipad"
    assert loaded.devices[0].platform.value == "ios"
    assert loaded.devices[0].identifier == "EF7A9A29-939C-56D7-BC62-2AF09D48C724"
    with pytest.raises((AttributeError, TypeError)):
        loaded.devices[0].alias = "changed"


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (lambda rows: rows + [{**rows[0], "id": "another-id"}], "duplicate alias"),
        (lambda rows: rows + [{**rows[0], "alias": "other"}], "duplicate device id"),
    ],
)
def test_load_config_rejects_duplicate_identity(
    tmp_path: Path, mutation: Any, message: str
) -> None:
    config, _ = _api()
    path = tmp_path / "devices.json"
    _write_config(path, mutation(_configured_devices()))

    with pytest.raises(config.ConfigError, match=message):
        config.load_lab_config(path)


@pytest.mark.parametrize(
    "payload",
    [
        {"schemaVersion": True, "appleTeamId": "TEAM", "devices": []},
        {"schemaVersion": 2, "appleTeamId": "TEAM", "devices": []},
        {"schemaVersion": 1, "appleTeamId": "", "devices": []},
        {"schemaVersion": 1, "appleTeamId": "TEAM"},
    ],
)
def test_load_config_rejects_invalid_schema(tmp_path: Path, payload: Any) -> None:
    config, _ = _api()
    path = tmp_path / "devices.json"
    path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(config.ConfigError):
        config.load_lab_config(path)


def test_parse_devicectl_uses_top_level_identifier_and_connection_state() -> None:
    _, inventory = _api()
    payload = _core_payload(
        [
            _core_device(
                "EF7A9A29-939C-56D7-BC62-2AF09D48C724",
                "iPad Air 13-inch (M2)",
            ),
            _core_device(
                "CAB0ED1D-913E-5EB9-8737-5E6D3888907F",
                "iPhone 15",
                tunnel="disconnected",
                services=False,
            ),
        ]
    )

    devices = inventory.parse_devicectl_json(payload)

    assert [device.identifier for device in devices] == [
        "EF7A9A29-939C-56D7-BC62-2AF09D48C724",
        "CAB0ED1D-913E-5EB9-8737-5E6D3888907F",
    ]
    assert [device.state.value for device in devices] == ["connected", "paired"]
    assert devices[0].platform.value == "ios"
    assert devices[0].model == "iPad Air 13-inch (M2)"
    assert devices[1].services_available is False


def test_unpaired_coredevice_is_offline_and_fails_strict_matching(tmp_path: Path) -> None:
    config, inventory = _api()
    path = tmp_path / "devices.json"
    _write_config(path, [_configured_devices()[1]])
    configured = config.load_lab_config(path)
    discovered = inventory.parse_devicectl_json(
        _core_payload(
            [
                _core_device(
                    "CAB0ED1D-913E-5EB9-8737-5E6D3888907F",
                    "iPhone 15",
                    pairing="unpaired",
                    tunnel="disconnected",
                    services=False,
                )
            ]
        )
    )

    report = inventory.match_inventory(configured, discovered)

    assert discovered[0].state.value == "offline"
    assert discovered[0].services_available is False
    assert report.strict_ok is False
    assert [(row.available, row.reason) for row in report.devices] == [
        (False, "offline")
    ]


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ([], "root"),
        ({"info": {"jsonVersion": 2, "outcome": "success"}, "result": {"devices": []}}, "version"),
        ({"info": {"jsonVersion": 3, "outcome": "failure"}, "result": {"devices": []}}, "outcome"),
        (_core_payload([{**_core_device("id", "iPhone 15"), "identifier": ""}]), "identifier"),
    ],
)
def test_parse_devicectl_rejects_unsupported_or_malformed_payload(
    payload: Any, message: str
) -> None:
    _, inventory = _api()

    with pytest.raises(inventory.InventoryParseError, match=message):
        inventory.parse_devicectl_json(payload)


def test_parse_adb_devices_preserves_unavailable_states_and_properties() -> None:
    _, inventory = _api()
    text = """List of devices attached
4de5967c device usb:ignored model:OPD2415 transport_id:1
ee6c6a88\tdevice\tmodel:ONEPLUS_A6000
unauthorized-id unauthorized
offline-id offline model:IGNORED
"""

    devices = inventory.parse_adb_devices(text)

    assert [(device.identifier, device.state.value, device.model) for device in devices] == [
        ("4de5967c", "connected", "OPD2415"),
        ("ee6c6a88", "connected", "ONEPLUS_A6000"),
        ("unauthorized-id", "unauthorized", None),
        ("offline-id", "offline", "IGNORED"),
    ]


def test_parse_adb_devices_ignores_cold_daemon_preamble_before_header() -> None:
    _, inventory = _api()
    text = """* daemon not running; starting now at tcp:5037
* daemon started successfully *
List of devices attached
4de5967c device usb:ignored model:OPD2415 transport_id:1
ee6c6a88 device model:ONEPLUS_A6000
"""

    devices = inventory.parse_adb_devices(text)

    assert [(device.identifier, device.state.value, device.model) for device in devices] == [
        ("4de5967c", "connected", "OPD2415"),
        ("ee6c6a88", "connected", "ONEPLUS_A6000"),
    ]


@pytest.mark.parametrize(
    "text",
    [
        "4de5967c device model:OPD2415\n",
        "List of devices attached\nmalformed-row\n",
    ],
)
def test_parse_adb_devices_rejects_output_without_valid_device_rows(text: str) -> None:
    _, inventory = _api()

    with pytest.raises(inventory.InventoryParseError, match="ADB"):
        inventory.parse_adb_devices(text)


def test_parse_adb_devices_rejects_duplicate_serial() -> None:
    _, inventory = _api()

    with pytest.raises(inventory.InventoryParseError, match="duplicate ADB serial"):
        inventory.parse_adb_devices(
            "List of devices attached\nduplicate device model:A\nduplicate offline\n"
        )


def test_match_inventory_never_substitutes_extra_or_wrong_model(tmp_path: Path) -> None:
    config, inventory = _api()
    path = tmp_path / "devices.json"
    _write_config(path, _configured_devices())
    configured = config.load_lab_config(path)
    discovered = [
        *inventory.parse_devicectl_json(
            _core_payload(
                [
                    _core_device(
                        "EF7A9A29-939C-56D7-BC62-2AF09D48C724",
                        "Wrong Tablet",
                    ),
                    _core_device("UNCONFIGURED-SAME-MODEL", "iPhone 15"),
                ]
            )
        ),
        *inventory.parse_adb_devices(
            "List of devices attached\n4de5967c device model:OPD2415\n"
            "ee6c6a88 unauthorized\nextra device model:ONEPLUS_A6000\n"
        ),
    ]

    report = inventory.match_inventory(configured, discovered)

    assert report.strict_ok is False
    assert report.extra_count == 2
    assert [(row.alias, row.available, row.reason) for row in report.devices] == [
        ("ipad", False, "model mismatch"),
        ("iphone", False, "missing"),
        ("android-tablet", True, None),
        ("android-phone", False, "unauthorized"),
    ]


def test_match_inventory_is_strictly_ready_when_every_exact_target_is_connected(
    tmp_path: Path,
) -> None:
    config, inventory = _api()
    path = tmp_path / "devices.json"
    _write_config(path, _configured_devices())
    configured = config.load_lab_config(path)
    discovered = [
        *inventory.parse_devicectl_json(
            _core_payload(
                [
                    _core_device(
                        "EF7A9A29-939C-56D7-BC62-2AF09D48C724",
                        "iPad Air 13-inch (M2)",
                    ),
                    _core_device(
                        "CAB0ED1D-913E-5EB9-8737-5E6D3888907F",
                        "iPhone 15",
                    ),
                ]
            )
        ),
        *inventory.parse_adb_devices(
            "List of devices attached\n4de5967c device model:OPD2415\n"
            "ee6c6a88 device model:ONEPLUS_A6000\n"
        ),
    ]

    report = inventory.match_inventory(configured, discovered)

    assert report.strict_ok is True
    assert [row.available for row in report.devices] == [True, True, True, True]


def test_discover_devicectl_uses_json_file_and_removes_it(tmp_path: Path) -> None:
    _, inventory = _api()
    observed_path: Path | None = None
    observed_args: list[str] | None = None

    def fake_run(args: list[str], **_: Any) -> None:
        nonlocal observed_args, observed_path
        observed_args = args
        observed_path = Path(args[args.index("--json-output") + 1])
        observed_path.write_text(
            json.dumps(
                _core_payload(
                    [
                        _core_device(
                            "EF7A9A29-939C-56D7-BC62-2AF09D48C724",
                            "iPad Air 13-inch (M2)",
                        )
                    ]
                )
            ),
            encoding="utf-8",
        )

    devices = inventory.discover_devicectl(
        log_path=tmp_path / "devicectl.log", runner=fake_run
    )

    assert observed_args is not None
    assert observed_args[:4] == ["xcrun", "devicectl", "list", "devices"]
    assert observed_args[4:6] == ["--quiet", "--json-output"]
    assert observed_path is not None
    assert observed_path.exists() is False
    assert devices[0].identifier == "EF7A9A29-939C-56D7-BC62-2AF09D48C724"


def test_discover_adb_uses_argument_array_and_parses_runner_output(tmp_path: Path) -> None:
    _, inventory = _api()
    observed: list[str] | None = None

    def fake_run(args: list[str], **_: Any) -> SimpleNamespace:
        nonlocal observed
        observed = args
        return SimpleNamespace(
            output="List of devices attached\n4de5967c device model:OPD2415\n"
        )

    devices = inventory.discover_adb(log_path=tmp_path / "adb.log", runner=fake_run)

    assert observed == ["adb", "devices", "-l"]
    assert [(device.identifier, device.model) for device in devices] == [
        ("4de5967c", "OPD2415")
    ]


def test_inventory_report_serializes_only_configured_device_details(tmp_path: Path) -> None:
    config, inventory = _api()
    path = tmp_path / "devices.json"
    _write_config(path, [_configured_devices()[2]])
    configured = config.load_lab_config(path)
    discovered = inventory.parse_adb_devices(
        "List of devices attached\n4de5967c device model:OPD2415\n"
        "unconfigured device model:PRIVATE_MODEL\n"
    )

    payload = inventory.match_inventory(configured, discovered).to_dict()

    assert payload == {
        "schemaVersion": 1,
        "strictOk": True,
        "devices": [
            {
                "alias": "android-tablet",
                "platform": "android",
                "id": "4de5967c",
                "expectedModel": "OPD2415",
                "model": "OPD2415",
                "state": "connected",
                "available": True,
                "reason": None,
            }
        ],
        "extraDeviceCount": 1,
    }
    assert "PRIVATE_MODEL" not in json.dumps(payload)


def test_run_inventory_writes_json_manifest_and_honors_strict_exit(tmp_path: Path) -> None:
    try:
        cli = importlib.import_module("quiver_lab.cli")
    except ModuleNotFoundError as exc:
        pytest.fail(f"inventory CLI implementation is missing: {exc}")
    _, inventory = _api()
    path = tmp_path / "devices.json"
    _write_config(path, [_configured_devices()[2]])
    output = StringIO()

    exit_code = cli.run_inventory(
        config_path=path,
        artifacts_root=tmp_path / "artifacts",
        lock_path=tmp_path / "cache" / "lab.lock",
        strict=True,
        json_output=True,
        output=output,
        commit_sha="abcdef1234567890",
        apple_discovery=lambda **_: (),
        android_discovery=lambda **_: inventory.parse_adb_devices(
            "List of devices attached\n4de5967c device model:OPD2415\n"
        ),
    )

    rendered = json.loads(output.getvalue())
    manifests = list((tmp_path / "artifacts").glob("*/manifest.json"))
    assert exit_code == 0
    assert rendered["strictOk"] is True
    assert len(manifests) == 1
    assert json.loads(manifests[0].read_text(encoding="utf-8"))["stage"] == "inventory"


def test_run_inventory_returns_failure_for_strict_unavailable_target(tmp_path: Path) -> None:
    try:
        cli = importlib.import_module("quiver_lab.cli")
    except ModuleNotFoundError as exc:
        pytest.fail(f"inventory CLI implementation is missing: {exc}")
    path = tmp_path / "devices.json"
    _write_config(path, [_configured_devices()[2]])

    exit_code = cli.run_inventory(
        config_path=path,
        artifacts_root=tmp_path / "artifacts",
        lock_path=tmp_path / "cache" / "lab.lock",
        strict=True,
        json_output=True,
        output=StringIO(),
        commit_sha="abcdef1234567890",
        apple_discovery=lambda **_: (),
        android_discovery=lambda **_: (),
    )

    assert exit_code == 1
