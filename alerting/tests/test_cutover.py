"""Operator cutover CLI behavior through its public command seam."""

from datetime import datetime, timezone
import pytest

from alerting import cutover
from alerting.ports import (
    AlertPath,
    DeliveryMode,
    DestinationMode,
    NotificationIntentRecord,
    OutboxStatus,
)
from alerting.postgres import PostgresAlertStore

START = datetime(2026, 8, 27, 19, 0, tzinfo=timezone.utc)


class FakeCutoverStore:
    def __init__(self) -> None:
        self.archived: list[AlertPath] = []

    def shadow_outputs(
        self, *, alert_path: AlertPath, limit: int
    ) -> list[NotificationIntentRecord]:
        assert alert_path is AlertPath.FAST_CI
        assert limit == 5
        return [
            NotificationIntentRecord(
                delivery_id="fast-ci:1",
                alert_ref="fast-ci:1",
                alert_path=AlertPath.FAST_CI,
                delivery_mode=DeliveryMode.SHADOW,
                destination_mode=DestinationMode.BOT_TOKEN,
                destination="C0ANHBE642Y",
                payload={"text": "representative rendered alert"},
                status=OutboxStatus.PENDING,
                attempts=0,
                next_attempt_at=START,
                created_at=START,
            )
        ]

    def archive_pending_live(self, *, alert_path: AlertPath) -> int:
        self.archived.append(alert_path)
        return 2


def install_store(monkeypatch: pytest.MonkeyPatch, store: FakeCutoverStore) -> None:
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://operator:secret@db.example.com/production",
    )
    monkeypatch.setattr(
        PostgresAlertStore,
        "from_database_url",
        lambda database_url: store,
    )


def test_export_shadow_prints_rendered_payload_without_database_credentials(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    store = FakeCutoverStore()
    install_store(monkeypatch, store)

    assert cutover.main(["export-shadow", "--path", "fast_ci", "--limit", "5"]) == 0

    output = capsys.readouterr().out
    assert "representative rendered alert" in output
    assert '"delivery_mode": "shadow"' in output
    assert "operator" not in output
    assert "secret" not in output


def test_archive_pending_requires_exact_path_confirmation(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    store = FakeCutoverStore()
    install_store(monkeypatch, store)

    assert (
        cutover.main(
            [
                "archive-pending",
                "--path",
                "full_ci",
                "--confirm-path",
                "fast_ci",
            ]
        )
        == 2
    )
    assert store.archived == []
    assert "confirmation does not match" in capsys.readouterr().err


def test_archive_pending_preserves_rows_as_shadow_output(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    store = FakeCutoverStore()
    install_store(monkeypatch, store)

    assert (
        cutover.main(
            [
                "archive-pending",
                "--path",
                "fast_ci",
                "--confirm-path",
                "fast_ci",
            ]
        )
        == 0
    )
    assert store.archived == [AlertPath.FAST_CI]
    assert "archived 2 pending live records" in capsys.readouterr().out
