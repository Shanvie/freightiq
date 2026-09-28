"""Replaceable provider boundary for clearly labeled synthetic demo inputs."""

import math
import random
from datetime import date, timedelta
from typing import Any, Dict, List


def synthetic_market_history(days: int = 180) -> List[Dict[str, Any]]:
    rng = random.Random(2026)
    today = date.today()
    history = []
    for index in range(days):
        wave = math.sin(index / 9) * 1.7 + math.sin(index / 23) * 0.8
        freight = 18.4 + index * 0.012 + wave + rng.uniform(-0.45, 0.45)
        history.append(
            {
                "date": (today - timedelta(days=days - index - 1)).isoformat(),
                "freight_usd_tonne": round(max(8, freight), 2),
                "bdi": round(1320 + freight * 31 + rng.uniform(-45, 45)),
                "bunker_usd_tonne": round(510 + index * 0.16 + math.sin(index / 14) * 18, 2),
                "commodity_usd_tonne": round(108 + index * 0.025 + math.sin(index / 19) * 2.1, 2),
                "usd_inr": round(83.1 + index * 0.002 + math.sin(index / 32) * 0.34, 2),
                "congestion_days": round(max(0.4, 1.8 + math.sin(index / 11) * 0.9 + rng.random() * 0.7), 1),
            }
        )
    return history


VESSELS = [
    {"name": "Handysize", "capacity_tonnes": 35000, "draft_m": 10.5, "speed_knots": 12.5, "fuel_t_day": 22, "charter_usd_day": 14500},
    {"name": "Supramax", "capacity_tonnes": 58000, "draft_m": 12.8, "speed_knots": 12.2, "fuel_t_day": 26, "charter_usd_day": 17800},
    {"name": "Panamax", "capacity_tonnes": 82000, "draft_m": 14.8, "speed_knots": 11.8, "fuel_t_day": 31, "charter_usd_day": 22400},
    {"name": "Capesize", "capacity_tonnes": 175000, "draft_m": 18.2, "speed_knots": 11.2, "fuel_t_day": 52, "charter_usd_day": 36500},
]

PORTS = [
    {"name": "Paradip", "draft_m": 18.5, "distance_nm": 6100, "port_usd_tonne": 4.8, "handling_days": 3.0, "congestion_days": 1.5, "risk": 37},
    {"name": "Visakhapatnam", "draft_m": 18.1, "distance_nm": 6280, "port_usd_tonne": 5.2, "handling_days": 3.2, "congestion_days": 2.1, "risk": 42},
    {"name": "Chennai", "draft_m": 17.4, "distance_nm": 6540, "port_usd_tonne": 6.1, "handling_days": 3.5, "congestion_days": 2.8, "risk": 51},
    {"name": "Kamarajar", "draft_m": 18.5, "distance_nm": 6600, "port_usd_tonne": 5.8, "handling_days": 3.1, "congestion_days": 2.2, "risk": 43},
    {"name": "Krishnapatnam", "draft_m": 18.0, "distance_nm": 6350, "port_usd_tonne": 5.0, "handling_days": 3.0, "congestion_days": 1.9, "risk": 39},
]