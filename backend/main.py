"""FreightIQ local demo API. It is decision support, not procurement execution."""

import json
import os
import sqlite3
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pydantic import BaseModel, Field

from backend.engine import analyze
from backend.live_providers import (
    COUNTRIES,
    PORT_COORDINATES,
    live_country_logistics,
    live_currency,
    live_marine_conditions,
    live_shipping_snapshot,
    live_vessel_positions,
)
from backend.providers import synthetic_market_history


load_dotenv()
DATABASE_PATH = Path(os.getenv("FREIGHTIQ_DATABASE", "data/freightiq.db"))
DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database() -> None:
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS scenarios (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                inputs TEXT NOT NULL,
                analysis TEXT,
                status TEXT NOT NULL DEFAULT 'draft'
            );
            CREATE TABLE IF NOT EXISTS audit_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scenario_id TEXT NOT NULL,
                actor TEXT NOT NULL,
                action TEXT NOT NULL,
                reason TEXT NOT NULL,
                created_at TEXT NOT NULL,
                details TEXT NOT NULL,
                FOREIGN KEY(scenario_id) REFERENCES scenarios(id)
            );
            CREATE INDEX IF NOT EXISTS idx_audit_scenario_time ON audit_events(scenario_id, created_at);
            """
        )


initialize_database()
app = FastAPI(
    title="FreightIQ API",
    version="0.2.0",
    description="Decision-support demo with source-attributed live shipping data adapters",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("FREIGHTIQ_CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class ScenarioInput(BaseModel):
    commodity: str = Field(min_length=2, max_length=40)
    quantity_tonnes: int = Field(ge=1000, le=10000000)
    origin: str = Field(min_length=2, max_length=80)
    destination_port: str = Field(default="Any East Coast port", max_length=80)
    delivery_deadline: date
    max_draft_m: float = Field(default=16, gt=0, le=30)
    budget_crore: Optional[float] = Field(default=None, gt=0, le=1000000)


class DecisionInput(BaseModel):
    action: str = Field(pattern="^(approve|reject|modify)$")
    actor: str = Field(min_length=2, max_length=100)
    reason: str = Field(min_length=5, max_length=1000)
    modified_inputs: Optional[ScenarioInput] = None


class SimulationInput(BaseModel):
    fuel_pct: float = Field(default=0, ge=-100, le=300)
    freight_pct: float = Field(default=0, ge=-100, le=300)
    fx_pct: float = Field(default=0, ge=-50, le=100)
    congestion_days: float = Field(default=0, ge=0, le=30)


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def audit(scenario_id: str, actor: str, action: str, reason: str, details: Dict[str, Any]) -> None:
    with connect() as db:
        db.execute(
            "INSERT INTO audit_events(scenario_id, actor, action, reason, created_at, details) VALUES (?, ?, ?, ?, ?, ?)",
            (scenario_id, actor, action, reason, timestamp(), json.dumps(details)),
        )


def scenario_record(row: sqlite3.Row) -> Dict[str, Any]:
    return {"id": row["id"], "created_at": row["created_at"], "updated_at": row["updated_at"], "inputs": json.loads(row["inputs"]), "analysis": json.loads(row["analysis"]) if row["analysis"] else None, "status": row["status"]}


@app.get("/api/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "data_mode": "synthetic_estimates_with_live_feeds"}


@app.get("/api/live/providers")
def live_providers() -> Dict[str, Any]:
    return {
        "providers": [
            {
                "id": "marine",
                "name": "Open-Meteo Marine",
                "category": "Port sea conditions",
                "status": "available",
                "refresh": "Hourly forecast; cached locally for 10 minutes",
                "source_url": "https://open-meteo.com/en/docs/marine-weather-api",
            },
            {
                "id": "currency",
                "name": "Frankfurter / ECB",
                "category": "USD/INR reference rate",
                "status": "available",
                "refresh": "Daily reference rate; cached locally for 30 minutes",
                "source_url": "https://frankfurter.dev",
            },
            {
                "id": "logistics",
                "name": "World Bank",
                "category": "Logistics Performance Index",
                "status": "available",
                "refresh": "Latest published observation; cached locally for 24 hours",
                "source_url": "https://data.worldbank.org/indicator/LP.LPI.OVRL.XQ",
            },
            {
                "id": "ais",
                "name": "AISStream",
                "category": "Live AIS vessel positions",
                "status": "configured" if os.getenv("AISSTREAM_API_KEY") else "needs_api_key",
                "refresh": "On-demand 8-second server-side AIS snapshot",
                "source_url": "https://aisstream.io",
            },
            {
                "id": "freight",
                "name": "Commercial freight indices",
                "category": "Bulk spot / route rates",
                "status": "needs_subscription",
                "refresh": "Requires licensed provider subscription",
                "source_url": None,
            },
        ],
        "coverage": {
            "ports": list(PORT_COORDINATES),
            "countries": list(COUNTRIES),
        },
    }


@app.get("/api/live/marine")
async def live_marine() -> Dict[str, Any]:
    return {"ports": await live_marine_conditions()}


@app.get("/api/live/logistics")
async def live_logistics() -> Dict[str, Any]:
    return {"countries": await live_country_logistics()}


@app.get("/api/live/fx")
async def live_fx() -> Dict[str, Any]:
    return await live_currency()


@app.get("/api/live/shipping")
async def live_shipping() -> Dict[str, Any]:
    return await live_shipping_snapshot()


@app.get("/api/live/ais")
async def live_ais(port: str = Query(default="Paradip", max_length=32)) -> Dict[str, Any]:
    if port not in PORT_COORDINATES:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported port. Choose one of: {', '.join(PORT_COORDINATES)}",
        )
    try:
        return await live_vessel_positions(port)
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/api/overview")
def overview() -> Dict[str, Any]:
    history = synthetic_market_history()
    result = analyze({"commodity": "Coal", "quantity_tonnes": 100000, "origin": "Australia", "destination_port": "Any East Coast port", "delivery_deadline": "2027-12-31", "max_draft_m": 16, "budget_crore": None})
    with connect() as db:
        scenarios = db.execute("SELECT COUNT(*) AS count FROM scenarios").fetchone()["count"]
    return {"label": "DEMO MODE - SYNTHETIC DATA", "market": history[-1], "history": history[-30:], "freight_forecast": result["forecast"], "scenario_count": scenarios}


@app.get("/api/scenarios")
def list_scenarios() -> List[Dict[str, Any]]:
    with connect() as db:
        rows = db.execute("SELECT * FROM scenarios ORDER BY updated_at DESC LIMIT 100").fetchall()
    return [scenario_record(row) for row in rows]


@app.post("/api/scenarios", status_code=201)
def create_scenario(inputs: ScenarioInput) -> Dict[str, Any]:
    scenario_id = str(uuid.uuid4())
    now = timestamp()
    payload = inputs.model_dump(mode="json")
    with connect() as db:
        db.execute("INSERT INTO scenarios(id, created_at, updated_at, inputs) VALUES (?, ?, ?, ?)", (scenario_id, now, now, json.dumps(payload)))
    audit(scenario_id, "local-demo-user", "scenario.created", "Scenario submitted for analysis", payload)
    with connect() as db:
        return scenario_record(db.execute("SELECT * FROM scenarios WHERE id = ?", (scenario_id,)).fetchone())


@app.get("/api/scenarios/{scenario_id}")
def get_scenario(scenario_id: str) -> Dict[str, Any]:
    with connect() as db:
        row = db.execute("SELECT * FROM scenarios WHERE id = ?", (scenario_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return scenario_record(row)


@app.post("/api/scenarios/{scenario_id}/analyze")
def analyze_scenario(scenario_id: str) -> Dict[str, Any]:
    with connect() as db:
        row = db.execute("SELECT * FROM scenarios WHERE id = ?", (scenario_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Scenario not found")
    inputs = json.loads(row["inputs"])
    result = analyze(inputs)
    status = "analyzed" if result["feasible"] else "infeasible"
    with connect() as db:
        db.execute("UPDATE scenarios SET updated_at = ?, analysis = ?, status = ? WHERE id = ?", (timestamp(), json.dumps(result), status, scenario_id))
    audit(scenario_id, "local-demo-user", "analysis.completed", "Deterministic scenario analysis completed", {"feasible": result["feasible"], "optimization_version": result.get("optimization_version")})
    return result


@app.post("/api/scenarios/{scenario_id}/simulate")
def simulate_scenario(scenario_id: str, shocks: SimulationInput) -> Dict[str, Any]:
    with connect() as db:
        row = db.execute("SELECT * FROM scenarios WHERE id = ?", (scenario_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Scenario not found")
    result = analyze(json.loads(row["inputs"]), shocks.model_dump())
    audit(scenario_id, "local-demo-user", "simulation.completed", "Synthetic market stress applied", shocks.model_dump())
    return {"shocks": shocks.model_dump(), "result": result}


@app.post("/api/scenarios/{scenario_id}/decision")
def record_decision(scenario_id: str, decision: DecisionInput) -> Dict[str, Any]:
    with connect() as db:
        row = db.execute("SELECT * FROM scenarios WHERE id = ?", (scenario_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Scenario not found")
    if decision.action == "modify" and decision.modified_inputs is None:
        raise HTTPException(status_code=422, detail="Modified inputs are required for a modified decision")
    inputs = decision.modified_inputs.model_dump(mode="json") if decision.action == "modify" and decision.modified_inputs else json.loads(row["inputs"])
    analysis = analyze(inputs) if decision.action == "modify" else json.loads(row["analysis"]) if row["analysis"] else None
    status = "approved" if decision.action == "approve" else "rejected" if decision.action == "reject" else "modified"
    with connect() as db:
        db.execute("UPDATE scenarios SET inputs = ?, analysis = ?, updated_at = ?, status = ? WHERE id = ?", (json.dumps(inputs), json.dumps(analysis) if analysis else None, timestamp(), status, scenario_id))
    audit(scenario_id, decision.actor, "decision." + decision.action, decision.reason, {"status": status, "modified_inputs": inputs if decision.action == "modify" else None})
    return get_scenario(scenario_id)


@app.get("/api/audit")
def audit_history(scenario_id: Optional[str] = None) -> List[Dict[str, Any]]:
    with connect() as db:
        if scenario_id:
            rows = db.execute("SELECT * FROM audit_events WHERE scenario_id = ? ORDER BY id DESC LIMIT 200", (scenario_id,)).fetchall()
        else:
            rows = db.execute("SELECT * FROM audit_events ORDER BY id DESC LIMIT 200").fetchall()
    return [{"id": row["id"], "scenario_id": row["scenario_id"], "actor": row["actor"], "action": row["action"], "reason": row["reason"], "created_at": row["created_at"], "details": json.loads(row["details"])} for row in rows]