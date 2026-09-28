import unittest
from datetime import date, timedelta

from backend.engine import analyze, forecast
from backend.providers import synthetic_market_history


class DecisionEngineTests(unittest.TestCase):
    def setUp(self):
        self.inputs = {
            "commodity": "Coal",
            "quantity_tonnes": 100000,
            "origin": "Australia",
            "destination_port": "Paradip",
            "delivery_deadline": (date.today() + timedelta(days=180)).isoformat(),
            "max_draft_m": 16,
            "budget_crore": 250,
        }

    def test_provider_is_deterministic_and_marked_by_caller(self):
        self.assertEqual(synthetic_market_history(), synthetic_market_history())

    def test_forecast_uses_chronological_history_and_returns_interval(self):
        result = forecast(synthetic_market_history())
        self.assertLessEqual(result["lower_bound"], result["predicted_freight_usd_tonne"])
        self.assertGreaterEqual(result["upper_bound"], result["predicted_freight_usd_tonne"])
        self.assertEqual(len(result["series"]), 180)

    def test_analysis_returns_only_constraint_compatible_candidates(self):
        result = analyze(self.inputs)
        self.assertTrue(result["feasible"])
        self.assertTrue(all(candidate["draft_m"] <= self.inputs["max_draft_m"] for candidate in result["candidates"]))
        self.assertEqual(result["recommended"]["port"], "Paradip")

    def test_tighter_deadline_can_make_scenario_infeasible(self):
        inputs = dict(self.inputs, delivery_deadline=(date.today() + timedelta(days=2)).isoformat())
        self.assertFalse(analyze(inputs)["feasible"])

    def test_market_shock_changes_calculated_landed_cost(self):
        base = analyze(self.inputs)
        stressed = analyze(self.inputs, {"fuel_pct": 20, "freight_pct": 25})
        self.assertGreater(stressed["recommended"]["landed_cost_inr_tonne"], base["recommended"]["landed_cost_inr_tonne"])

    def test_origin_changes_voyage_economics(self):
        australia = analyze(self.inputs)
        indonesia = analyze(dict(self.inputs, origin="Indonesia"))
        self.assertLess(indonesia["recommended"]["freight_usd_tonne"], australia["recommended"]["freight_usd_tonne"])

    def test_commodity_changes_procurement_cost(self):
        coal = analyze(self.inputs)
        grain = analyze(dict(self.inputs, commodity="Grain"))
        self.assertGreater(grain["recommended"]["landed_cost_inr_tonne"], coal["recommended"]["landed_cost_inr_tonne"])

    def test_recommendation_is_global_minimum_across_timing_and_candidates(self):
        result = analyze(self.inputs)
        shares = {"Procure now": 1.0, "Split 40 / 60": 0.4, "Procure in 30 days": 0.0}
        options = []
        for candidate in result["candidates"]:
            for strategy, now_share in shares.items():
                cost = candidate["cost_now_usd_tonne"] * now_share + candidate["cost_later_usd_tonne"] * (1 - now_share)
                options.append((cost + candidate["risk"]["score"] * 0.025, strategy, candidate))
        objective, strategy, candidate = min(options, key=lambda option: option[0])
        recommendation = result["recommended"]
        self.assertEqual(recommendation["procurement"], strategy)
        self.assertEqual(recommendation["vessel"], candidate["vessel"])
        self.assertEqual(recommendation["port"], candidate["port"])
        self.assertAlmostEqual(recommendation["objective_usd_tonne"], objective, places=3)

    def test_budget_is_a_hard_constraint(self):
        result = analyze(dict(self.inputs, budget_crore=1))
        self.assertFalse(result["feasible"])
        self.assertNotIn("recommended", result)
        self.assertIn("budget", result["reason"].lower())
        self.assertFalse(result["constraints"]["budget_satisfied"])


if __name__ == "__main__":
    unittest.main()