import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const app = express();
const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '127.0.0.1';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.WEATHEROS_DB_PATH || path.join(DATA_DIR, 'weatheros.sqlite');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS weather_records (
    id TEXT PRIMARY KEY,
    location_name TEXT NOT NULL,
    location_admin1 TEXT NOT NULL DEFAULT '',
    location_country TEXT NOT NULL DEFAULT '',
    latitude REAL NOT NULL CHECK(latitude >= -90 AND latitude <= 90),
    longitude REAL NOT NULL CHECK(longitude >= -180 AND longitude <= 180),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    temperatures_json TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK(start_date <= end_date)
  );

  CREATE INDEX IF NOT EXISTS idx_weather_records_created_at
  ON weather_records(created_at DESC);
`);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function fail(res, status, message) {
  return res.status(status).json({ error: message });
}

function validCoords(lat, lon) {
  return Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 &&
    lon >= -180 && lon <= 180;
}

function validDate(value) {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function validateRange(startDate, endDate) {
  if (!validDate(startDate) || !validDate(endDate)) {
    return 'Enter valid start and end dates in YYYY-MM-DD format.';
  }

  if (startDate > endDate) {
    return 'Start date must be on or before end date.';
  }

  const span =
    (Date.parse(`${endDate}T00:00:00Z`) -
      Date.parse(`${startDate}T00:00:00Z`)) / 86400000;

  if (span > 30) {
    return 'Choose a date range of 31 days or fewer.';
  }

  const today = new Date().toISOString().slice(0, 10);

  const latestForecastDay = new Date(
    Date.parse(`${today}T00:00:00Z`) + 15 * 86400000
  ).toISOString().slice(0, 10);

  if (endDate > today && endDate > latestForecastDay) {
    return 'Forecast data is available up to 16 days ahead. Choose an earlier end date.';
  }

  return null;
}

function mapRecord(row) {
  return {
    id: row.id,
    location: {
      name: row.location_name,
      admin1: row.location_admin1,
      country: row.location_country,
      latitude: row.latitude,
      longitude: row.longitude
    },
    startDate: row.start_date,
    endDate: row.end_date,
    temperatures: JSON.parse(row.temperatures_json || '[]'),
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function allRecords() {
  return db.prepare(
    'SELECT * FROM weather_records ORDER BY created_at DESC'
  ).all().map(mapRecord);
}

function getRecord(id) {
  const row = db.prepare(
    'SELECT * FROM weather_records WHERE id = ?'
  ).get(id);

  return row ? mapRecord(row) : null;
}

function validLocation(location) {
  return location &&
    typeof location.name === 'string' &&
    location.name.trim().length > 0 &&
    location.name.length <= 160 &&
    validCoords(Number(location.latitude), Number(location.longitude));
}

function validTemperatureRows(rows, startDate, endDate) {
  if (!Array.isArray(rows) || rows.length > 31) return false;

  return rows.every((row) =>
    row &&
    validDate(row.date) &&
    row.date >= startDate &&
    row.date <= endDate &&
    (row.high == null ||
      (Number.isFinite(Number(row.high)) &&
        Number(row.high) >= -100 &&
        Number(row.high) <= 70)) &&
    (row.low == null ||
      (Number.isFinite(Number(row.low)) &&
        Number(row.low) >= -100 &&
        Number(row.low) <= 70)) &&
    (row.code == null || Number.isInteger(Number(row.code))) &&
    (row.precipitation == null ||
      (Number.isFinite(Number(row.precipitation)) &&
        Number(row.precipitation) >= 0))
  );
}

function normalizeLocation(location) {
  return {
    name: location.name.trim(),
    admin1: String(location.admin1 || '').slice(0, 160),
    country: String(location.country || '').slice(0, 120),
    latitude: Number(location.latitude),
    longitude: Number(location.longitude)
  };
}

async function fetchJson(url, label) {
  let response;

  try {
    response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'WeatherOS/1.0'
      },
      signal: AbortSignal.timeout(12000)
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new Error(`${label} timed out. Please retry.`);
    }

    throw new Error(
      `${label} could not be reached. Check your internet connection and retry.`
    );
  }

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}.`);
  }

  if (!body.trim()) {
    throw new Error(`${label} returned an empty response. Please retry shortly.`);
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${label} returned invalid JSON. Please retry shortly.`);
  }
}

async function retrieveRange(lat, lon, startDate, endDate) {
  const rangeError = validateRange(startDate, endDate);
  if (rangeError) throw new Error(rangeError);

  const today = new Date().toISOString().slice(0, 10);
  const days = [];

  if (startDate < today) {
    const pastEnd = endDate < today
      ? endDate
      : new Date(
          Date.parse(`${today}T00:00:00Z`) - 86400000
        ).toISOString().slice(0, 10);

    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      start_date: startDate,
      end_date: pastEnd,
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum',
      timezone: 'auto',
      temperature_unit: 'celsius'
    });

    const archive = await fetchJson(
      `https://archive-api.open-meteo.com/v1/archive?${params}`,
      'Historical weather service'
    );

    if (Array.isArray(archive.daily?.time)) {
      days.push(...archive.daily.time.map((date, i) => ({
        date,
        high: archive.daily.temperature_2m_max?.[i] ?? null,
        low: archive.daily.temperature_2m_min?.[i] ?? null,
        code: archive.daily.weather_code?.[i] ?? null,
        precipitation: archive.daily.precipitation_sum?.[i] ?? null,
        source: 'historical'
      })));
    }
  }

  if (endDate >= today) {
    const futureStart = startDate < today ? today : startDate;

    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      start_date: futureStart,
      end_date: endDate,
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum',
      timezone: 'auto',
      temperature_unit: 'celsius'
    });

    const forecast = await fetchJson(
      `https://api.open-meteo.com/v1/forecast?${params}`,
      'Forecast service'
    );

    if (Array.isArray(forecast.daily?.time)) {
      days.push(...forecast.daily.time.map((date, i) => ({
        date,
        high: forecast.daily.temperature_2m_max?.[i] ?? null,
        low: forecast.daily.temperature_2m_min?.[i] ?? null,
        code: forecast.daily.weather_code?.[i] ?? null,
        precipitation: forecast.daily.precipitation_sum?.[i] ?? null,
        source: 'forecast'
      })));
    }
  }

  return days.sort((a, b) => a.date.localeCompare(b.date));
}

app.get('/api/health', (_req, res) =>
  res.json({
    ok: true,
    service: 'WeatherOS API',
    database: 'SQLite',
    version: '1.1.0'
  })
);





app.get('/api/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim();

  if (q.length < 2) {
    return fail(res, 400, 'Enter at least two characters for a location.');
  }

  if (q.length > 120) {
    return fail(res, 400, 'Location search is too long.');
  }

  const normalize = (value) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const query = normalize(q);
  const tokens = query.split(/\s+/).filter(Boolean);
  const isIndianPin = /^\d{6}$/.test(q);
  const results = [];
  const providerErrors = [];

  function matchesQuery(place) {
    const name = normalize(place.name);

    // Exact locality match.
    if (name === query) return true;

    // Allow a longer locality name containing the full query.
    if (name.startsWith(query + ' ')) return true;

    // Reject broad or nearby results whose address merely
    // happens to contain the search terms.
    return false;
  }


  function addResult(candidate) {
    if (!validCoords(candidate.latitude, candidate.longitude)) return;
    if (!matchesQuery(candidate)) return;

    const normalizedName = normalize(candidate.name);
    const normalizedAdmin = normalize(candidate.admin1);
    const normalizedCountry = normalize(candidate.country);

    const duplicate = results.some(existing => {
      const sameIdentity =
        normalize(existing.name) === normalizedName &&
        normalize(existing.admin1) === normalizedAdmin &&
        normalize(existing.country) === normalizedCountry;

      const distance = Math.hypot(
        (existing.latitude - candidate.latitude) * 111,
        (existing.longitude - candidate.longitude) *
          111 * Math.cos(candidate.latitude * Math.PI / 180)
      );

      // Merge duplicate provider representations of the same place.
      return sameIdentity || distance < 0.2;
    });

    if (!duplicate) results.push(candidate);
  }

  // 1. Open-Meteo geocoding
  try {
    const params = new URLSearchParams({
      name: q,
      count: '20',
      language: 'en',
      format: 'json'
    });

    const data = await fetchJson(
      `https://geocoding-api.open-meteo.com/v1/search?${params}`,
      'Primary geocoding service'
    );

    for (const p of (Array.isArray(data.results) ? data.results : [])) {
      addResult({
        id: String(p.id ?? `${p.latitude},${p.longitude}`),
        name: p.name || '',
        admin1: p.admin1 || '',
        country: p.country || '',
        latitude: Number(p.latitude),
        longitude: Number(p.longitude),
        timezone: p.timezone || 'auto',
        source: 'Open-Meteo'
      });
    }
  } catch (error) {
    providerErrors.push(error.message);
  }

  // 2. Nominatim: search for specific localities too.
  try {
    const params = new URLSearchParams({
      format: 'jsonv2',
      addressdetails: '1',
      limit: '20',
      'accept-language': 'en'
    });

    if (isIndianPin) {
      params.set('postalcode', q);
      params.set('countrycodes', 'in');
    } else {
      params.set('q', q);
    }

    const osm = await fetchJson(
      `https://nominatim.openstreetmap.org/search?${params}`,
      'OpenStreetMap geocoding service'
    );

    for (const p of (Array.isArray(osm) ? osm : [])) {
      const address = p.address || {};

      const latitude = Number(p.lat);
      const longitude = Number(p.lon);

      const name =
        p.name ||
        address.neighbourhood ||
        address.suburb ||
        address.quarter ||
        address.hamlet ||
        address.village ||
        address.town ||
        address.city ||
        address.municipality ||
        '';

      addResult({
        id: `osm-${p.osm_type || 'place'}-${p.osm_id || `${latitude},${longitude}`}`,
        name,
        admin1:
          address.state ||
          address.region ||
          address.county ||
          '',
        country: address.country || '',
        latitude,
        longitude,
        timezone: 'auto',
        source: 'OpenStreetMap',
        displayName: p.display_name || ''
      });
    }
  } catch (error) {
    providerErrors.push(error.message);
  }

  // 3. Rank exact locality matches above broader matches.
  function scoreResult(place) {
    const name = normalize(place.name);
    const display = normalize(place.displayName);

    let score = 0;

    if (name === query) score += 200;
    else if (name.startsWith(query)) score += 120;
    else if (display.startsWith(query)) score += 100;
    else if (display.includes(query)) score += 60;

    if (place.source === 'OpenStreetMap') score += 10;

    return score;
  }

  results.sort((a, b) => scoreResult(b) - scoreResult(a));

  if (!results.length && providerErrors.length === 2) {
    return fail(
      res,
      502,
      'Location search services are unavailable. Please retry.'
    );
  }

  return res.json({
    query: q,
    results: results.slice(0, 10),
    providers: ['Open-Meteo', 'OpenStreetMap/Nominatim']
  });
});






function metSymbolToWmo(symbol = '') {
  const value = String(symbol)
    .toLowerCase()
    .replace(/_(day|night|polartwilight)$/, '');

  if (value.includes('thunder')) return 95;
  if (value.includes('heavyrain')) return 65;
  if (value.includes('lightrain')) return 61;
  if (value.includes('rain')) return 63;
  if (value.includes('heavysnow')) return 75;
  if (value.includes('lightsnow')) return 71;
  if (value.includes('snow')) return 73;
  if (value.includes('sleet')) return 77;
  if (value.includes('fog')) return 45;
  if (value.includes('heavydrizzle')) return 55;
  if (value.includes('drizzle')) return 51;
  if (value.includes('partlycloudy')) return 2;
  if (value.includes('cloudy')) return 3;
  if (value.includes('fair')) return 1;
  if (value.includes('clearsky')) return 0;

  return 3;
}

function normalizeMetNo(payload) {
  const series = payload?.properties?.timeseries;

  if (!Array.isArray(series) || series.length === 0) {
    throw new Error(
      'Fallback weather service returned no forecast points.'
    );
  }

  // Convert only valid forecast points. Missing provider fields remain null.
  const rows = series
    .filter((point) =>
      point &&
      typeof point.time === 'string' &&
      !Number.isNaN(Date.parse(point.time)) &&
      point.data &&
      typeof point.data === 'object'
    )
    .map((point) => {
      const data = point.data || {};

      const instant =
        data.instant?.details &&
        typeof data.instant.details === 'object'
          ? data.instant.details
          : {};

      // Each forecast period can independently be null or absent.
      const periods = [
        data.next_1_hours,
        data.next_6_hours,
        data.next_12_hours
      ];

      const selectedPeriod = periods.find(
        (item) =>
          item &&
          typeof item === 'object' &&
          item.details &&
          typeof item.details === 'object'
      );

      const period = selectedPeriod?.details || {};

      const selectedSummary = periods.find(
        (item) =>
          item &&
          typeof item === 'object' &&
          item.summary &&
          typeof item.summary === 'object' &&
          item.summary.symbol_code
      );

      const symbol = selectedSummary?.summary?.symbol_code || '';

      const temperature = Number.isFinite(Number(instant.air_temperature))
        ? Number(instant.air_temperature)
        : null;

      const humidity = Number.isFinite(Number(instant.relative_humidity))
        ? Number(instant.relative_humidity)
        : null;

      const windSpeed = Number.isFinite(Number(instant.wind_speed))
        ? Number(instant.wind_speed) * 3.6
        : null;

      const windDirection = Number.isFinite(Number(instant.wind_from_direction))
        ? Number(instant.wind_from_direction)
        : null;

      const precipitation = Number.isFinite(Number(period.precipitation_amount))
        ? Number(period.precipitation_amount)
        : null;

      const probability = Number.isFinite(Number(period.probability_of_precipitation))
        ? Number(period.probability_of_precipitation)
        : null;

      const uv = Number.isFinite(Number(period.ultraviolet_index_clear_sky_max))
        ? Number(period.ultraviolet_index_clear_sky_max)
        : null;

      return {
        time: point.time,
        temperature,
        humidity,
        feelsLike: temperature,
        wind: windSpeed,
        windDirection,
        precipitation,
        probability,
        code: metSymbolToWmo(symbol),
        uv
      };
    });

  if (rows.length === 0) {
    throw new Error(
      'Fallback weather service returned no usable forecast points.'
    );
  }

  const now = Date.now();

  const currentRow =
    rows.find((r) => Date.parse(r.time) >= now - 60 * 60 * 1000) ||
    rows[0];

  const hourlyRows = rows.filter(
    (r) => Date.parse(r.time) <= now + 48 * 60 * 60 * 1000
  );

  const dailyMap = new Map();

  for (const row of rows) {
    const date = row.time.slice(0, 10);

    if (!dailyMap.has(date)) {
      dailyMap.set(date, []);
    }

    dailyMap.get(date).push(row);
  }

  const dailyRows = [...dailyMap.entries()]
    .slice(0, 5)
    .map(([date, items]) => {
      const temps = items
        .map((x) => x.temperature)
        .filter((x) => Number.isFinite(x));

      const probs = items
        .map((x) => x.probability)
        .filter((x) => Number.isFinite(x));

      const rainValues = items
        .map((x) => x.precipitation)
        .filter((x) => Number.isFinite(x) && x >= 0);

      const rain = rainValues.length
        ? rainValues.reduce((sum, value) => sum + value, 0)
        : null;

      const uv = items
        .map((x) => x.uv)
        .filter((x) => Number.isFinite(x));

      const modeCode =
        items[Math.floor(items.length / 2)]?.code ?? 3;

      return {
        date,
        high: temps.length ? Math.max(...temps) : null,
        low: temps.length ? Math.min(...temps) : null,
        probability: probs.length ? Math.max(...probs) : null,
        precipitation: rain,
        uv: uv.length ? Math.max(...uv) : null,
        code: modeCode
      };
    });

  return {
    current: {
      time: currentRow.time,
      temperature_2m: currentRow.temperature,
      relative_humidity_2m: currentRow.humidity,
      apparent_temperature: currentRow.feelsLike,
      is_day: 1,
      precipitation: currentRow.precipitation,
      rain: currentRow.precipitation,
      showers: null,
      snowfall: null,
      weather_code: currentRow.code,
      wind_speed_10m: currentRow.wind,
      wind_direction_10m: currentRow.windDirection
    },

    hourly: {
      time: hourlyRows.map((x) => x.time),
      temperature_2m: hourlyRows.map((x) => x.temperature),
      precipitation_probability: hourlyRows.map((x) => x.probability),
      precipitation: hourlyRows.map((x) => x.precipitation),
      weather_code: hourlyRows.map((x) => x.code),
      wind_speed_10m: hourlyRows.map((x) => x.wind),
      uv_index: hourlyRows.map((x) => x.uv)
    },

    daily: {
      time: dailyRows.map((x) => x.date),
      weather_code: dailyRows.map((x) => x.code),
      temperature_2m_max: dailyRows.map((x) => x.high),
      temperature_2m_min: dailyRows.map((x) => x.low),
      sunrise: dailyRows.map(() => null),
      sunset: dailyRows.map(() => null),
      uv_index_max: dailyRows.map((x) => x.uv),
      precipitation_probability_max: dailyRows.map((x) => x.probability),
      precipitation_sum: dailyRows.map((x) => x.precipitation),
      wind_speed_10m_max: dailyRows.map(() => null)
    },

    fallback: {
      provider: 'MET Norway Locationforecast',
      note: 'Some Open-Meteo-only fields (such as AQI and sunrise/sunset) are unavailable in fallback mode.'
    }
  };
}

async function fetchFallbackWeather(lat, lon) {
  const url =
    `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;

  let response;

  try {
    response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'WeatherOS/1.0 (https://github.com/Shaurya-Anurag)'
      },
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new Error('MET Norway fallback timed out. Please retry.');
    }

    throw new Error('MET Norway fallback could not be reached.');
  }

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `MET Norway fallback returned HTTP ${response.status}.`
    );
  }

  if (!body.trim()) {
    throw new Error('MET Norway fallback returned an empty response.');
  }

  let data;

  try {
    data = JSON.parse(body);
  } catch {
    throw new Error('MET Norway fallback returned invalid JSON.');
  }

  return normalizeMetNo(data);
}

app.get('/api/weather', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);

  if (!validCoords(lat, lon)) {
    return fail(res, 400, 'Valid latitude and longitude are required.');
  }

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,wind_speed_10m,wind_direction_10m',
    hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,uv_index',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max,precipitation_sum,wind_speed_10m_max',
    forecast_days: '5',
    timezone: 'auto',
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh'
  });

  try {
    let weather;
    let provider = 'Open-Meteo';

    try {
      weather = await fetchJson(
        `https://api.open-meteo.com/v1/forecast?${params}`,
        'Weather service'
      );
    } catch (primaryError) {
      console.warn(
        `[WeatherOS] Open-Meteo failed (${primaryError.message}); trying MET Norway fallback.`
      );

      weather = await fetchFallbackWeather(lat, lon);
      provider = 'MET Norway';
    }

    const airQuality = provider === 'Open-Meteo'
      ? await fetchJson(
          `https://air-quality-api.open-meteo.com/v1/air-quality?${new URLSearchParams({
            latitude: String(lat),
            longitude: String(lon),
            current: 'us_aqi,pm2_5,pm10',
            hourly: 'us_aqi,pm2_5,pm10',
            forecast_days: '1',
            timezone: 'auto'
          })}`,
          'Air quality service'
        ).catch(() => null)
      : null;

    return res.json({
      ...weather,
      airQuality,
      provider
    });
  } catch (error) {
    console.error('[WeatherOS] all weather providers failed:', error);

    return fail(
      res,
      503,
      error.message || 'Weather providers are temporarily unavailable. Please retry.'
    );
  }
});

app.get('/api/range', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);

  if (!validCoords(lat, lon)) {
    return fail(res, 400, 'Valid latitude and longitude are required.');
  }

  const rangeError = validateRange(
    String(req.query.start || ''),
    String(req.query.end || '')
  );

  if (rangeError) return fail(res, 400, rangeError);

  try {
    return res.json({
      location: {
        latitude: lat,
        longitude: lon
      },
      startDate: req.query.start,
      endDate: req.query.end,
      days: await retrieveRange(
        lat,
        lon,
        req.query.start,
        req.query.end
      )
    });
  } catch (error) {
    return fail(
      res,
      502,
      error.message || 'Could not retrieve weather for that date range.'
    );
  }
});

app.get('/api/records', (_req, res) => {
  try {
    return res.json({ records: allRecords() });
  } catch (error) {
    console.error('[WeatherOS DB] read failed:', error);
    return fail(res, 500, 'Could not read saved weather records.');
  }
});

app.post('/api/records', (req, res) => {
  const body = req.body || {};

  if (!validLocation(body.location)) {
    return fail(res, 400, 'Choose a valid location from the search results.');
  }

  const rangeError = validateRange(
    String(body.startDate || ''),
    String(body.endDate || '')
  );

  if (rangeError) return fail(res, 400, rangeError);

  if (!Array.isArray(body.temperatures)) {
    return fail(
      res,
      400,
      'Weather results must be an array. Retrieve the weather range before saving.'
    );
  }

  if (!validTemperatureRows(
    body.temperatures,
    body.startDate,
    body.endDate
  )) {
    return fail(
      res,
      400,
      'Weather rows must contain valid dates inside the requested range and sensible numeric values.'
    );
  }

  const location = normalizeLocation(body.location);
  const id = randomUUID();
  const now = new Date().toISOString();

  const record = {
    id,
    location,
    startDate: body.startDate,
    endDate: body.endDate,
    temperatures: body.temperatures,
    summary: String(body.summary || '').slice(0, 500),
    createdAt: now,
    updatedAt: now
  };

  try {
    db.prepare(`
      INSERT INTO weather_records (
        id, location_name, location_admin1, location_country,
        latitude, longitude, start_date, end_date,
        temperatures_json, summary, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      location.name,
      location.admin1,
      location.country,
      location.latitude,
      location.longitude,
      record.startDate,
      record.endDate,
      JSON.stringify(record.temperatures),
      record.summary,
      now,
      now
    );

    return res.status(201).json({ record });
  } catch (error) {
    console.error('[WeatherOS DB] create failed:', error);
    return fail(res, 500, 'Could not save this weather record.');
  }
});

app.put('/api/records/:id', (req, res) => {
  const body = req.body || {};
  const existing = getRecord(req.params.id);

  if (!existing) {
    return fail(res, 404, 'Weather record not found.');
  }

  const startDate = String(body.startDate ?? existing.startDate);
  const endDate = String(body.endDate ?? existing.endDate);

  const rangeError = validateRange(startDate, endDate);

  if (rangeError) return fail(res, 400, rangeError);

  if (body.location !== undefined && !validLocation(body.location)) {
    return fail(res, 400, 'Choose a valid location.');
  }

  if (
    body.temperatures !== undefined &&
    !validTemperatureRows(body.temperatures, startDate, endDate)
  ) {
    return fail(
      res,
      400,
      'Weather rows must contain valid dates inside the requested range and sensible numeric values.'
    );
  }

  const location = body.location
    ? normalizeLocation(body.location)
    : existing.location;

  const temperatures = body.temperatures ?? existing.temperatures;

  const summary = body.summary === undefined
    ? existing.summary
    : String(body.summary).slice(0, 500);

  const updatedAt = new Date().toISOString();

  try {
    db.prepare(`
      UPDATE weather_records
      SET location_name=?, location_admin1=?, location_country=?,
          latitude=?, longitude=?, start_date=?, end_date=?,
          temperatures_json=?, summary=?, updated_at=?
      WHERE id=?
    `).run(
      location.name,
      location.admin1,
      location.country,
      location.latitude,
      location.longitude,
      startDate,
      endDate,
      JSON.stringify(temperatures),
      summary,
      updatedAt,
      req.params.id
    );

    return res.json({ record: getRecord(req.params.id) });
  } catch (error) {
    console.error('[WeatherOS DB] update failed:', error);
    return fail(res, 500, 'Could not update this record.');
  }
});

app.delete('/api/records/:id', (req, res) => {
  try {
    const result = db.prepare(
      'DELETE FROM weather_records WHERE id = ?'
    ).run(req.params.id);

    if (!result.changes) {
      return fail(res, 404, 'Weather record not found.');
    }

    return res.json({
      ok: true,
      deletedId: req.params.id
    });
  } catch (error) {
    console.error('[WeatherOS DB] delete failed:', error);
    return fail(res, 500, 'Could not delete this record.');
  }
});

app.get('/api/export/:format', (req, res) => {
  try {
    const records = allRecords();
    const format = String(req.params.format).toLowerCase();

    if (format === 'json') {
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="weatheros-records.json"'
      );

      return res.json({
        exportedAt: new Date().toISOString(),
        records
      });
    }

    if (format === 'csv') {
      const quote = (value) =>
        `"${String(value ?? '').replaceAll('"', '""')}"`;

      const columns = [
        'id',
        'location',
        'country',
        'latitude',
        'longitude',
        'startDate',
        'endDate',
        'temperatures',
        'summary',
        'createdAt',
        'updatedAt'
      ];

      const rows = records.map((r) => [
        r.id,
        r.location.name,
        r.location.country,
        r.location.latitude,
        r.location.longitude,
        r.startDate,
        r.endDate,
        JSON.stringify(r.temperatures),
        r.summary,
        r.createdAt,
        r.updatedAt
      ]);

      const csv = [columns, ...rows]
        .map((row) => row.map(quote).join(','))
        .join('\r\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="weatheros-records.csv"'
      );

      return res.send(csv);
    }

    return fail(res, 400, 'Supported export formats are JSON and CSV.');
  } catch (error) {
    console.error('[WeatherOS DB] export failed:', error);
    return fail(res, 500, 'Could not export weather records.');
  }
});

const DIST_DIR = path.join(__dirname, '..', 'dist');

app.use(express.static(DIST_DIR));

app.get('*', async (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();

  try {
    await fs.promises.access(path.join(DIST_DIR, 'index.html'));
    return res.sendFile(path.join(DIST_DIR, 'index.html'));
  } catch {
    return next();
  }
});

app.use((req, res) =>
  fail(res, 404, `Route not found: ${req.method} ${req.path}`)
);

app.use((error, _req, res, _next) => {
  console.error('[WeatherOS API]', error);

  if (res.headersSent) return;

  if (error instanceof SyntaxError && 'body' in error) {
    return fail(res, 400, 'Request body contains invalid JSON.');
  }

  return fail(res, 500, 'Unexpected server error. Check the terminal for details.');
});

const server = app.listen(PORT, HOST, () => {
  console.log(
    `WeatherOS API listening on http://${HOST}:${PORT} (SQLite: ${DB_PATH})`
  );
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);