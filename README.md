# FreightIQ

**AI-powered maritime procurement and chartering decision intelligence.** This repository contains a local, human-reviewed decision-support app, not a production procurement platform. Scenario freight rates, vessel economics, and port economics remain deterministic demo assumptions; the Live shipping workspace separately fetches source-attributed marine forecasts, ECB reference FX, and World Bank logistics data. Live AIS positions are available when configured with a provider key.

## Run locally

Requirements: Node.js 20.19+ (or 22.12+) and Python 3.9+. The local backend uses SQLite so no external services are needed. Docker/PostgreSQL deployment is not included in this verified slice.

Copy `.env.example` to `.env` to use the documented defaults; both Vite and the backend load it.

Terminal 1, from the repository root:

```sh
python3 -m pip install -r backend/requirements.txt
python3 -m uvicorn backend.main:app --reload --port 8000
```

Terminal 2:

```sh
npm install
npm run dev
```

Open the Vite URL (normally `http://localhost:5173`). Configure `VITE_API_URL` only when the API is not at `http://localhost:8000`; backend CORS origins use `FREIGHTIQ_CORS_ORIGINS`. See `.env.example`.

Live AIS vessel positions are optional. Create an AISStream API key and set `AISSTREAM_API_KEY` in the backend `.env` file. Keep it server-side; never expose it through a `VITE_` variable. Restart the API after setting it.

## Demo workflow

1. Open **New scenario** and enter a cargo requirement. The form starts with the SIH coal/Australia/Paradip example, 100,000 tonnes, with a December 2026 deadline.
2. Run analysis. The API persists the case, computes a moving-average freight baseline, filters vessel/port candidates by draft and deadline, ranks landed-cost/timing alternatives, and returns its assumptions.
3. Run the combined stress case (fuel +20%, freight +25%, port wait +3 days, FX +5%).
4. Review, modify, approve, or reject the result with an actor and reason. The API records the action in SQLite and exposes it on **Decision audit**.
5. Open **Map** for the interactive East Coast port map, live sea-state markers, and optional AIS position overlay. Open **Live shipping** for forecast tables, daily USD/INR reference rates, and published World Bank LPI scores.

## Checks

```sh
python3 -m pip install -r backend/requirements-dev.txt
python3 -m unittest backend.test_engine backend.test_api backend.test_live_providers -v
npm run lint
npm run build
```

The tests cover create -> analyze -> simulate -> modify -> approve -> audit, live-provider API contracts, mocked external feed parsing, AIS key handling, and invalid-input rejection against disposable SQLite databases.

## Current boundaries

The scenario freight forecast is an interpretable synthetic moving-average/trend baseline, not a trained or validated production ML model. Scenario cost and risk values are estimates from explicit demo assumptions, not quotes, calibrated probabilities, or realized savings. Live sea-state forecasts are model output, not navigational advice; World Bank LPI is periodic rather than a live port measure; ECB rates are reference rates, not executable FX quotes. Live AIS depends on provider coverage and an AISStream key. Live bulk freight fixtures/indices require a licensed provider and are not connected. The demo does not execute procurement or chartering. Local audit rows are not immutable, authentication/RBAC is not implemented, and SQLite is not the planned production PostgreSQL deployment. Production model registry/SHAP, OR-Tools optimizer, PDF reports, map visualization, LLM assistant, and production security controls remain open. See `IMPLEMENTATION_PLAN.md` and `ARCHITECTURE.md` for details.
