"""Deterministic demo forecast and decision calculations."""

import math
import statistics
from datetime import date
from typing import Any, Dict, List, Optional

from backend.providers import PORTS, VESSELS, synthetic_market_history


def forecast(history: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    rows = history or synthetic_market_history()
    rates = [row["freight_usd_tonne"] for row in rows]
    recent = rates[-30:]
    weekly = rates[-7:]
    slope = (recent[-1] - recent[0]) / max(1, len(recent) - 1)
    predicted = max(1, statistics.mean(weekly) + slope * 30)
    spread = statistics.pstdev(recent)
    confidence = max(52, min(94, round(100 - spread / max(statistics.mean(recent), 1) * 100)))
    return {
        "predicted_freight_usd_tonne": round(predicted, 2),
        "lower_bound": round(max(0, predicted - 1.28 * spread), 2),
        "upper_bound": round(predicted + 1.28 * spread, 2),
        "confidence": confidence,
        "trend": "Rising" if predicted > statistics.mean(recent) + 0.15 else "Easing",
        "method": "30-day trend extension over a 7-day moving average",
        "model_version": "demo-baseline-1.0",
        "historical_mae": round(statistics.mean(abs(a - b) for a, b in zip(rates[-30:], rates[-31:-1])), 2),
        "series": rows,
    }


def _risk_score(volatility: float, congestion: float, delivery_days: float, available_days: int) -> Dict[str, Any]:
    market = min(100, round(28 + volatility * 7))
    port = min(100, round(22 + congestion * 12))
    schedule = min(100, round(20 + max(0, delivery_days - available_days * 0.72) * 1.5))
    overall = round(market * 0.35 + port * 0.3 + schedule * 0.35)
    label = "Low" if overall <= 30 else "Medium" if overall <= 60 else "High" if overall <= 80 else "Critical"
    return {"score": overall, "label": label, "market": market, "port": port, "delivery": schedule}


def analyze(inputs: Dict[str, Any], shocks: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
    shocks = shocks or {}
    history = synthetic_market_history()
    market = forecast(history)
    latest = history[-1]
    quantity = int(inputs["quantity_tonnes"])
    max_draft = float(inputs.get("max_draft_m") or 99)
    deadline = date.fromisoformat(inputs["delivery_deadline"])
    days_available = max(0, (deadline - date.today()).days)
    fx = latest["usd_inr"] * (1 + shocks.get("fx_pct", 0) / 100)
    bunker = latest["bunker_usd_tonne"] * (1 + shocks.get("fuel_pct", 0) / 100)
    freight_factor = 1 + shocks.get("freight_pct", 0) / 100
    route_factor = {"Australia": 1.0, "Indonesia": 0.53, "South Africa": 0.9, "Brazil": 1.28}.get(inputs.get("origin"), 1.0)
    commodity_factor = {"Coal": 1.0, "Iron ore": 0.88, "Grain": 2.15, "Fertilizer": 2.75}.get(inputs.get("commodity"), 1.45)
    commodity_now = latest["commodity_usd_tonne"] * commodity_factor
    commodity_later = commodity_now * (1 + min(0.08, max(-0.08, (latest["commodity_usd_tonne"] - history[-31]["commodity_usd_tonne"]) / latest["commodity_usd_tonne"])))
    if shocks.get("commodity_pct"):
        commodity_now *= 1 + shocks["commodity_pct"] / 100
        commodity_later *= 1 + shocks["commodity_pct"] / 100

    candidates = []
    for vessel in VESSELS:
        trips = math.ceil(quantity / vessel["capacity_tonnes"])
        for port in PORTS:
            if port["name"] != inputs.get("destination_port", "Any East Coast port") and inputs.get("destination_port") != "Any East Coast port":
                continue
            if vessel["draft_m"] > min(max_draft, port["draft_m"]):
                continue
            distance_nm = port["distance_nm"] * route_factor
            congestion_days = max(0, port["congestion_days"] + shocks.get("congestion_days", 0))
            one_way_days = distance_nm / vessel["speed_knots"] / 24
            delivery_days = trips * (one_way_days + port["handling_days"] + congestion_days)
            if delivery_days > days_available:
                continue
            round_trip_days = distance_nm * 2 / vessel["speed_knots"] / 24 + port["handling_days"] + congestion_days
            charter_total = vessel["charter_usd_day"] * round_trip_days * trips
            fuel_total = vessel["fuel_t_day"] * round_trip_days * trips * bunker
            freight = (charter_total + fuel_total) / quantity * freight_factor
            port_cost = port["port_usd_tonne"] + congestion_days * 0.65
            landed_now = commodity_now + freight + port_cost + 3.2 + 450 / fx
            landed_later = commodity_later + freight * (1 + 0.025) + port_cost + 3.2 + 450 / fx
            risk = _risk_score(statistics.pstdev([row["freight_usd_tonne"] for row in history[-30:]]), congestion_days, delivery_days, days_available)
            candidates.append({
                "vessel": vessel["name"],
                "port": port["name"],
                "capacity_tonnes": vessel["capacity_tonnes"],
                "draft_m": vessel["draft_m"],
                "trips": trips,
                "freight_usd_tonne": round(freight, 2),
                "charter_cost_usd": round(charter_total, 0),
                "fuel_cost_usd": round(fuel_total, 0),
                "delivery_days": round(delivery_days, 1),
                "cost_now_usd_tonne": round(landed_now, 2),
                "cost_later_usd_tonne": round(landed_later, 2),
                "risk": risk,
            })
    if not candidates:
        return {"feasible": False, "reason": "No vessel and port combination satisfies draft and delivery constraints.", "forecast": {k: v for k, v in market.items() if k != "series"}, "candidates": [], "market": latest, "history": history, "data_label": "DEMO MODE - SYNTHETIC DATA"}

    budget_crore = inputs.get("budget_crore")
    strategy_definitions = [
        {"name": "Procure now", "now_share": 1.0},
        {"name": "Split 40 / 60", "now_share": 0.4},
        {"name": "Procure in 30 days", "now_share": 0.0},
    ]
    ranked_options = []
    for candidate in candidates:
        for strategy in strategy_definitions:
            cost_usd_tonne = candidate["cost_now_usd_tonne"] * strategy["now_share"] + candidate["cost_later_usd_tonne"] * (1 - strategy["now_share"])
            total_inr = cost_usd_tonne * quantity * fx
            if budget_crore is not None and total_inr > budget_crore * 10000000:
                continue
            ranked_options.append({
                **strategy,
                "vessel": candidate["vessel"],
                "port": candidate["port"],
                "cost_usd_tonne": round(cost_usd_tonne, 2),
                "total_cost_crore": round(total_inr / 10000000, 2),
                "objective_usd_tonne": round(cost_usd_tonne + candidate["risk"]["score"] * 0.025, 4),
                "candidate": candidate,
            })
    if not ranked_options:
        return {
            "feasible": False,
            "reason": "No vessel, port, and procurement timing combination satisfies the entered budget.",
            "forecast": {key: value for key, value in market.items() if key != "series"},
            "market": latest,
            "history": history,
            "candidates": candidates,
            "alternatives": [],
            "strategies": [],
            "reasons": ["All delivery- and draft-feasible plans exceed the entered budget."],
            "constraints": {"quantity_tonnes": quantity, "max_draft_m": max_draft, "days_available": days_available, "budget_crore": budget_crore, "budget_satisfied": False},
            "data_label": "DEMO MODE - SYNTHETIC DATA",
        }

    ranked_options.sort(key=lambda item: (item["objective_usd_tonne"], item["total_cost_crore"], item["candidate"]["delivery_days"]))
    selected = ranked_options[0]
    best = selected["candidate"]
    baseline_option = min(candidates, key=lambda item: item["cost_now_usd_tonne"])
    baseline = baseline_option["cost_now_usd_tonne"]
    total_inr = selected["total_cost_crore"] * 10000000
    budget_ok = True
    alternatives = [
        {"vessel": item["vessel"], "port": item["port"], "procurement": item["name"], "landed_cost_inr_tonne": round(item["cost_usd_tonne"] * fx), "delivery_days": item["candidate"]["delivery_days"], "risk": item["candidate"]["risk"]["label"]}
        for item in ranked_options[:5]
    ]
    reasons = [
        "The selected vessel and port pass the entered draft and delivery constraints.",
        "The recommendation minimizes landed cost plus a modest risk penalty across feasible vessel, port, and timing combinations.",
        "Procurement timing uses the synthetic commodity trend and an explicit 2.5% later freight assumption.",
    ]
    return {
        "feasible": True,
        "recommended": {
            "procurement": selected["name"],
            "vessel": best["vessel"],
            "port": best["port"],
            "freight_usd_tonne": best["freight_usd_tonne"],
            "landed_cost_inr_tonne": round(selected["cost_usd_tonne"] * fx),
            "total_cost_crore": round(total_inr / 10000000, 2),
            "baseline_cost_crore": round(baseline * quantity * fx / 10000000, 2),
            "estimated_savings_crore": round((baseline - selected["cost_usd_tonne"]) * quantity * fx / 10000000, 2),
            "delivery_days": best["delivery_days"],
            "risk": best["risk"],
            "confidence": market["confidence"],
            "budget_satisfied": budget_ok,
            "objective_usd_tonne": selected["objective_usd_tonne"],
        },
        "forecast": {key: value for key, value in market.items() if key != "series"},
        "market": latest,
        "history": history,
        "candidates": candidates,
        "strategies": [
            {"name": strategy["name"], "now_share": strategy["now_share"], "cost_usd_tonne": round(best["cost_now_usd_tonne"] * strategy["now_share"] + best["cost_later_usd_tonne"] * (1 - strategy["now_share"]), 2)}
            for strategy in strategy_definitions
        ],
        "ranked_options": [{key: value for key, value in option.items() if key != "candidate"} for option in ranked_options],
        "alternatives": alternatives,
        "reasons": reasons,
        "constraints": {"quantity_tonnes": quantity, "max_draft_m": max_draft, "days_available": days_available, "budget_crore": budget_crore, "budget_satisfied": budget_ok},
        "data_label": "DEMO MODE - SYNTHETIC DATA",
        "optimization_version": "landed-cost-ranker-1.0",
    }