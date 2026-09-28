import { useEffect, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import { API_BASE_URL } from "./api-config";
import "leaflet/dist/leaflet.css";
import "./ShippingMap.css";

const API = API_BASE_URL;

type PortCondition = {
  port: string;
  latitude: number;
  longitude: number;
  status: string;
  error?: string;
  forecast_at?: string;
  wave_height_m?: number;
  wave_period_s?: number;
  sea_state?: string;
  source_url?: string;
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
type MarineResponse = { ports: PortCondition[] };
type AisResult = { status: string; ships: Ship[]; message: string };
type Layer = "both" | "ports" | "vessels";

const portIcon = {
  color: "#26715d",
  fillColor: "#5ba184",
};
const shipIcon = {
  color: "#a15e23",
  fillColor: "#e4a34e",
};

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function FitPorts({ ports }: { ports: PortCondition[] }) {
  const map = useMap();
  useEffect(() => {
    const valid = ports.filter((port) => Number.isFinite(port.latitude) && Number.isFinite(port.longitude));
    if (valid.length) {
      const bounds: LatLngBoundsExpression = valid.map(
        (port) => [port.latitude, port.longitude] as [number, number],
      );
      map.fitBounds(bounds, { padding: [38, 38], maxZoom: 8 });
    }
  }, [map, ports]);
  return null;
}

function seaColor(state?: string) {
  if (state === "rough") return "#b74f41";
  if (state === "moderate") return "#d18a38";
  return portIcon.color;
}

export default function ShippingMap() {
  const [ports, setPorts] = useState<PortCondition[]>([]);
  const [ships, setShips] = useState<Ship[]>([]);
  const [selectedPort, setSelectedPort] = useState("Paradip");
  const [layer, setLayer] = useState<Layer>("both");
  const [loading, setLoading] = useState(true);
  const [aisLoading, setAisLoading] = useState(false);
  const [error, setError] = useState("");
  const [aisMessage, setAisMessage] = useState("");

  const visiblePorts = layer !== "vessels";
  const visibleShips = layer !== "ports";

  useEffect(() => {
    let active = true;
    get<MarineResponse>("/api/live/marine")
      .then((response) => {
        if (active) setPorts(response.ports);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load port conditions.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function loadVessels() {
    setAisLoading(true);
    setError("");
    try {
      const response = await get<AisResult>(
        `/api/live/ais?port=${encodeURIComponent(selectedPort)}`,
      );
      setShips(response.ships);
      setAisMessage(response.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load AIS positions.");
    } finally {
      setAisLoading(false);
    }
  }

  return (
    <div className="shipping-map-page">
      <section className="shipping-map-toolbar">
        <div>
          <span className="shipping-map-kicker">LIVE EAST COAST OPERATIONS</span>
          <h2>Ports & vessel positions</h2>
          <p>
            Port coordinates and marine forecasts are live. Vessel positions
            appear when an AISStream key is configured and ships are reporting.
          </p>
        </div>
        <div className="shipping-map-controls">
          <label>
            AIS search area
            <select value={selectedPort} onChange={(event) => setSelectedPort(event.target.value)}>
              {["Paradip", "Visakhapatnam", "Chennai", "Kamarajar", "Krishnapatnam"].map((port) => (
                <option key={port}>{port}</option>
              ))}
            </select>
          </label>
          <button className="map-action" disabled={aisLoading} onClick={() => void loadVessels()}>
            {aisLoading ? "Listening…" : "Load live AIS"}
          </button>
        </div>
      </section>

      <section className="shipping-map-card">
        <div className="shipping-map-legend">
          <div className="map-legend-items">
            <span><i className="legend-port" /> Port forecast</span>
            <span><i className="legend-ship" /> AIS position</span>
            <span><i className="legend-line" /> Wave state: calm / moderate / rough</span>
          </div>
          <label className="map-layer-select">
            Map layers
            <select value={layer} onChange={(event) => setLayer(event.target.value as Layer)}>
              <option value="both">Ports + vessels</option>
              <option value="ports">Ports only</option>
              <option value="vessels">Vessels only</option>
            </select>
          </label>
        </div>
        <div className="shipping-map-canvas" role="region" aria-label="Interactive map of Indian east coast ports and vessel positions">
          <MapContainer
            center={[16.5, 83.0]}
            zoom={6}
            minZoom={4}
            maxZoom={13}
            scrollWheelZoom
            className="leaflet-shipping-map"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitPorts ports={ports} />
            {visiblePorts && ports.filter((port) => port.status === "live").map((port) => (
              <CircleMarker
                key={port.port}
                center={[port.latitude, port.longitude]}
                radius={port.port === selectedPort ? 10 : 8}
                pathOptions={{
                  color: seaColor(port.sea_state),
                  fillColor: portIcon.fillColor,
                  fillOpacity: 0.92,
                  weight: 3,
                }}
                eventHandlers={{ click: () => setSelectedPort(port.port) }}
              >
                <Tooltip direction="top" offset={[0, -8]}>{port.port}</Tooltip>
                <Popup>
                  <div className="map-popup">
                    <b>{port.port}</b>
                    <span className="map-popup-state" style={{ color: seaColor(port.sea_state) }}>
                      {port.sea_state} sea state
                    </span>
                    <span>Wave height: {port.wave_height_m?.toFixed(2)} m</span>
                    <span>Wave period: {port.wave_period_s?.toFixed(1)} s</span>
                    <span>Forecast: {port.forecast_at} UTC</span>
                    <a href={port.source_url} target="_blank" rel="noreferrer">Open-Meteo source ↗</a>
                    <button onClick={() => setSelectedPort(port.port)}>Use for AIS search</button>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
            {visibleShips && ships.map((ship) => (
              <CircleMarker
                key={ship.mmsi}
                center={[ship.latitude, ship.longitude]}
                radius={7}
                pathOptions={{
                  color: shipIcon.color,
                  fillColor: shipIcon.fillColor,
                  fillOpacity: 1,
                  weight: 2,
                }}
              >
                <Tooltip direction="top" offset={[0, -7]}>{ship.name}</Tooltip>
                <Popup>
                  <div className="map-popup">
                    <b>{ship.name}</b>
                    <span>MMSI {ship.mmsi}</span>
                    <span>Speed: {ship.speed_knots == null ? "—" : `${ship.speed_knots} kn`}</span>
                    <span>Course: {ship.course_deg == null ? "—" : `${ship.course_deg}°`}</span>
                    <span>{ship.latitude.toFixed(4)}, {ship.longitude.toFixed(4)}</span>
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${ship.latitude}&mlon=${ship.longitude}#map=12/${ship.latitude}/${ship.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open position ↗
                    </a>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
          {loading && <div className="map-loading">Loading live port forecasts…</div>}
        </div>
        <div className="shipping-map-footer">
          <span>
            {visiblePorts ? `${ports.filter((port) => port.status === "live").length} port markers` : "Port layer hidden"}
            {" · "}
            {visibleShips ? `${ships.length} AIS positions` : "Vessel layer hidden"}
          </span>
          <span>Map tiles © OpenStreetMap contributors</span>
        </div>
      </section>

      {(error || aisMessage) && (
        <div className={`map-message ${error ? "error" : ""}`} role={error ? "alert" : "status"}>
          {error || aisMessage}
        </div>
      )}
      <div className="map-port-strip">
        {ports.map((port) => (
          <button
            key={port.port}
            className={selectedPort === port.port ? "selected" : ""}
            onClick={() => {
              setSelectedPort(port.port);
            }}
          >
            <span><i style={{ background: seaColor(port.sea_state) }} />{port.port}</span>
            {port.status === "live" ? (
              <b>{port.wave_height_m?.toFixed(1)} m <small>waves</small></b>
            ) : (
              <b>Unavailable</b>
            )}
          </button>
        ))}
      </div>
      <p className="map-disclaimer">
        AIS markers are time-limited provider reports, not a complete fleet-tracking feed. Marine conditions use approximate port forecast coordinates and are not navigational advice. OpenStreetMap base map © its contributors.
      </p>
    </div>
  );
}
