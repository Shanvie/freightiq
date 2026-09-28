# FreightIQ API (local demo)

Base URL: `http://localhost:8000`. Scenario freight, vessel, and port cost assumptions remain synthetic. `/api/live/*` endpoints fetch real external data and return provider/source metadata. JSON schemas are enforced with Pydantic; scenario date values must be valid ISO dates.

## Routes

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | API and data-mode status |
| GET | `/api/live/providers` | Provider availability, coverage, refresh and credential status |
| GET | `/api/live/shipping` | Combined marine conditions, World Bank LPI, reference FX, and AIS/rate configuration |
| GET | `/api/live/marine` | Hourly marine forecast at supported ports |
| GET | `/api/live/logistics` | Latest published World Bank country LPI observations |
| GET | `/api/live/fx` | Latest Frankfurter/ECB USD/INR reference rate |
| GET | `/api/live/ais?port={name}` | On-demand, bounded AISStream snapshot near a supported port |
| GET | `/api/overview` | Synthetic market series, freight baseline, scenario count |
| GET | `/api/scenarios` | Recent scenarios |
| POST | `/api/scenarios` | Validate and persist scenario inputs |
| GET | `/api/scenarios/{id}` | Scenario, analysis, and status |
| POST | `/api/scenarios/{id}/analyze` | Forecast, candidate ranking, landed cost, timing, risk |
| POST | `/api/scenarios/{id}/simulate` | Recalculate with bounded fuel/freight/FX/congestion shocks |
| POST | `/api/scenarios/{id}/decision` | Record approval, rejection, or modification with actor and reason |
| GET | `/api/audit?scenario_id={id}` | Recent audit events, optionally filtered by scenario |

Scenario input fields: `commodity`, `quantity_tonnes`, `origin`, `destination_port`, `delivery_deadline`, `max_draft_m`, and optional `budget_crore`. Decision actions require `action` (`approve`, `modify`, or `reject`), `actor`, and `reason`; `modify` additionally requires `modified_inputs`.

## Live data providers

- **Open-Meteo Marine API** provides hourly wave height, period, and direction forecasts for Paradip, Visakhapatnam, Chennai, Kamarajar, and Krishnapatnam. Responses include forecast hour, approximate coordinates, units, and source URL.
- **Frankfurter** supplies the dated USD/INR reference rate using ECB data.
- **World Bank API** supplies the latest non-null Logistics Performance Index observations for Australia, Brazil, India, Indonesia, and South Africa. This is a periodic national indicator, not a current port score.
- **AISStream** can provide vessel position reports server-side when `AISSTREAM_API_KEY` is configured. The API subscribes to a small box around one supported port for up to eight seconds; coverage and message availability are not guaranteed.
- Live bulk freight/fixture indices are **not connected**. They require a licensed provider subscription and must not be confused with the demo scenario rate assumptions.

Public-source responses are cached in-process (10 minutes for marine forecasts, 30 minutes for currency, and 24 hours for World Bank data). Provider failures are returned per source as `unavailable` with an error; they are not replaced by synthetic live-data fallbacks.

This local demo has no authentication or role authorization and must not be exposed to untrusted networks. Production API design requires an identity provider, permission checks, pagination, audit immutability, and stronger deployment controls.
