"""Date-range filtering on the decisions list.

The filters exist so a claim on screen -- "6 transactions today" -- can be
opened and checked. A wrong boundary would show the wrong evidence for the
number it is meant to justify.
"""

from datetime import datetime, timedelta, timezone

from aegis.api.routes import _as_naive_utc


class TestNormalisation:
    def test_utc_aware_loses_only_the_tzinfo(self):
        value = datetime(2026, 8, 15, 20, 45, tzinfo=timezone.utc)
        assert _as_naive_utc(value) == datetime(2026, 8, 15, 20, 45)

    def test_offset_is_converted_not_truncated(self):
        """02:15 IST is 20:45 UTC the previous day, not 02:15."""
        ist = timezone(timedelta(hours=5, minutes=30))
        value = datetime(2026, 8, 16, 2, 15, tzinfo=ist)
        assert _as_naive_utc(value) == datetime(2026, 8, 15, 20, 45)

    def test_naive_is_left_alone(self):
        value = datetime(2026, 8, 15, 20, 45)
        assert _as_naive_utc(value) == value

    def test_result_is_always_comparable_to_a_stored_timestamp(self):
        """SQLite hands back naive datetimes; comparing to aware ones raises."""
        for value in (
            datetime(2026, 8, 15, 20, 45, tzinfo=timezone.utc),
            datetime(2026, 8, 15, 20, 45),
            datetime(2026, 8, 15, 20, 45, tzinfo=timezone(timedelta(hours=-5))),
        ):
            assert _as_naive_utc(value).tzinfo is None


class TestSerialisation:
    def test_api_stamps_naive_datetimes_as_utc(self):
        """A naive timestamp leaving the API must say it is UTC.

        Without the marker a browser reads it as local time, so a decision made
        at 02:15 IST rendered as 20:45 -- right data, wrong clock, on every
        screen in the product.
        """
        import json

        from aegis.api.schemas import ApiModel

        class Sample(ApiModel):
            when: datetime

        naive = json.loads(Sample(when=datetime(2026, 8, 15, 20, 45)).model_dump_json())["when"]
        assert naive.endswith("Z") or "+00:00" in naive, naive

    def test_offset_datetimes_are_normalised_to_utc(self):
        import json

        from aegis.api.schemas import ApiModel

        class Sample(ApiModel):
            when: datetime

        ist = timezone(timedelta(hours=5, minutes=30))
        payload = json.loads(Sample(when=datetime(2026, 8, 16, 2, 15, tzinfo=ist)).model_dump_json())
        # Same instant, expressed in UTC.
        assert payload["when"].startswith("2026-08-15T20:45")
