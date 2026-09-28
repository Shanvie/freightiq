import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from backend import main


class ScenarioApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_patch = patch.object(
            main, "DATABASE_PATH", Path(self.temp_dir.name) / "test.db"
        )
        self.database_patch.start()
        main.initialize_database()
        self.client = TestClient(main.app)

    def tearDown(self):
        self.client.close()
        self.database_patch.stop()
        self.temp_dir.cleanup()

    def test_scenario_to_human_decision_and_audit(self):
        inputs = {
            "commodity": "Coal",
            "quantity_tonnes": 100000,
            "origin": "Australia",
            "destination_port": "Paradip",
            "delivery_deadline": (date.today() + timedelta(days=180)).isoformat(),
            "max_draft_m": 16,
            "budget_crore": 180,
        }
        created = self.client.post("/api/scenarios", json=inputs)
        self.assertEqual(created.status_code, 201)
        scenario_id = created.json()["id"]

        analysis = self.client.post(f"/api/scenarios/{scenario_id}/analyze")
        self.assertEqual(analysis.status_code, 200)
        baseline = analysis.json()
        self.assertTrue(baseline["feasible"])
        self.assertEqual(baseline["recommended"]["port"], "Paradip")
        self.assertTrue(baseline["data_label"].startswith("DEMO MODE"))

        stress = self.client.post(
            f"/api/scenarios/{scenario_id}/simulate",
            json={"fuel_pct": 20, "freight_pct": 25, "congestion_days": 3, "fx_pct": 5},
        )
        self.assertEqual(stress.status_code, 200)
        self.assertGreater(
            stress.json()["result"]["recommended"]["landed_cost_inr_tonne"],
            baseline["recommended"]["landed_cost_inr_tonne"],
        )

        modified_inputs = dict(inputs, quantity_tonnes=101000)
        modified = self.client.post(
            f"/api/scenarios/{scenario_id}/decision",
            json={
                "action": "modify",
                "actor": "Test Officer",
                "reason": "Adjust quantity to the current requirement.",
                "modified_inputs": modified_inputs,
            },
        )
        self.assertEqual(modified.status_code, 200)
        self.assertEqual(modified.json()["inputs"]["quantity_tonnes"], 101000)

        approved = self.client.post(
            f"/api/scenarios/{scenario_id}/decision",
            json={
                "action": "approve",
                "actor": "Test Officer",
                "reason": "Reviewed alternatives and delivery feasibility.",
            },
        )
        self.assertEqual(approved.status_code, 200)
        self.assertEqual(approved.json()["status"], "approved")

        audit = self.client.get(f"/api/audit?scenario_id={scenario_id}")
        self.assertEqual(audit.status_code, 200)
        self.assertEqual(len(audit.json()), 5)
        self.assertEqual(audit.json()[0]["action"], "decision.approve")
        self.assertEqual(audit.json()[1]["action"], "decision.modify")

    def test_invalid_scenario_input_is_rejected(self):
        response = self.client.post(
            "/api/scenarios",
            json={
                "commodity": "Coal",
                "quantity_tonnes": 10,
                "origin": "Australia",
                "destination_port": "Paradip",
                "delivery_deadline": "not-a-date",
                "max_draft_m": 16,
            },
        )
        self.assertEqual(response.status_code, 422)

    def test_live_provider_catalog_distinguishes_keys_and_licensed_rates(self):
        response = self.client.get("/api/live/providers")

        self.assertEqual(response.status_code, 200)
        providers = {item["id"]: item for item in response.json()["providers"]}
        self.assertEqual(providers["marine"]["status"], "available")
        self.assertEqual(providers["freight"]["status"], "needs_subscription")

    def test_live_shipping_snapshot_route_returns_provider_data(self):
        sample = {
            "generated_at": "2026-09-28T00:00:00+00:00",
            "data_label": "LIVE PUBLIC SOURCES",
            "marine_conditions": [],
            "country_logistics": [],
            "currency": {"status": "live"},
            "ais": {"status": "not_configured"},
            "freight_rates": {"status": "not_configured"},
        }
        with patch.object(
            main, "live_shipping_snapshot", new=AsyncMock(return_value=sample)
        ):
            response = self.client.get("/api/live/shipping")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["currency"]["status"], "live")

    def test_ais_endpoint_validates_port_and_returns_config_state(self):
        with patch.object(
            main,
            "live_vessel_positions",
            new=AsyncMock(
                return_value={
                    "status": "not_configured",
                    "port": "Paradip",
                    "ships": [],
                    "message": "AIS API key required",
                }
            ),
        ) as ais:
            response = self.client.get("/api/live/ais?port=Paradip")
            invalid = self.client.get("/api/live/ais?port=Unknown")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "not_configured")
        self.assertEqual(invalid.status_code, 422)
        ais.assert_awaited_once_with("Paradip")


if __name__ == "__main__":
    unittest.main()
