import { lazy, Suspense, useEffect, useState } from "react";
import type { FormEvent } from "react";
import LiveShipping from "./LiveShipping";
import "./FreightIQ.css";

const ShippingMap = lazy(() => import("./ShippingMap"));

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
type Point = {
  date: string;
  freight_usd_tonne: number;
  bdi: number;
  bunker_usd_tonne: number;
  commodity_usd_tonne: number;
  usd_inr: number;
  congestion_days: number;
};
type Inputs = {
  commodity: string;
  quantity_tonnes: number;
  origin: string;
  destination_port: string;
  delivery_deadline: string;
  max_draft_m: number;
  budget_crore: number | null;
};
type Risk = {
  score: number;
  label: string;
  market: number;
  port: number;
  delivery: number;
};
type Candidate = {
  vessel: string;
  port: string;
  capacity_tonnes: number;
  draft_m: number;
  trips: number;
  freight_usd_tonne: number;
  charter_cost_usd: number;
  fuel_cost_usd: number;
  delivery_days: number;
  cost_now_usd_tonne: number;
  risk: Risk;
};
type Analysis = {
  feasible: boolean;
  reason?: string;
  recommended?: {
    procurement: string;
    vessel: string;
    port: string;
    freight_usd_tonne: number;
    landed_cost_inr_tonne: number;
    total_cost_crore: number;
    baseline_cost_crore: number;
    estimated_savings_crore: number;
    delivery_days: number;
    risk: Risk;
    confidence: number;
    budget_satisfied: boolean;
  };
  forecast: {
    predicted_freight_usd_tonne: number;
    lower_bound: number;
    upper_bound: number;
    confidence: number;
    trend: string;
    method: string;
    historical_mae: number;
    model_version: string;
  };
  market: Point;
  history: Point[];
  candidates: Candidate[];
  strategies: { name: string; now_share: number; cost_usd_tonne: number }[];
  alternatives: {
    vessel: string;
    port: string;
    procurement: string;
    landed_cost_inr_tonne: number;
    delivery_days: number;
    risk: string;
  }[];
  reasons: string[];
  data_label: string;
};
type Scenario = {
  id: string;
  inputs: Inputs;
  analysis: Analysis | null;
  status: string;
  updated_at: string;
};
type Overview = {
  label: string;
  market: Point;
  history: Point[];
  freight_forecast: Analysis["forecast"];
  scenario_count: number;
};
type Audit = {
  id: number;
  scenario_id: string;
  actor: string;
  action: string;
  reason: string;
  created_at: string;
};
const defaults: Inputs = {
  commodity: "Coal",
  quantity_tonnes: 100000,
  origin: "Australia",
  destination_port: "Paradip",
  delivery_deadline: "2026-12-31",
  max_draft_m: 16,
  budget_crore: 180,
};
const nav = [
  "Overview",
  "Scenarios",
  "Market forecast",
  "Live shipping",
  "Map",
  "Fleet & ports",
  "Risk & stress",
  "Decision audit",
];

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}
const fmt = (value: number, digits = 0) =>
  new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
function points(data: Point[]) {
  if (!data.length) return "";
  const values = data.map((item) => item.freight_usd_tonne),
    low = Math.min(...values),
    high = Math.max(...values);
  return values
    .map(
      (value, index) =>
        `${8 + (index / Math.max(1, values.length - 1)) * 584},${118 - ((value - low) / Math.max(1, high - low)) * 98}`,
    )
    .join(" ");
}

export default function FreightIQ() {
  const [page, setPage] = useState("Overview"),
    [overview, setOverview] = useState<Overview | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]),
    [scenario, setScenario] = useState<Scenario | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null),
    [audit, setAudit] = useState<Audit[]>([]);
  const [inputs, setInputs] = useState<Inputs>(defaults),
    [stress, setStress] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [decision, setDecision] = useState<
    "approve" | "modify" | "reject" | null
  >(null);
  const [actor, setActor] = useState("Procurement Officer"),
    [reason, setReason] = useState(
      "Reviewed against current delivery and budget constraints.",
    );
  const [modifiedQuantity, setModifiedQuantity] = useState(100000);

  async function reload() {
    setError("");
    try {
      const [market, cases, events] = await Promise.all([
        api<Overview>("/api/overview"),
        api<Scenario[]>("/api/scenarios"),
        api<Audit[]>("/api/audit"),
      ]);
      setOverview(market);
      setScenarios(cases);
      setAudit(events);
      if (!scenario && cases.length) {
        setScenario(cases[0]);
        setInputs(cases[0].inputs);
        setAnalysis(cases[0].analysis);
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "FreightIQ API is unavailable.",
      );
    }
  }
  useEffect(() => {
    let active = true;
    void Promise.all([
      api<Overview>("/api/overview"),
      api<Scenario[]>("/api/scenarios"),
      api<Audit[]>("/api/audit"),
    ])
      .then(([market, cases, events]) => {
        if (!active) return;
        setOverview(market);
        setScenarios(cases);
        setAudit(events);
        if (cases.length) {
          setScenario(cases[0]);
          setInputs(cases[0].inputs);
          setAnalysis(cases[0].analysis);
        }
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "FreightIQ API is unavailable.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setStress(null);
    try {
      const created = await api<Scenario>("/api/scenarios", {
        method: "POST",
        body: JSON.stringify(inputs),
      });
      setScenario(created);
      const result = await api<Analysis>(
        `/api/scenarios/${created.id}/analyze`,
        { method: "POST" },
      );
      setAnalysis(result);
      setPage("Overview");
      setNotice("Scenario analysis completed and recorded.");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Analysis failed.");
    } finally {
      setBusy(false);
    }
  }
  async function selectScenario(id: string) {
    setBusy(true);
    try {
      const selected = await api<Scenario>(`/api/scenarios/${id}`);
      setScenario(selected);
      setInputs(selected.inputs);
      setAnalysis(selected.analysis);
      setStress(null);
      setNotice(`Loaded scenario ${id.slice(0, 8)}.`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to load scenario.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function runStress() {
    if (!scenario) return;
    setBusy(true);
    setError("");
    try {
      const response = await api<{ result: Analysis }>(
        `/api/scenarios/${scenario.id}/simulate`,
        {
          method: "POST",
          body: JSON.stringify({
            fuel_pct: 20,
            freight_pct: 25,
            congestion_days: 3,
            fx_pct: 5,
          }),
        },
      );
      setStress(response.result);
      setNotice(
        "Stress case: fuel +20%, freight +25%, port wait +3 days, FX +5%.",
      );
      setAudit(await api<Audit[]>(`/api/audit?scenario_id=${scenario.id}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Stress test failed.");
    } finally {
      setBusy(false);
    }
  }
  async function recordDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!scenario || !decision) return;
    setBusy(true);
    setError("");
    try {
      const body: Record<string, unknown> = { action: decision, actor, reason };
      if (decision === "modify")
        body.modified_inputs = { ...inputs, quantity_tonnes: modifiedQuantity };
      const saved = await api<Scenario>(
        `/api/scenarios/${scenario.id}/decision`,
        { method: "POST", body: JSON.stringify(body) },
      );
      setScenario(saved);
      setInputs(saved.inputs);
      setAnalysis(saved.analysis);
      setDecision(null);
      setNotice(`Decision ${decision} recorded in the audit history.`);
      await reload();
      setAudit(await api<Audit[]>(`/api/audit?scenario_id=${scenario.id}`));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to record decision.",
      );
    } finally {
      setBusy(false);
    }
  }

  const result = analysis?.feasible ? analysis.recommended : null;
  const series = analysis?.history.slice(-30) || overview?.history || [];
  const forecast = analysis?.forecast || overview?.freight_forecast;
  return (
    <div className="shell">
      <aside className="rail">
        <a
          className="brand"
          href="#home"
          onClick={(event) => {
            event.preventDefault();
            setPage("Overview");
          }}
        >
          <span className="brand-mark">F</span>
          <span>
            <b>
              FREIGHT<span>IQ</span>
            </b>
            <small>MARITIME INTELLIGENCE</small>
          </span>
        </a>
        <div className="rail-label">DECISION WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map((item, index) => (
            <button
              key={item}
              className={`nav-link ${page === item ? "selected" : ""}`}
              onClick={() => setPage(item)}
            >
              <small>0{index + 1}</small>
              {item}
            </button>
          ))}
        </nav>
        <div className="rail-foot">
          <div className="connected">
            <i /> API CONNECTED <span>DEMO</span>
          </div>
          <div className="profile">
            <b>Procurement desk</b>
            <small>Local demonstration</small>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="top">
          <span>
            FREIGHTIQ <i>/</i> {page.toUpperCase()}
          </span>
          <div>
            <b>{page === "Live shipping" || page === "Map" ? "LIVE SOURCED DATA" : "DEMO MODE · SYNTHETIC ESTIMATES"}</b>
            <time>{overview?.market.date || "—"}</time>
          </div>
        </header>
        <div className="content">
          {(error || notice) && (
            <div className={`message ${error ? "error" : ""}`} role="status">
              {error || notice}
              {error && (
                <button onClick={() => void reload()}>Retry connection</button>
              )}
            </div>
          )}
          <div className="heading">
            <div>
              <small>EAST COAST PROCUREMENT · CONTROL ROOM</small>
              <h1>{page === "Overview" ? "Decision overview" : page}</h1>
              <p>
                Market signals, voyage economics and procurement decisions in
                one auditable view.
              </p>
            </div>
            <button
              className="button primary new"
              onClick={() => {
                setInputs(defaults);
                setPage("Scenarios");
              }}
            >
              <span>＋</span> New scenario
            </button>
          </div>
          <div className="data-notice">
            <b>{page === "Live shipping" || page === "Map" ? "LIVE FEEDS" : "DEMO DATA"}</b>
            <span>{page === "Live shipping" || page === "Map"
              ? "Open marine forecasts, ECB reference FX, and World Bank logistics data are attributed on this page."
              : "Scenario freight, vessel, and port estimates remain synthetic. Open Live shipping for attributed external feeds."}</span>
            {page !== "Live shipping" && page !== "Map" && (
              <button onClick={() => void reload()}>Refresh ↻</button>
            )}
          </div>

          {page === "Live shipping" ? (
            <LiveShipping />
          ) : page === "Map" ? (
            <Suspense fallback={<div className="panel map-loading-panel">Loading interactive map…</div>}>
              <ShippingMap />
            </Suspense>
          ) : page === "Scenarios" ? (
            <div className="scenario-grid">
              <section className="panel">
                <div className="panel-title">
                  <div>
                    <small>NEW DECISION CASE</small>
                    <h2>Bulk cargo requirement</h2>
                  </div>
                  <span>01 / 01</span>
                </div>
                <form className="form-grid" onSubmit={analyze}>
                  <label>
                    Commodity
                    <select
                      value={inputs.commodity}
                      onChange={(e) =>
                        setInputs({ ...inputs, commodity: e.target.value })
                      }
                    >
                      <option>Coal</option>
                      <option>Iron ore</option>
                      <option>Grain</option>
                      <option>Fertilizer</option>
                      <option>Other bulk commodity</option>
                    </select>
                  </label>
                  <label>
                    Required quantity <small>tonnes</small>
                    <input
                      type="number"
                      min="1000"
                      step="1000"
                      required
                      value={inputs.quantity_tonnes}
                      onChange={(e) =>
                        setInputs({
                          ...inputs,
                          quantity_tonnes: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Origin country
                    <select
                      value={inputs.origin}
                      onChange={(e) =>
                        setInputs({ ...inputs, origin: e.target.value })
                      }
                    >
                      <option>Australia</option>
                      <option>Indonesia</option>
                      <option>South Africa</option>
                      <option>Brazil</option>
                    </select>
                  </label>
                  <label>
                    Target discharge port
                    <select
                      value={inputs.destination_port}
                      onChange={(e) =>
                        setInputs({
                          ...inputs,
                          destination_port: e.target.value,
                        })
                      }
                    >
                      <option>Any East Coast port</option>
                      <option>Paradip</option>
                      <option>Visakhapatnam</option>
                      <option>Chennai</option>
                      <option>Kamarajar</option>
                      <option>Krishnapatnam</option>
                    </select>
                  </label>
                  <label>
                    Delivery deadline
                    <input
                      type="date"
                      required
                      value={inputs.delivery_deadline}
                      onChange={(e) =>
                        setInputs({
                          ...inputs,
                          delivery_deadline: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Maximum vessel draft <small>metres</small>
                    <input
                      type="number"
                      min="1"
                      max="30"
                      step="0.5"
                      value={inputs.max_draft_m}
                      onChange={(e) =>
                        setInputs({
                          ...inputs,
                          max_draft_m: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Budget ceiling <small>₹ crore</small>
                    <input
                      type="number"
                      min="1"
                      value={inputs.budget_crore || ""}
                      onChange={(e) =>
                        setInputs({
                          ...inputs,
                          budget_crore: e.target.value
                            ? Number(e.target.value)
                            : null,
                        })
                      }
                    />
                  </label>
                  <p className="fine-print">
                    Analysis tests capacity, draft, delivery time and budget
                    against demo assumptions.
                  </p>
                  <button className="button primary submit" disabled={busy}>
                    {busy ? "Calculating…" : "Run intelligence analysis"}{" "}
                    <span>→</span>
                  </button>
                </form>
              </section>
              <section className="panel">
                <div className="panel-title">
                  <div>
                    <small>WORKING REGISTER</small>
                    <h2>Saved scenarios</h2>
                  </div>
                  <span>{scenarios.length} CASES</span>
                </div>
                {scenarios.length ? (
                  scenarios.map((item) => (
                    <button
                      className={`scenario-row ${scenario?.id === item.id ? "current" : ""}`}
                      key={item.id}
                      onClick={() => void selectScenario(item.id)}
                    >
                      <b>{item.inputs.commodity.slice(0, 1)}</b>
                      <span>
                        <strong>
                          {item.inputs.commodity} ·{" "}
                          {fmt(item.inputs.quantity_tonnes)} t
                        </strong>
                        <small>
                          {item.inputs.origin} → {item.inputs.destination_port}
                        </small>
                      </span>
                      <i>{item.status}</i>
                    </button>
                  ))
                ) : (
                  <div className="empty">
                    <b>No saved scenario yet</b>
                    <p>
                      Run an analysis to create the first auditable decision
                      case.
                    </p>
                  </div>
                )}
              </section>
            </div>
          ) : page === "Decision audit" ? (
            <section className="panel">
              <div className="panel-title">
                <div>
                  <small>TRACEABILITY REGISTER</small>
                  <h2>Decision history</h2>
                </div>
                <span>{audit.length} EVENTS</span>
              </div>
              {audit.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Event</th>
                        <th>Actor</th>
                        <th>Scenario</th>
                        <th>Reason</th>
                        <th>Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.map((event) => (
                        <tr key={event.id}>
                          <td>{event.action}</td>
                          <td>{event.actor}</td>
                          <td>{event.scenario_id.slice(0, 8)}</td>
                          <td>{event.reason}</td>
                          <td>{new Date(event.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty">
                  No events recorded. Create a scenario to begin the audit
                  history.
                </div>
              )}
            </section>
          ) : page === "Fleet & ports" ? (
            <section className="panel">
              <div className="panel-title">
                <div>
                  <small>CONSTRAINT-FILTERED CANDIDATES</small>
                  <h2>Vessel & port economics</h2>
                </div>
                <span>{analysis?.candidates.length || 0} FEASIBLE</span>
              </div>
              {analysis?.candidates.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Vessel</th>
                        <th>Port</th>
                        <th>Draft</th>
                        <th>Voyages</th>
                        <th>Freight estimate</th>
                        <th>Delivery</th>
                        <th>Risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.candidates.map((item) => (
                        <tr key={`${item.vessel}-${item.port}`}>
                          <td>
                            {item.vessel}
                            <small>
                              {fmt(item.capacity_tonnes)} t capacity
                            </small>
                          </td>
                          <td>{item.port}</td>
                          <td>{item.draft_m} m</td>
                          <td>{item.trips}</td>
                          <td>${item.freight_usd_tonne.toFixed(2)} / t</td>
                          <td>{item.delivery_days} days</td>
                          <td>
                            {item.risk.label} · {item.risk.score}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty">
                  <b>Run a scenario to compare candidates</b>
                  <p>
                    Capacity, draft, voyage economics and deadline feasibility
                    are checked.
                  </p>
                  <button
                    className="button outline"
                    onClick={() => setPage("Scenarios")}
                  >
                    Build scenario
                  </button>
                </div>
              )}
            </section>
          ) : page === "Risk & stress" ? (
            <div className="two-col">
              <section className="panel">
                <div className="panel-title">
                  <div>
                    <small>SCENARIO RISK PROFILE</small>
                    <h2>Operational exposure</h2>
                  </div>
                  <b className="risk-chip">
                    {result
                      ? `${result.risk.label} · ${result.risk.score}`
                      : "No analysis"}
                  </b>
                </div>
                {result ? (
                  <div className="risk-rows">
                    {[
                      ["Market", result.risk.market],
                      ["Port", result.risk.port],
                      ["Delivery", result.risk.delivery],
                    ].map(([label, value]) => (
                      <div key={label as string}>
                        <span>{label}</span>
                        <i>
                          <b style={{ width: `${value}%` }} />
                        </i>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty">
                    Create a scenario to calculate its risk index.
                  </div>
                )}
                <p className="fine-print">
                  Deterministic indices from volatility, port-wait assumptions
                  and delivery slack; these are not event probabilities.
                </p>
                <button
                  className="button primary"
                  disabled={!analysis || busy}
                  onClick={() => void runStress()}
                >
                  {busy ? "Recalculating…" : "Run stress test →"}
                </button>
              </section>
              <section className="panel">
                <small className="overline">PREDEFINED STRESS CASE</small>
                <h2>Combined disruption</h2>
                <div className="shock-list">
                  {[
                    ["Fuel price", "+20%"],
                    ["Freight market", "+25%"],
                    ["Port congestion", "+3 days"],
                    ["USD / INR", "+5%"],
                  ].map(([name, value]) => (
                    <div key={name}>
                      <span>{name}</span>
                      <b>{value}</b>
                    </div>
                  ))}
                </div>
                {stress?.recommended ? (
                  <div className="stress-result">
                    <small>RECALCULATED STRATEGY</small>
                    <b>
                      {stress.recommended.vessel} · {stress.recommended.port}
                    </b>
                    <span>
                      ₹{fmt(stress.recommended.landed_cost_inr_tonne)} / tonne
                      vs ₹{fmt(result?.landed_cost_inr_tonne || 0)} baseline
                    </span>
                    <p>
                      {stress.recommended.vessel === result?.vessel &&
                      stress.recommended.port === result.port
                        ? "Vessel and port remain unchanged under stress."
                        : "Ranked vessel or port changes under stress."}
                    </p>
                  </div>
                ) : (
                  <div className="empty">
                    Run the stress case to compare recommendations.
                  </div>
                )}
              </section>
            </div>
          ) : page === "Market forecast" ? (
            <div className="two-col forecast-view">
              <section className="panel">
                <div className="panel-title">
                  <div>
                    <small>TIME-AWARE BASELINE</small>
                    <h2>Freight forecast</h2>
                  </div>
                  <span>{forecast?.model_version || "NO MODEL"}</span>
                </div>
                <div className="forecast-numbers">
                  <div>
                    <small>30-DAY OUTLOOK</small>
                    <b>
                      ${forecast?.predicted_freight_usd_tonne.toFixed(2) || "—"}{" "}
                      / t
                    </b>
                  </div>
                  <div>
                    <small>INTERVAL</small>
                    <b>
                      ${forecast?.lower_bound.toFixed(2) || "—"} – $
                      {forecast?.upper_bound.toFixed(2) || "—"}
                    </b>
                  </div>
                  <div>
                    <small>HISTORICAL MAE</small>
                    <b>${forecast?.historical_mae.toFixed(2) || "—"} / t</b>
                  </div>
                </div>
                <Chart data={series} />
                <p className="fine-print">
                  {forecast?.method}. Interval uses recent variability, not a
                  calibrated production prediction interval.
                </p>
              </section>
              <MarketPanel overview={overview} />
            </div>
          ) : (
            <>
              <div className="metrics">
                {[
                  [
                    "Freight index",
                    overview
                      ? `$${overview.market.freight_usd_tonne.toFixed(2)}`
                      : "—",
                    "USD / tonne",
                    overview
                      ? `${overview.freight_forecast.trend} · outlook`
                      : "Waiting for API",
                  ],
                  [
                    "Bunker marker",
                    overview
                      ? `$${fmt(overview.market.bunker_usd_tonne)}`
                      : "—",
                    "USD / tonne",
                    overview
                      ? `${overview.market.congestion_days}d port wait index`
                      : "Synthetic source",
                  ],
                  [
                    "Coal marker",
                    overview
                      ? `$${overview.market.commodity_usd_tonne.toFixed(2)}`
                      : "—",
                    "USD / tonne",
                    overview
                      ? `USD / INR ${overview.market.usd_inr.toFixed(2)}`
                      : "Synthetic source",
                  ],
                  [
                    "Scenarios",
                    `${scenarios.length}`,
                    "persisted cases",
                    scenario
                      ? `Current · ${scenario.status}`
                      : "No active case",
                  ],
                ].map(([name, value, unit, note]) => (
                  <article className="metric" key={name}>
                    <small>
                      {name}
                      <i>↗</i>
                    </small>
                    <strong>
                      {value}
                      <em>{unit}</em>
                    </strong>
                    <span>{note}</span>
                  </article>
                ))}
              </div>
              <div className="dashboard-grid">
                <section className="panel chart-card">
                  <div className="panel-title">
                    <div>
                      <small>DRY BULK MARKET · SYNTHETIC SERIES</small>
                      <h2>Freight signal</h2>
                    </div>
                    <span className="chart-key">
                      <i /> FREIGHT / T
                    </span>
                  </div>
                  <div className="chart-summary">
                    <b>
                      ${forecast?.predicted_freight_usd_tonne.toFixed(2) || "—"}
                    </b>
                    <span>30-day outlook / tonne</span>
                    <small>{forecast?.confidence || "—"}% confidence</small>
                  </div>
                  <Chart data={series} />
                  <div className="axis">
                    <span>{series[0]?.date || "—"}</span>
                    <span>
                      {series[Math.floor(series.length / 2)]?.date || ""}
                    </span>
                    <span>{series[series.length - 1]?.date || "—"}</span>
                  </div>
                  <p className="fine-print">
                    7-day moving average with 30-day trend extension ·
                    Historical MAE ${forecast?.historical_mae.toFixed(2) || "—"}{" "}
                    / tonne
                  </p>
                </section>
                <section className="panel recommend">
                  <div className="panel-title">
                    <div>
                      <small>DECISION ENGINE</small>
                      <h2>
                        {result
                          ? "Recommended strategy"
                          : "Recommendation pending"}
                      </h2>
                    </div>
                    <span className="live">
                      <i />
                      {analysis ? "CALCULATED" : "AWAITING INPUT"}
                    </span>
                  </div>
                  {result ? (
                    <>
                      <h3>{result.procurement}</h3>
                      <div className="route">
                        <span>
                          <small>VESSEL</small>
                          <b>{result.vessel}</b>
                        </span>
                        <i>→</i>
                        <span>
                          <small>DISCHARGE</small>
                          <b>{result.port}</b>
                        </span>
                      </div>
                      <div className="landed">
                        <small>ESTIMATED LANDED COST</small>
                        <b>
                          ₹{fmt(result.landed_cost_inr_tonne)}
                          <i> / tonne</i>
                        </b>
                        <span>
                          ₹{result.total_cost_crore.toFixed(2)} crore total ·
                          model-based estimate
                        </span>
                      </div>
                      <div className="rec-metrics">
                        <div>
                          <small>EST. SAVINGS</small>
                          <b>₹{result.estimated_savings_crore.toFixed(2)} Cr</b>
                        </div>
                        <div>
                          <small>DELIVERY</small>
                          <b>{result.delivery_days} days</b>
                        </div>
                        <div>
                          <small>RISK</small>
                          <b>
                            {result.risk.label} · {result.risk.score}
                          </b>
                        </div>
                      </div>
                      {!result.budget_satisfied && (
                        <p className="budget-alert">
                          Budget ceiling exceeded; officer review required.
                        </p>
                      )}
                      <div className="confidence">
                        <span>Forecast confidence</span>
                        <i>
                          <b style={{ width: `${result.confidence}%` }} />
                        </i>
                        <strong>{result.confidence}%</strong>
                      </div>
                      <div className="action-row">
                        <button
                          className="button outline"
                          onClick={() => setPage("Risk & stress")}
                        >
                          Stress test
                        </button>
                        <button
                          className="button primary"
                          onClick={() => {
                            setReason(
                              "Reviewed against current delivery and budget constraints.",
                            );
                            setModifiedQuantity(inputs.quantity_tonnes);
                            setDecision("approve");
                          }}
                        >
                          Review decision →
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="empty">
                      <b>Run a scenario to calculate a recommendation</b>
                      <p>
                        {analysis?.reason ||
                          "Cost, vessel, port, procurement timing and risk are calculated from provider inputs."}
                      </p>
                      <button
                        className="button outline"
                        onClick={() => setPage("Scenarios")}
                      >
                        Build scenario
                      </button>
                    </div>
                  )}
                </section>
              </div>
              {analysis?.feasible && analysis.alternatives?.length > 0 && (
                <section className="panel alternatives-panel">
                  <div className="panel-title">
                    <div>
                      <small>JOINTLY RANKED · BUDGET AND DELIVERY FEASIBLE</small>
                      <h2>Alternative strategies</h2>
                    </div>
                    <span>TOP {analysis.alternatives.length}</span>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Procurement</th>
                          <th>Vessel</th>
                          <th>Port</th>
                          <th>Landed cost</th>
                          <th>Delivery</th>
                          <th>Risk</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.alternatives.map((option, index) => (
                          <tr key={`${option.procurement}-${option.vessel}-${option.port}-${index}`}>
                            <td>{option.procurement}</td>
                            <td>{option.vessel}</td>
                            <td>{option.port}</td>
                            <td>₹{fmt(option.landed_cost_inr_tonne)} / t</td>
                            <td>{option.delivery_days} days</td>
                            <td>{option.risk}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="fine-print">
                    Ranked across vessel, port, and procurement timing by estimated landed cost plus a risk penalty. All figures are synthetic estimates.
                  </p>
                </section>
              )}
              <div className="lower-grid">
                <section className="panel">
                  <div className="panel-title">
                    <div>
                      <small>DECISION TRACE</small>
                      <h2>Analysis sequence</h2>
                    </div>
                    <span>ENGINE 1.0</span>
                  </div>
                  <div className="pipeline">
                    {[
                      "Market data",
                      "Freight outlook",
                      "Vessel & port",
                      "Landed cost",
                      "Human review",
                    ].map((step, index) => (
                      <div key={step}>
                        <i className={analysis && index < 4 ? "done" : ""}>
                          {analysis && index < 4 ? "✓" : `0${index + 1}`}
                        </i>
                        <b>{step}</b>
                      </div>
                    ))}
                  </div>
                  <p className="fine-print">
                    {analysis
                      ? "Recommendation calculated from scenario inputs and engine outputs."
                      : "Submit a scenario to execute the decision pipeline."}
                  </p>
                </section>
                <section className="panel">
                  <div className="panel-title">
                    <div>
                      <small>ACTIVE CASE</small>
                      <h2>
                        {scenario
                          ? `${scenario.inputs.commodity} procurement`
                          : "No active scenario"}
                      </h2>
                    </div>
                    <span>{scenario?.status || "IDLE"}</span>
                  </div>
                  {scenario ? (
                    <div className="case-grid">
                      <b>
                        QUANTITY
                        <strong>
                          {fmt(scenario.inputs.quantity_tonnes)} tonnes
                        </strong>
                      </b>
                      <b>
                        ORIGIN<strong>{scenario.inputs.origin}</strong>
                      </b>
                      <b>
                        DEADLINE
                        <strong>{scenario.inputs.delivery_deadline}</strong>
                      </b>
                      <b>
                        CASE ID<strong>{scenario.id.slice(0, 13)}</strong>
                      </b>
                    </div>
                  ) : (
                    <button
                      className="quiet"
                      onClick={() => setPage("Scenarios")}
                    >
                      Create first case →
                    </button>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
      </main>
      {decision && (
        <div
          className="modal-bg"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDecision(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="decision-heading"
          >
            <div className="panel-title">
              <div>
                <small>HUMAN REVIEW · {decision.toUpperCase()}</small>
                <h2 id="decision-heading">Record decision</h2>
              </div>
              <button
                className="close"
                aria-label="Close dialog"
                onClick={() => setDecision(null)}
              >
                ×
              </button>
            </div>
            <form onSubmit={recordDecision}>
              <label>
                Officer / reviewer
                <input
                  required
                  value={actor}
                  onChange={(e) => setActor(e.target.value)}
                />
              </label>
              {decision === "modify" && (
                <label>
                  Revised quantity
                  <input
                    type="number"
                    min="1000"
                    step="1000"
                    value={modifiedQuantity}
                    onChange={(e) =>
                      setModifiedQuantity(Number(e.target.value))
                    }
                  />
                </label>
              )}
              <label>
                Decision rationale
                <textarea
                  minLength={5}
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <div className="modal-actions">
                <button
                  type="button"
                  className="button outline"
                  onClick={() => setDecision(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="button outline"
                  onClick={() => setDecision("modify")}
                >
                  Modify
                </button>
                <button
                  type="button"
                  className="button outline"
                  onClick={() => setDecision("reject")}
                >
                  Reject
                </button>
                <button className="button primary" disabled={busy}>
                  {busy ? "Recording…" : `Confirm ${decision}`}
                </button>
              </div>
              <p className="fine-print">
                FreightIQ records the human decision; it does not execute
                procurement or chartering.
              </p>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function Chart({ data }: { data: Point[] }) {
  return (
    <div className="chart">
      <svg
        viewBox="0 0 600 132"
        role="img"
        aria-label="Synthetic freight history"
        preserveAspectRatio="none"
      >
        <path className="gridline" d="M0 20H600M0 68H600M0 116H600" />
        <polyline points={points(data)} />
      </svg>
    </div>
  );
}
function MarketPanel({ overview }: { overview: Overview | null }) {
  return (
    <section className="panel">
      <small className="overline">OBSERVED INPUTS</small>
      <h2>Market context</h2>
      {overview && (
        <div className="market-list">
          {[
            ["Baltic Dry Index", fmt(overview.market.bdi)],
            ["Bunker marker", `$${fmt(overview.market.bunker_usd_tonne)}/t`],
            [
              "Commodity marker",
              `$${overview.market.commodity_usd_tonne.toFixed(2)}/t`,
            ],
            ["USD / INR", overview.market.usd_inr.toFixed(2)],
            ["Port wait index", `${overview.market.congestion_days} days`],
          ].map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <b>{value}</b>
            </div>
          ))}
        </div>
      )}
      <p className="fine-print">
        Fixed-seed synthetic observations; these are not live quotes.
      </p>
    </section>
  );
}
