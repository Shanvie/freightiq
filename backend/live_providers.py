"""Live, source-attributed maritime and logistics data adapters."""

import asyncio
import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
import websockets
from websockets.exceptions import WebSocketException


MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest"
WORLD_BANK_URL = "https://api.worldbank.org/v2/country"
AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream"
CACHE_SECONDS = 600
_cache: Dict[str, tuple[float, Dict[str, Any]]] = {}

PORT_COORDINATES = {
    "Paradip": (20.27, 86.67),
    "Visakhapatnam": (17.69, 83.22),
    "Chennai": (13.08, 80.30),
    "Kamarajar": (13.31, 80.35),
    "Krishnapatnam": (14.25, 80.13),
}
COUNTRIES = {
    "Australia": "AUS",
    "Brazil": "BRA",
    "India": "IND",
    "Indonesia": "IDN",
    "South Africa": "ZAF",
}
LPI_INDICATOR = "LP.LPI.OVRL.XQ"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _get_json(
    cache_key: str,
    url: str,
    params: Optional[Dict[str, Any]] = None,
    ttl: int = CACHE_SECONDS,
) -> Any:
    cached = _cache.get(cache_key)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    async with httpx.AsyncClient(timeout=httpx.Timeout(12.0)) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        payload = response.json()
    _cache[cache_key] = (time.monotonic() + ttl, payload)
    return payload


async def _port_conditions(port: str) -> Dict[str, Any]:
    latitude, longitude = PORT_COORDINATES[port]
    payload = await _get_json(
        f"marine:{port}",
        MARINE_URL,
        {
            "latitude": latitude,
            "longitude": longitude,
            "hourly": "wave_height,wave_period,wave_direction",
            "forecast_days": 2,
            "timezone": "GMT",
        },
    )
    hourly = payload["hourly"]
    times = hourly["time"]
    if not times:
        raise ValueError(f"Marine forecast returned no hours for {port}")
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    index = next(
        (
            position
            for position, value in enumerate(times)
            if datetime.fromisoformat(value) >= now
        ),
        len(times) - 1,
    )
    height = hourly["wave_height"][index]
    period = hourly["wave_period"][index]
    direction = hourly["wave_direction"][index]
    if height is None or period is None:
        raise ValueError(f"Marine forecast is missing wave data for {port}")
    return {
        "port": port,
        "status": "live",
        "latitude": payload["latitude"],
        "longitude": payload["longitude"],
        "forecast_at": times[index],
        "wave_height_m": height,
        "wave_period_s": period,
        "wave_direction_deg": direction,
        "sea_state": "calm" if height < 1.5 else "moderate" if height < 2.5 else "rough",
        "units": {"wave_height": "m", "wave_period": "s", "wave_direction": "degrees"},
        "source": "Open-Meteo Marine",
        "source_url": "https://open-meteo.com/en/docs/marine-weather-api",
        "fetched_at": utc_now(),
    }


async def _country_lpi(country: str, iso3: str) -> Dict[str, Any]:
    payload = await _get_json(
        f"lpi:{iso3}",
        f"{WORLD_BANK_URL}/{iso3}/indicator/{LPI_INDICATOR}",
        {"format": "json", "per_page": 100},
        ttl=86400,
    )
    records = payload[1] if isinstance(payload, list) and len(payload) > 1 else []
    latest = next((record for record in records if record.get("value") is not None), None)
    return {
        "country": country,
        "iso3": iso3,
        "status": "live" if latest else "no_observation",
        "score": latest["value"] if latest else None,
        "year": latest["date"] if latest else None,
        "indicator": "Logistics Performance Index (1=low, 5=high)",
        "source": "World Bank",
        "source_url": f"https://api.worldbank.org/v2/country/{iso3}/indicator/{LPI_INDICATOR}",
        "fetched_at": utc_now(),
    }


async def _usd_inr() -> Dict[str, Any]:
    payload = await _get_json(
        "fx:USD:INR",
        FRANKFURTER_URL,
        {"base": "USD", "symbols": "INR"},
        ttl=1800,
    )
    rate = payload.get("rates", {}).get("INR")
    if rate is None:
        raise ValueError("Frankfurter returned no USD/INR rate")
    return {
        "pair": "USD/INR",
        "rate": rate,
        "date": payload["date"],
        "status": "live",
        "source": "Frankfurter (ECB reference rates)",
        "source_url": "https://frankfurter.dev",
        "fetched_at": utc_now(),
    }


async def _provider_result(name: str, operation: Any) -> Dict[str, Any]:
    try:
        return await operation
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as error:
        return {"name": name, "status": "unavailable", "error": str(error)}


async def live_marine_conditions() -> List[Dict[str, Any]]:
    return await asyncio.gather(
        *(
            _provider_result(port, _port_conditions(port))
            for port in PORT_COORDINATES
        )
    )


async def live_country_logistics() -> List[Dict[str, Any]]:
    return await asyncio.gather(
        *(
            _provider_result(country, _country_lpi(country, iso3))
            for country, iso3 in COUNTRIES.items()
        )
    )


async def live_currency() -> Dict[str, Any]:
    return await _provider_result("USD/INR", _usd_inr())


async def live_shipping_snapshot() -> Dict[str, Any]:
    ports, country_scores, fx = await asyncio.gather(
        live_marine_conditions(),
        live_country_logistics(),
        live_currency(),
    )
    return {
        "generated_at": utc_now(),
        "data_label": "LIVE PUBLIC SOURCES · AIS REQUIRES AISSTREAM_API_KEY",
        "marine_conditions": ports,
        "country_logistics": country_scores,
        "currency": fx,
        "ais": {
            "status": "configured" if os.getenv("AISSTREAM_API_KEY") else "not_configured",
            "provider": "AISStream",
            "source_url": "https://aisstream.io",
            "message": (
                "Server-side AIS feed is ready."
                if os.getenv("AISSTREAM_API_KEY")
                else "Set AISSTREAM_API_KEY in .env to request live vessel positions."
            ),
        },
        "freight_rates": {
            "status": "not_configured",
            "message": "Live bulk freight indexes and spot fixtures require a licensed provider subscription.",
        },
    }


def _position_report(message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if message.get("MessageType") != "PositionReport":
        return None
    metadata = message.get("MetaData", {})
    report = message.get("Message", {}).get("PositionReport", {})
    latitude = report.get("Latitude")
    longitude = report.get("Longitude")
    if latitude is None or longitude is None:
        return None
    return {
        "mmsi": metadata.get("MMSI"),
        "name": (metadata.get("ShipName") or "").strip() or "Unknown vessel",
        "latitude": latitude,
        "longitude": longitude,
        "speed_knots": report.get("Sog"),
        "course_deg": report.get("Cog"),
        "heading_deg": report.get("TrueHeading"),
        "navigation_status": report.get("NavigationalStatus"),
        "reported_at": message.get("Message", {}).get("PositionReport", {}).get("Timestamp"),
    }


async def live_vessel_positions(port: str, seconds: int = 8) -> Dict[str, Any]:
    api_key = os.getenv("AISSTREAM_API_KEY")
    if not api_key:
        return {
            "status": "not_configured",
            "port": port,
            "ships": [],
            "message": "Set AISSTREAM_API_KEY in the backend .env file to enable live AIS.",
        }
    if port not in PORT_COORDINATES:
        raise ValueError(f"Unsupported port: {port}")

    latitude, longitude = PORT_COORDINATES[port]
    radius = 0.45
    subscription = {
        "APIKey": api_key,
        "BoundingBoxes": [
            [
                [latitude - radius, longitude - radius],
                [latitude + radius, longitude + radius],
            ]
        ],
        "FilterMessageTypes": ["PositionReport"],
    }
    ships: Dict[str, Dict[str, Any]] = {}
    try:
        async with websockets.connect(
            AISSTREAM_URL,
            open_timeout=8,
            close_timeout=2,
            ping_interval=20,
            max_size=1_000_000,
        ) as socket:
            await socket.send(json.dumps(subscription))
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline and len(ships) < 100:
                try:
                    frame = await asyncio.wait_for(
                        socket.recv(), timeout=max(0.1, deadline - time.monotonic())
                    )
                except asyncio.TimeoutError:
                    break
                payload = json.loads(frame.decode("utf-8") if isinstance(frame, bytes) else frame)
                position = _position_report(payload)
                if position and position["mmsi"] is not None:
                    ships[str(position["mmsi"])] = position
    except (OSError, asyncio.TimeoutError, WebSocketException, json.JSONDecodeError) as error:
        raise RuntimeError(f"AISStream request failed: {error}") from error

    return {
        "status": "live",
        "provider": "AISStream",
        "port": port,
        "ships": list(ships.values()),
        "received_count": len(ships),
        "window_seconds": seconds,
        "fetched_at": utc_now(),
        "source_url": "https://aisstream.io",
        "message": (
            f"Received {len(ships)} vessel position reports in {seconds} seconds."
            if ships
            else f"No AIS position reports received near {port} during the {seconds}-second window."
        ),
    }
