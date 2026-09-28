# FreightIQ Implementation Plan

Status describes checked-in and verified behavior; it does not imply completion of the full product brief. Synthetic scenario assumptions and sourced live feeds are identified separately.

## Phase 0 - Inspect

- [x] Confirm empty workspace and available runtimes.
- [x] Confirm Docker is unavailable.

## Phase 1 - Architecture

- [x] Record actual boundaries and production gaps in `ARCHITECTURE.md`.
- [x] Keep a truthful phased status ledger here.

## Phase 2 - Foundation

- [x] Bootstrap React + TypeScript with Vite.
- [x] Add FastAPI API and SQLite local persistence.
- [x] Add API configuration through environment variables.
- [!] PostgreSQL, Alembic migrations, and Docker deployment are not implemented or verified.

## Phase 3 - Data platform

- [x] Add deterministic synthetic history and explicit demo labeling.
- [x] Add live Open-Meteo marine forecasts for supported East Coast port coordinates.
- [x] Add Frankfurter/ECB USD-INR reference-rate and World Bank LPI adapters with source and retrieval metadata.
- [x] Add optional server-side AISStream snapshots with bounded port boxes and a server-only API key.
- [x] Expose provider catalog, live data APIs, and a source-attributed live shipping workspace.
- [x] Add an interactive OpenStreetMap-backed India east coast map with live port condition markers, selectable layers, and optional AIS vessel markers.
- [!] Licensed bulk freight/fixture and bunker feeds, durable ingestion, quality monitoring, formal SLAs, and provider-specific credentials remain.

## Phase 4 - Forecasting

- [x] Add a chronological moving-average/trend baseline, simple historical MAE, interval, and confidence heuristic.
- [!] No trained ML comparisons, temporal cross-validation, model registry, or SHAP.

## Phase 5 - Optimization

- [x] Calculate candidate vessel/port voyage economics and filter draft/deadline feasibility.
- [x] Jointly rank feasible vessel, port, and procurement timing combinations; reject plans exceeding the budget.
- [x] Compare procurement timing strategies and deterministic market stress.
- [~] Current ranker is deterministic Python logic, not OR-Tools/PuLP; cost assumptions still need domain validation.

## Phase 6 - Frontend

- [x] Connect dashboard, scenarios, market, fleet/port, stress, human decision, and audit views to the API.
- [x] Add loading, empty, error, and responsive states.
- [!] These are SPA views, not all requested deep-link routes; browser/device accessibility review remains.

## Phase 7 - Decision intelligence

- [x] Run scenario analysis and explicit stress simulations through the API.
- [~] Explanations are deterministic templates; no LLM assistant or live continuous re-optimization.

## Phase 8 - Governance

- [x] Record approvals, rejections, modifications, actor, reason, timestamp, and scenario events in SQLite.
- [!] No authentication/RBAC; local audit rows are mutable and not tamper-evident. PDF report generation is not implemented.

## Phase 9 - Verification and hardening

- [x] Nine decision-engine unit tests, five live-provider adapter tests, and five API integration tests pass.
- [x] Frontend TypeScript/Vite production build passes.
- [x] HTTP create -> analyze -> simulate -> modify -> approve -> audit flow is covered against disposable databases.
- [x] Browser smoke check confirms the Live shipping page renders live provider values and AIS key guidance.
- [!] Docker, security/dependency scans, database migration tests, and browser accessibility/device checks remain.

## Not yet implemented

Licensed live bulk freight/fixture and bunker providers, PostgreSQL production storage and migrations, JWT/institutional RBAC, data-quality engine, trained ML and registry, OR-Tools/PuLP, full policy constraints, immutable audit, PDF reports, maritime map, operations/shipments, alerts, LLM tool assistant, carbon reporting, CI/CD, background jobs, production security hardening, and complete deep-link routing.
