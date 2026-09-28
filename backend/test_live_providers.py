import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

from backend import live_providers


class LiveProviderTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        live_providers._cache.clear()

    async def test_marine_adapter_selects_next_hour_and_labels_source(self):
        next_hour = datetime.now(timezone.utc).replace(
            minute=0, second=0, microsecond=0
        ) + timedelta(hours=1)
        payload = {
            "latitude": 20.27,
            "longitude": 86.67,
            "hourly": {
                "time": [
                    (next_hour - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M"),
                    next_hour.strftime("%Y-%m-%dT%H:%M"),
                ],
                "wave_height": [0.8, 1.2],
                "wave_period": [8.0, 9.5],
                "wave_direction": [180, 205],
            },
        }
        with patch.object(live_providers, "_get_json", new=AsyncMock(return_value=payload)):
            result = await live_providers._port_conditions("Paradip")

        self.assertEqual(result["status"], "live")
        self.assertEqual(result["wave_height_m"], 1.2)
        self.assertEqual(result["wave_period_s"], 9.5)
        self.assertEqual(result["sea_state"], "calm")
        self.assertEqual(result["source"], "Open-Meteo Marine")

    async def test_world_bank_selects_latest_non_null_logistics_score(self):
        payload = [
            {"page": 1},
            [
                {"date": "2025", "value": None},
                {"date": "2022", "value": 3.4},
            ],
        ]
        with patch.object(live_providers, "_get_json", new=AsyncMock(return_value=payload)):
            result = await live_providers._country_lpi("India", "IND")

        self.assertEqual(result["score"], 3.4)
        self.assertEqual(result["year"], "2022")
        self.assertEqual(result["status"], "live")

    async def test_currency_adapter_returns_dated_ecb_reference_rate(self):
        payload = {"date": "2026-09-28", "rates": {"INR": 95.98}}
        with patch.object(live_providers, "_get_json", new=AsyncMock(return_value=payload)):
            result = await live_providers._usd_inr()

        self.assertEqual(result["rate"], 95.98)
        self.assertEqual(result["date"], "2026-09-28")
        self.assertIn("ECB", result["source"])

    async def test_ais_positions_require_server_side_api_key(self):
        with patch.dict(os.environ, {}, clear=True):
            result = await live_providers.live_vessel_positions("Paradip")

        self.assertEqual(result["status"], "not_configured")
        self.assertEqual(result["ships"], [])
        self.assertNotIn("APIKey", result)

    def test_ais_position_report_normalizes_fields(self):
        result = live_providers._position_report(
            {
                "MessageType": "PositionReport",
                "MetaData": {"MMSI": 123456789, "ShipName": "  EXAMPLE VESSEL  "},
                "Message": {
                    "PositionReport": {
                        "Latitude": 20.3,
                        "Longitude": 86.7,
                        "Sog": 11.4,
                        "Cog": 94.2,
                        "TrueHeading": 95,
                        "NavigationalStatus": 0,
                        "Timestamp": 15,
                    }
                },
            }
        )

        self.assertEqual(result["name"], "EXAMPLE VESSEL")
        self.assertEqual(result["mmsi"], 123456789)
        self.assertEqual(result["speed_knots"], 11.4)


if __name__ == "__main__":
    unittest.main()
