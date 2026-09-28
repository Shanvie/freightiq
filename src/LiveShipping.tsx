import { useEffect, useState } from "react";
import { API_BASE_URL } from "./api-config";
import "./LiveShipping.css";

const API = API_BASE_URL;

type Provider = {
  id: string;
  name: string;
  category: string;
  status: string;
  refresh: string;
  source_url: string | null;
};
type PortCondition = {
  port?: string;
  name?: string;
  status: string;
  error?: string;
  forecast_at?: string;
  wave_height_m?: number;
  wave_period_s?: number;
  sea_state?: string;
  source_url?: string;
};
type CountryScore = {
  country?: string;
  iso3?: string;
  name?: string;
  status: string;
  error?: string;
  score?: number | null;
  year?: string | null;
  source_url?: string;
};
type Snapshot = {
  generated_at: string;
  data_label: string;
  marine_conditions: PortCondition[];
  country_logistics: CountryScore[];
  currency: {
    status: string;
    error?: string;
    rate?: number;
    date?: string;
    source?: string;
    source_url?: string;
  };
  ais: {
    status: string;
    provider: string;
    source_url: string;
    message: string;
  };
  freight_rates: { status: string; message: string };
};
type Ship = {
  mmsi: string | number;
  name: string;
  latitude: number;
  longitude: number;
  speed_knots: number | null;
  course_deg: number | null;
  navigation_status: number | null;
};
type AisResult = {
  status: string;
  port: string;
  ships: Ship[];
  message: string;
  fetched_at?: string;
};
type ProviderResponse = { providers: Provider[] };

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function dateTime(value?: string) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function LiveShipping() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [ships, setShips] = useState<AisResult | null>(null);
  const [port, setPort] = useState("Paradip");
  const [busy, setBusy] = useState(false);
  const [aisBusy, setAisBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const [live, catalog] = await Promise.all([
        get<Snapshot>("/api/live/shipping"),
        get<ProviderResponse>("/api/live/providers"),
      ]);
      setSnapshot(live);
      setProviders(catalog.providers);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load live data.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      get<Snapshot>("/api/live/shipping"),
      get<ProviderResponse>("/api/live/providers"),
    ])
      .then(([live, catalog]) => {
        if (!active) return;
        setSnapshot(live);
        setProviders(catalog.providers);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "Unable to load live data.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  async function loadShips() {
    setAisBusy(true);
    setError("");
    try {
      setShips(await get<AisResult>(`/api/live/ais?port=${encodeURIComponent(port)}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AIS request failed.");
    } finally {
      setAisBusy(false);
    }
  }

  return (
    <div className="live-shipping">
      <div className="live-heading">
        <div>
          <span className="live-eyebrow">SOURCE-ATTRIBUTED · LIVE CONNECTORS</span>
          <h2>Shipping data exchange</h2>
          <p>
            Current marine conditions and reference data from external sources.
            Public feeds are separate from freight estimates.
          </p>
        </div>
        <button className="live-refresh" disabled={busy} onClick={() => void refresh()}>
          {busy ? "Refreshing…" : "Refresh feeds ↻"}
        </button>
      </div>

      {error && <div className="live-error" role="alert">{error}</div>}

      <div className="live-source-grid">
        {providers.map((provider) => (
          <article className="live-source-card" key={provider.id}>
            <div className="live-source-top">
              <span className={`source-indicator ${provider.status}`} />
              <span className={`source-status ${provider.status}`}>
                {provider.status.replaceAll("_", " ")}
              </span>
            </div>
            <h3>{provider.name}</h3>
            <p>{provider.category}</p>
            <small>{provider.refresh}</small>
            {provider.source_url && (
              <a href={provider.source_url} target="_blank" rel="noreferrer">
                Source details ↗
              </a>
            )}
          </article>
        ))}
      </div>

      <section className="live-panel">
        <div className="live-panel-header">
          <div>
            <span className="live-eyebrow">OPEN-METEO MARINE · HOURLY FORECAST</span>
            <h3>East coast sea conditions</h3>
          </div>
          <span className="live-updated">
            Retrieved {dateTime(snapshot?.generated_at)}
          </span>
        </div>
        <div className="live-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Port</th>
                <th>Sea state</th>
                <th>Wave height</th>
                <th>Wave period</th>
                <th>Forecast hour</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {(snapshot?.marine_conditions || []).map((condition) => (
                <tr key={condition.port || condition.name}>
                  <td>{condition.port || condition.name}</td>
                  {condition.status === "live" ? (
                    <>
                      <td><span className={`sea-state ${condition.sea_state}`}>{condition.sea_state}</span></td>
                      <td>{condition.wave_height_m?.toFixed(2)} m</td>
                      <td>{condition.wave_period_s?.toFixed(1)} s</td>
                      <td>{condition.forecast_at} UTC</td>
                      <td><a href={condition.source_url} target="_blank" rel="noreferrer">Open-Meteo ↗</a></td>
                    </>
                  ) : (
                    <td colSpan={5} className="live-cell-error">
                      {condition.error || "Provider did not return data"}
                    </td>
                  )}
                </tr>
              ))}
              {!snapshot && (
                <tr><td colSpan={6} className="live-empty">Loading marine forecasts…</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="live-footnote">
          Forecast values describe modeled sea conditions at approximate port coordinates; they are not berth clearance or navigational advice.
        </p>
      </section>

      <div className="live-lower-grid">
        <section className="live-panel">
          <div className="live-panel-header">
            <div>
              <span className="live-eyebrow">FRANKFURTER · ECB REFERENCE</span>
              <h3>USD / INR</h3>
            </div>
            <a href={snapshot?.currency.source_url} target="_blank" rel="noreferrer">Provider ↗</a>
          </div>
          {snapshot?.currency.status === "live" ? (
            <div className="live-fx">
              <strong>₹{snapshot.currency.rate?.toFixed(2)}</strong>
              <span>per USD</span>
              <small>Rate date: {snapshot.currency.date}. Not an executable market quote.</small>
            </div>
          ) : (
            <div className="live-empty">
              {snapshot?.currency.error || "Loading reference rate…"}
            </div>
          )}
        </section>

        <section className="live-panel">
          <div className="live-panel-header">
            <div>
              <span className="live-eyebrow">WORLD BANK · PUBLISHED INDICATOR</span>
              <h3>Logistics performance index</h3>
            </div>
            <a href="https://data.worldbank.org/indicator/LP.LPI.OVRL.XQ" target="_blank" rel="noreferrer">Provider ↗</a>
          </div>
          <div className="lpi-grid">
            {(snapshot?.country_logistics || []).map((item) => (
              <div key={item.country || item.iso3}>
                <span>{item.country || item.name}</span>
                <b>{item.score == null ? "—" : item.score.toFixed(2)}</b>
                <small>{item.year ? `Year ${item.year}` : item.error || "No observation"}</small>
              </div>
            ))}
          </div>
          <p className="live-footnote">
            LPI is a periodic country-level benchmark, not a live port-performance measure.
          </p>
        </section>
      </div>

      <section className="live-panel ais-panel">
        <div className="live-panel-header">
          <div>
            <span className="live-eyebrow">AISSTREAM · OPTIONAL AUTHENTICATED FEED</span>
            <h3>Nearby vessel positions</h3>
          </div>
          <div className="ais-controls">
            <select value={port} onChange={(event) => setPort(event.target.value)}>
              {["Paradip", "Visakhapatnam", "Chennai", "Kamarajar", "Krishnapatnam"].map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
            <button className="live-refresh" disabled={aisBusy} onClick={() => void loadShips()}>
              {aisBusy ? "Listening for AIS…" : "Get live positions"}
            </button>
          </div>
        </div>
        <p className="live-footnote">
          Vessel location is retrieved server-side from AISStream for an 8-second snapshot near the selected port. Data availability depends on provider coverage and your AISStream account.
        </p>
        {ships && (
          <>
            <div className="ais-result-note">{ships.message}</div>
            {ships.ships.length > 0 && (
              <div className="live-table-wrap">
                <table>
                  <thead>
                    <tr><th>Vessel</th><th>MMSI</th><th>Speed</th><th>Course</th><th>Coordinates</th></tr>
                  </thead>
                  <tbody>
                    {ships.ships.map((ship) => (
                      <tr key={ship.mmsi}>
                        <td>{ship.name}</td>
                        <td>{ship.mmsi}</td>
                        <td>{ship.speed_knots == null ? "—" : `${ship.speed_knots} kn`}</td>
                        <td>{ship.course_deg == null ? "—" : `${ship.course_deg}°`}</td>
                        <td>{ship.latitude.toFixed(4)}, {ship.longitude.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <aside className="live-caveat">
        <b>Freight quotes are not connected.</b> Bulk spot rates, Baltic/Drewry indices, bunker prices and fixture data require licensed provider access. Current scenario freight estimates remain demo assumptions and must not be treated as a live quote.
      </aside>
    </div>
  );
}
