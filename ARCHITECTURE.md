# FreightIQ Architecture

## Purpose and current scope

FreightIQ is a human-reviewed decision-support product for bulk cargo procurement and maritime chartering. The current runnable slice connects a React/TypeScript operator UI to a FastAPI API, a deterministic synthetic provider, a Python calculation engine, and SQLite persistence.

```text
React + TypeScript UI, including a lazily loaded Leaflet/OpenStreetMap map
        | JSON over HTTP
FastAPI routes + Pydantic validation
        |-- live provider adapters
        |     |-- Open-Meteo Marine hourly port forecasts
        |     |-- Frankfurter / ECB USD-INR reference exchange rate
        |     |-- World Bank Logistics Performance Index
        |     |-- optional server-side AISStream WebSocket snapshot
        |
        |-- interactive East Coast map
        |     |-- OpenStreetMap attributed base tiles
        |     |-- live marine forecast port markers
        |     |-- optional AISStream position markers
        |
Decision engine
  |-- deterministic synthetic scenario market assumptions
  |-- time-aware moving-average / trend baseline
  |-- vessel and port feasibility filters
  |-- landed-cost and timing alternatives
  |-- deterministic risk and stress calculations
  |-- scenario, decision, and audit persistence
        |
SQLite local database
```

## Decision flow

1. The scenario API validates quantity, dates, and numeric ranges and stores inputs.
2. The provider creates a repeatable, fixed-seed synthetic historical series. It is not presented as live data.
3. The forecast extends a trailing weekly mean with a recent linear trend and reports a simple recent-variability interval and a naive historical MAE.
4. Candidate vessel/port pairs are filtered for draft, requested destination, and deadline. Route distance varies by configured origin country assumptions; commodity selection changes the synthetic price marker.
5. Candidates are ranked by estimated landed cost plus a fixed risk weight. Timing alternatives compare procurement now, a 40/60 split, and procurement in 30 days under an explicit 2.5% freight assumption.
6. Fuel, freight, FX, and congestion shocks rerun the same calculation. Human decisions and reasons create timestamped audit events.

Scenario freight prices, vessel economics, and port costs remain estimates driven by demo assumptions. The separate Live shipping page shows real external marine forecast, exchange-rate reference, and periodic country logistics data, each with source and freshness. AIS requires an optional provider key. Budget satisfaction is reported for review; it is not a production policy solver. Risk indices are not calibrated probabilities. The scenario forecast is not trained ML.

## API surface

- `GET /api/health`, `GET /api/overview`
- `GET /api/live/providers`, `/api/live/shipping`, `/api/live/marine`, `/api/live/logistics`, `/api/live/fx`, `/api/live/ais?port={name}`
- `GET /api/scenarios`, `POST /api/scenarios`, `GET /api/scenarios/{id}`
- `POST /api/scenarios/{id}/analyze`
- `POST /api/scenarios/{id}/simulate`
- `POST /api/scenarios/{id}/decision`
- `GET /api/audit?scenario_id={id}`

Contracts use Pydantic. API origins are configured by `FREIGHTIQ_CORS_ORIGINS`; the frontend base URL is `VITE_API_URL`.

## Persistence and production path

SQLite is the self-contained local default. PostgreSQL, SQLAlchemy/Alembic migrations, institutional identity and RBAC, append-only audit storage, secrets management, API rate limits, background jobs, and retention/backup policies remain deployment work. Docker is not installed in the current environment, so a container stack was not built or verified.

## Data and model evolution

`backend/providers.py` contains the replaceable synthetic scenario market series and candidate vessel/port assumptions. `backend/live_providers.py` contains separate, source-attributed adapters for marine forecasts, FX, country logistics indicators, and optional AIS positions. Production procurement estimates still need licensed freight and bunker feeds, validated vessel/port catalogs, ingestion monitoring, and reconciliation. Model comparison, chronological backtesting, model registry/version approval, calibrated uncertainty, and explainability need to be added before production forecast claims are made.
