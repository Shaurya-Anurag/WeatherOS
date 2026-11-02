import { useCallback, useEffect, useMemo, useState } from 'react';
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, CloudMoon, Moon, Sunrise, Sunset, Compass, Download, ExternalLink, LocateFixed, MapPin, Search, Sun, Thermometer, Umbrella, Wind, Droplets, CalendarDays, Clock3, RefreshCw, Trash2, Pencil, X, Check, AlertTriangle, History, Plus, Github, Map, Youtube } from 'lucide-react';

const DEFAULT_LOCATION = { id: 'bhopal-default', name: 'Bhopal', admin1: 'Madhya Pradesh', country: 'India', latitude: 23.2599, longitude: 77.4126, timezone: 'Asia/Kolkata' };
const dateToday = () => new Date().toISOString().slice(0, 10);
const readStored = (key, fallback) => { try { const raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };
const addDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const weatherLabel = (code) => ({0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Depositing rime fog',51:'Light drizzle',53:'Drizzle',55:'Dense drizzle',56:'Freezing drizzle',57:'Heavy freezing drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',66:'Freezing rain',67:'Heavy freezing rain',71:'Light snow',73:'Snow',75:'Heavy snow',77:'Snow grains',80:'Rain showers',81:'Rain showers',82:'Heavy rain showers',85:'Snow showers',86:'Heavy snow showers',95:'Thunderstorm',96:'Thunderstorm with hail',99:'Severe thunderstorm'})[code] || 'Weather conditions';
const weatherIcon = (code, size = 26, period = 'day') => {
  const props = { size, strokeWidth: 1.7 };
  // Clear and partly-cloudy conditions change with the local solar cycle.
  if (code === 0 || code === 1) {
    if (period === 'dawn') return <Sunrise {...props} />;
    if (period === 'dusk') return <Sunset {...props} />;
    return period === 'night' ? <Moon {...props} /> : <Sun {...props} />;
  }
  if (code === 2) return period === 'night' ? <CloudMoon {...props} /> : <CloudSun {...props} />;
  if (code === 3) return <Cloud {...props} />;
  if ([45,48].includes(code)) return <CloudFog {...props} />;
  if ([51,53,55,56,57].includes(code)) return <CloudDrizzle {...props} />;
  if ([61,63,65,66,67,80,81,82].includes(code)) return <CloudRain {...props} />;
  if ([71,73,75,77,85,86].includes(code)) return <CloudSnow {...props} />;
  if ([95,96,99].includes(code)) return <CloudLightning {...props} />;
  return <Cloud {...props} />;
};

// Open-Meteo supplies sunrise/sunset as local ISO timestamps for the location.
// Compare their clock strings directly so the visitor's device timezone cannot
// accidentally shift the icon for another country.
const solarPeriod = (time, daily) => {
  if (!time || !daily?.time) return 'day';
  const date = time.slice(0, 10);
  const dayIndex = daily.time.indexOf(date);
  if (dayIndex < 0) return 'day';

  const toMinutes = (value) => {
    if (!value) return null;
    const match = value.slice(11, 16).match(/^(\d{2}):(\d{2})$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };

  const currentMinutes = toMinutes(time);
  const sunriseMinutes = toMinutes(daily.sunrise?.[dayIndex]);
  const sunsetMinutes = toMinutes(daily.sunset?.[dayIndex]);
  if (currentMinutes == null || sunriseMinutes == null || sunsetMinutes == null) return 'day';

  if (Math.abs(currentMinutes - sunriseMinutes) <= 45) return 'dawn';
  if (Math.abs(currentMinutes - sunsetMinutes) <= 45) return 'dusk';
  return currentMinutes >= sunriseMinutes && currentMinutes < sunsetMinutes ? 'day' : 'night';
};

const timedWeatherIcon = (code, size, time, daily) =>
  weatherIcon(code, size, solarPeriod(time, daily));
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { throw new Error(`Server returned an invalid response (HTTP ${response.status}).`); }
  if (!response.ok) throw new Error(payload.error || `Request failed (HTTP ${response.status}).`);
  return payload;
}
function locationName(loc) { return [loc.name, loc.admin1, loc.country].filter(Boolean).join(', '); }
function dateLabel(date, options = { weekday: 'short', month: 'short', day: 'numeric' }) { return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, options); }
function TemperatureRainChart({ hours }) {
  const validTemps = hours
    .filter((hour) => hour.temperature != null && Number.isFinite(Number(hour.temperature)))
    .map((hour) => Number(hour.temperature));
  if (!hours.length || !validTemps.length) {
    return <EmptyState text="Temperature trend unavailable." />;
  }

  const min = Math.floor(Math.min(...validTemps));
  const max = Math.ceil(Math.max(...validTemps));
  const spread = Math.max(2, max - min);
  const validRain = hours
    .filter((hour) => hour.precipitation != null && Number.isFinite(Number(hour.precipitation)))
    .map((hour) => Number(hour.precipitation));
  const maxRain = Math.max(0.5, ...validRain);

  const points = hours.map((hour, index) => {
    const x = 28 + (index * 904) / Math.max(1, hours.length - 1);
    const hasTemperature = hour.temperature != null && Number.isFinite(Number(hour.temperature));
    const hasRain = hour.precipitation != null && Number.isFinite(Number(hour.precipitation));
    const y = hasTemperature
      ? 112 - (((Number(hour.temperature) - min) / spread) * 76)
      : null;
    const rainHeight = hasRain
      ? Math.max(0, (Number(hour.precipitation) / maxRain) * 42)
      : null;

    return { ...hour, x, y, rainHeight, hasTemperature, hasRain };
  });

  const temperaturePoints = points
    .filter((point) => point.hasTemperature)
    .map((point) => `${point.x},${point.y}`)
    .join(' ');
  const low = Math.min(...validTemps);
  const high = Math.max(...validTemps);
  const allRainAvailable = points.every((point) => point.hasRain);
  const anyRainAvailable = points.some((point) => point.hasRain);
  const rainfallTotal = validRain.reduce((sum, amount) => sum + amount, 0);

  let rainfallSummary;
  if (!anyRainAvailable) {
    rainfallSummary = 'Rainfall data unavailable for this period';
  } else if (!allRainAvailable) {
    rainfallSummary = 'Rainfall data partially unavailable';
  } else if (rainfallTotal > 0) {
    rainfallSummary = `Expected rainfall: ${rainfallTotal.toFixed(1)} mm over these hours`;
  } else {
    rainfallSummary = 'No measurable rainfall expected in this period';
  }

  return <div className="trend-visual">
    <div className="trend-legend">
      <span><i className="legend-temp"/> Temperature</span>
      <span><i className="legend-rain"/> Rainfall</span>
      <span className="trend-extremes">High {high.toFixed(0)}° · Low {low.toFixed(0)}°</span>
    </div>
    <div className="trend-chart-scroll">
      <svg className="trend-svg" viewBox="0 0 960 174" role="img" aria-label="Hourly temperature line and rainfall bars">
        {[36, 74, 112].map((y) => (
          <line key={y} x1="16" x2="944" y1={y} y2={y} className="trend-gridline" />
        ))}
        {points.filter((point) => point.hasRain).map((point) => (
          <rect
            key={`rain-${point.time}`}
            x={point.x - 8}
            y={154 - point.rainHeight}
            width="16"
            height={point.rainHeight}
            rx="4"
            className="trend-rain-bar"
          />
        ))}
        <polyline points={temperaturePoints} className="trend-temp-line" />
        {points.filter((point) => point.hasTemperature).map((point) => (
          <g key={point.time}>
            <circle cx={point.x} cy={point.y} r="4.5" className="trend-temp-dot" />
            <text x={point.x} y={point.y - 12} textAnchor="middle" className="trend-temp-label">
              {Math.round(point.temperature)}°
            </text>
          </g>
        ))}
      </svg>
    </div>
    <div className="trend-time-labels">
      {points.map((point) => (
        <span key={point.time}>{new Date(point.time).toLocaleTimeString([], { hour: 'numeric' })}</span>
      ))}
    </div>
    <div className="trend-rain-summary">{rainfallSummary}</div>
  </div>;
}

export default function App() {
  const [location, setLocation] = useState(() => readStored('weatheros.location', DEFAULT_LOCATION));
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [records, setRecords] = useState([]);
  const [recordsError, setRecordsError] = useState('');
  const [activeTab, setActiveTab] = useState(() => readStored('weatheros.activeTab', 'Today'));
  const [startDate, setStartDate] = useState(() => readStored('weatheros.startDate', dateToday()));
  const [endDate, setEndDate] = useState(() => readStored('weatheros.endDate', addDays(4)));
  const [rangeData, setRangeData] = useState([]);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState('');
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState('');
  const [savedPlaces, setSavedPlaces] = useState(() => readStored('weatheros.savedPlaces', [DEFAULT_LOCATION, { ...DEFAULT_LOCATION, id: 'indore-default', name: 'Indore', latitude: 22.7196, longitude: 75.8577 }, { ...DEFAULT_LOCATION, id: 'delhi-default', name: 'Delhi', admin1: 'Delhi', latitude: 28.6139, longitude: 77.209 }]));

  const loadWeather = useCallback(async (loc = location) => {
    setLoading(true); setError('');
    try { const data = await api(`/api/weather?lat=${encodeURIComponent(loc.latitude)}&lon=${encodeURIComponent(loc.longitude)}`); setWeather(data); }
    catch (e) { setWeather(null); setError(e.message || 'Could not load weather. Check your connection and retry.'); }
    finally { setLoading(false); }
  }, [location]);
  const loadRecords = useCallback(async () => {
    try { const data = await api('/api/records'); setRecords(Array.isArray(data.records) ? data.records : []); setRecordsError(''); }
    catch (e) { setRecordsError(e.message || 'Could not load saved records.'); }
  }, []);
  useEffect(() => { loadWeather(location); loadRecords(); }, []); // restore the last selected location and persisted history
  useEffect(() => { try { localStorage.setItem('weatheros.location', JSON.stringify(location)); } catch { /* storage may be disabled */ } }, [location]);
  useEffect(() => { try { localStorage.setItem('weatheros.savedPlaces', JSON.stringify(savedPlaces)); } catch { /* storage may be disabled */ } }, [savedPlaces]);
  useEffect(() => { try { localStorage.setItem('weatheros.activeTab', JSON.stringify(activeTab)); } catch { /* storage may be disabled */ } }, [activeTab]);
  useEffect(() => { try { localStorage.setItem('weatheros.startDate', JSON.stringify(startDate)); } catch { /* storage may be disabled */ } }, [startDate]);
  useEffect(() => { try { localStorage.setItem('weatheros.endDate', JSON.stringify(endDate)); } catch { /* storage may be disabled */ } }, [endDate]);

  const searchLocations = async (event) => {
    event?.preventDefault();
    const value = query.trim(); if (value.length < 2) { setError('Enter at least two characters to search for a place.'); return; }
    setSearching(true); setMatches([]); setError('');
    try { const data = await api(`/api/geocode?q=${encodeURIComponent(value)}`); setMatches(data.results || []); if (!data.results?.length) setError(`No verified match found for “${value}”. Check the spelling or try adding the district, state or country. Postal codes may need their country or region.`); }
    catch (e) { setError(e.message); }
    finally { setSearching(false); }
  };
  const chooseLocation = (loc) => { setLocation(loc); setQuery(''); setMatches([]); setActiveTab('Today'); loadWeather(loc); setNotice(`Showing weather for ${loc.name}.`); };
  const useCurrentLocation = () => {
    setError('');
    if (!navigator.geolocation) { setError('Your browser does not support location access. Search for a city instead.'); return; }
    setNotice('Requesting your location…');
    navigator.geolocation.getCurrentPosition(async (position) => {
      const loc = { id: `gps-${position.coords.latitude.toFixed(4)}-${position.coords.longitude.toFixed(4)}`, name: 'Current location', admin1: '', country: '', latitude: position.coords.latitude, longitude: position.coords.longitude, timezone: 'auto' };
      try { const found = await api(`/api/geocode?q=${encodeURIComponent(`${loc.latitude}, ${loc.longitude}`)}`); if (found.results?.[0]) Object.assign(loc, { name: found.results[0].name, admin1: found.results[0].admin1, country: found.results[0].country }); } catch { /* coordinates still provide a valid weather location */ }
      chooseLocation(loc); setNotice('Weather loaded for your current coordinates.');
    }, (e) => { setError(e.code === 1 ? 'Location permission was denied. Allow location access or search for a city.' : 'Could not get your location. Check device location settings or search for a city.'); setNotice(''); }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  };
  const addSavedPlace = () => {
    if (savedPlaces.some((p) => Math.abs(p.latitude - location.latitude) < 0.001 && Math.abs(p.longitude - location.longitude) < 0.001)) { setNotice('This place is already in your saved places.'); return; }
    setSavedPlaces((old) => [...old, location]); setNotice(`${location.name} added to saved places.`);
  };
  const removeSavedPlace = (id) => { setSavedPlaces((old) => old.filter((p) => p.id !== id)); };

  const current = weather?.current;
  const daily = weather?.daily;
  const hourly = weather?.hourly;
  const todayIndex = daily?.time?.indexOf(current?.time?.slice(0, 10)) ?? 0;
  const chance = daily?.precipitation_probability_max?.[Math.max(0, todayIndex)] ?? null;
  const chanceLabel = weather?.provider === 'MET Norway'
    ? 'peak hourly rain chance'
    : 'chance of rain today';
  const air = weather?.airQuality?.current;
  const uvToday = daily?.uv_index_max?.[Math.max(0, todayIndex)] ?? null;
  const sunrise = daily?.sunrise?.[Math.max(0, todayIndex)];
  const sunset = daily?.sunset?.[Math.max(0, todayIndex)];
  const aqiLabel = air?.us_aqi == null ? 'Unavailable' : air.us_aqi <= 50 ? 'Good' : air.us_aqi <= 100 ? 'Moderate' : air.us_aqi <= 150 ? 'Sensitive groups' : air.us_aqi <= 200 ? 'Unhealthy' : air.us_aqi <= 300 ? 'Very unhealthy' : 'Hazardous';
  const nextHours = useMemo(() => {
    if (!hourly?.time || !current?.time) return [];
    let index = hourly.time.findIndex((t) => t >= current.time.slice(0, 13)); if (index < 0) index = 0;
    return hourly.time.slice(index, index + 12).map((time, i) => ({ time, temperature: hourly.temperature_2m?.[index + i], probability: hourly.precipitation_probability?.[index + i], precipitation: hourly.precipitation?.[index + i], code: hourly.weather_code?.[index + i], wind: hourly.wind_speed_10m?.[index + i] }));
  }, [hourly, current]);
  const nextRain = useMemo(() => nextHours.find((h) => Number(h.probability) >= 40 || Number(h.precipitation) >= 0.2) || null, [nextHours]);
  const rainExpected = Boolean(nextRain) || (chance !== null && chance >= 50);
  const availableRainHours = nextHours.filter((hour) => hour.precipitation != null && Number.isFinite(Number(hour.precipitation)));
  const next12Rain = availableRainHours.reduce((sum, hour) => sum + Number(hour.precipitation), 0);
  const next12RainLabel = availableRainHours.length === 0
    ? 'Rainfall data unavailable for the next 12 hours'
    : availableRainHours.length < nextHours.length
      ? `${next12Rain.toFixed(1)} mm recorded; some hourly rainfall data unavailable`
      : `${next12Rain.toFixed(1)} mm expected over next 12 hours`;
  const rainScaleMax = Math.max(
    0.1,
    ...availableRainHours.map((hour) => Number(hour.precipitation))
  );

  const fetchRange = async (start = startDate, end = endDate) => {
    if (start > end) { setRangeError('Start date must be on or before end date.'); return null; }
    setRangeLoading(true); setRangeError('');
    try { const data = await api(`/api/range?lat=${encodeURIComponent(location.latitude)}&lon=${encodeURIComponent(location.longitude)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`); setRangeData(data.days || []); return data.days || []; }
    catch (e) { setRangeError(e.message); setRangeData([]); return null; }
    finally { setRangeLoading(false); }
  };
  const saveRange = async () => {
    const days = await fetchRange(); if (!days) return;
    try {
      const result = await api('/api/records', { method: 'POST', body: JSON.stringify({ location, startDate, endDate, temperatures: days, summary: `${days.length} daily weather result(s) retrieved for ${location.name}.` }) });
      setRecords((old) => [result.record, ...old]); setNotice('Weather query saved to your history.'); setActiveTab('History');
    } catch (e) { setRangeError(e.message); }
  };
  const updateRecord = async (record) => {
    try {
      const range = await api(`/api/range?lat=${encodeURIComponent(record.location.latitude)}&lon=${encodeURIComponent(record.location.longitude)}&start=${encodeURIComponent(record.startDate)}&end=${encodeURIComponent(record.endDate)}`);
      const result = await api(`/api/records/${record.id}`, { method: 'PUT', body: JSON.stringify({ startDate: record.startDate, endDate: record.endDate, temperatures: range.days || [], summary: `${(range.days || []).length} daily weather result(s) retrieved for ${record.location.name}.` }) });
      setRecords((old) => old.map((r) => r.id === record.id ? result.record : r)); setEditing(null); setNotice('Record and its weather data updated.');
    } catch (e) { setRecordsError(e.message); }
  };
  const deleteRecord = async (id) => {
    if (!window.confirm('Delete this saved weather record? This cannot be undone.')) return;
    try { await api(`/api/records/${id}`, { method: 'DELETE' }); setRecords((old) => old.filter((r) => r.id !== id)); setNotice('Record deleted.'); }
    catch (e) { setRecordsError(e.message); }
  };
  const exportData = (format) => { window.location.href = `/api/export/${format}`; };

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#today" onClick={() => setActiveTab('Today')}><span>Weather</span>OS</a>
      <nav>{['Today', 'Forecast', 'Saved Places', 'History'].map((tab) => <button key={tab} className={`nav-item ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</button>)}</nav>
      <div className="top-actions"><button title="Search" onClick={() => document.getElementById('location-search')?.focus()}><Search /></button><span className="top-divider"/><button title="Refresh forecast" onClick={() => loadWeather()} disabled={loading}><RefreshCw className={loading ? 'spinning' : ''}/></button><button title="Use current location" onClick={useCurrentLocation}><LocateFixed /></button></div>
    </header>

    <div className="workspace">
      <aside className="sidebar panel">
        <div className="section-title"><h2>Find weather</h2><kbd>/</kbd></div>
        <form className="search-form" onSubmit={searchLocations}><Search size={19}/><input id="location-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search city, ZIP, landmark…" aria-label="Search city, ZIP code or landmark"/><button aria-label="Submit location search" disabled={searching}><span>{searching ? '…' : 'Go'}</span></button></form>
        {matches.length > 0 && <div className="search-results" role="listbox">{matches.map((m) => <button key={m.id} onClick={() => chooseLocation(m)}><MapPin size={17}/><span><strong>{m.name}</strong><small>{[m.admin1, m.country].filter(Boolean).join(', ')}</small></span></button>)}</div>}
        <button className="location-button" onClick={useCurrentLocation}><LocateFixed size={18}/> Use my current location</button>
        <div className="section-title saved-heading"><h2>Saved places</h2><span className="muted">{savedPlaces.length} places</span></div>
        <div className="saved-list">{savedPlaces.map((p) => <div key={p.id} className={`saved-place ${p.latitude === location.latitude && p.longitude === location.longitude ? 'selected' : ''}`}><button className="place-main" onClick={() => chooseLocation(p)}>{weatherIcon(2, 23)}<span><strong>{p.name}</strong><small>{[p.admin1, p.country].filter(Boolean).join(', ') || `${p.latitude.toFixed(2)}, ${p.longitude.toFixed(2)}`}</small></span></button><button className="remove-place" title={`Remove ${p.name}`} onClick={() => removeSavedPlace(p.id)}><X size={15}/></button></div>)}</div>
        <button className="add-place" onClick={addSavedPlace}><Plus size={17}/> Save current place</button>
        <div className="sidebar-note"><div className="note-icon"><Umbrella size={25}/></div><div><strong>Weather, when it matters.</strong><p>Live conditions and a forecast that helps you plan ahead.</p></div></div>
        <div className="data-credit">Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo <ExternalLink size={11}/></a></div>
      </aside>

      <main className="main-content">
        {(error || recordsError) && <div className="alert error-alert"><AlertTriangle size={20}/><div><strong>{error ? 'Weather request failed' : 'History request failed'}</strong><p>{error || recordsError}</p></div><button onClick={() => { if (error) loadWeather(); if (recordsError) loadRecords(); }} className="text-button">Retry</button></div>}
        {notice && <div className="notice"><Check size={16}/>{notice}<button onClick={() => setNotice('')} aria-label="Dismiss message"><X size={14}/></button></div>}

        {activeTab === 'Today' && <>
          <div className="hero-grid">
            <section className="location-intro"><div className="eyebrow"><MapPin size={18}/><span>YOUR WEATHER</span></div><h1>{location.name}</h1><p className="location-subtitle">{[location.admin1, location.country].filter(Boolean).join(', ') || `${location.latitude.toFixed(3)}°, ${location.longitude.toFixed(3)}°`}</p><div className="coordinates">{location.latitude.toFixed(3)}° · {location.longitude.toFixed(3)}°</div><button className="save-inline" onClick={addSavedPlace}><Plus size={15}/> Save this place</button></section>
            <section className="hero-card panel"><div className="hero-main"><div className="hero-icon">{current ? timedWeatherIcon(current.weather_code, 48, current.time, daily) : <Umbrella size={48}/>}</div><div className="hero-copy"><p className="eyebrow">{loading ? 'UPDATING FORECAST' : 'CURRENT CONDITIONS'}</p><div className="temperature">{current ? `${Math.round(current.temperature_2m)}°` : '—'}</div><h2>{current ? weatherLabel(current.weather_code) : loading ? 'Loading weather…' : 'Weather when it matters.'}</h2><p className="feels-like">{current ? `Feels like ${Math.round(current.apparent_temperature)}°C` : 'Live conditions for your selected location'}</p></div></div><div className="hero-divider"/><div className="umbrella-answer"><div className={`umbrella-mark ${rainExpected ? 'rain' : ''}`}><Umbrella size={30}/></div><span className="eyebrow">UMBRELLA CHECK</span><strong>{current ? (rainExpected ? 'Bring one.' : 'Probably not.') : 'Checking…'}</strong><p>{nextRain ? `Rain possible around ${new Date(nextRain.time).toLocaleTimeString([], { hour: 'numeric' })} · ${nextRain.probability ?? '—'}% chance` : chance === null ? 'Rain probability unavailable' : `${chance}% ${chanceLabel}`}</p><p>{next12RainLabel}</p></div></section>
          </div>
          <section className="metrics-grid">
            <Metric icon={<Thermometer/>} label="Feels like" value={current ? `${Math.round(current.apparent_temperature)}°C` : '—'} detail="Apparent temperature"/>
            <Metric icon={<Droplets/>} label="Humidity" value={current ? `${current.relative_humidity_2m}%` : '—'} detail="Relative humidity"/>
            <Metric icon={<Wind/>} label="Wind" value={current ? `${Math.round(current.wind_speed_10m)} km/h` : '—'} detail={current ? `${current.wind_direction_10m}° direction` : 'Wind speed'}/>
            <Metric icon={<CloudRain/>} label="Precipitation (current hour)" value={current?.precipitation == null ? '—' : `${Number(current.precipitation).toFixed(1)} mm`} detail="Amount recorded in the current forecast interval"/>
          </section>
          <section className="metrics-grid extended-metrics">
            <Metric icon={<Sun/>} label="UV index" value={uvToday == null ? '—' : uvToday.toFixed(1)} detail={uvToday == null ? 'Unavailable' : uvToday < 3 ? 'Low exposure' : uvToday < 6 ? 'Moderate · use protection' : uvToday < 8 ? 'High · protect your skin' : 'Very high · limit exposure'}/>
            <Metric icon={<Wind/>} label="Air quality · US AQI" value={air?.us_aqi ?? '—'} detail={aqiLabel}/>
            <Metric icon={<Sun/>} label="Sunrise" value={sunrise ? new Date(sunrise).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'} detail="Local time"/>
            <Metric icon={<Sun/>} label="Sunset" value={sunset ? new Date(sunset).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'} detail="Local time"/>
          </section>
          <section className="panel content-panel">
            <div className="panel-heading">
              <div><p className="eyebrow">RAIN OUTLOOK</p><h2>Next 12-hour rainfall timeline</h2></div>
              <span className="muted">Precipitation · mm</span>
            </div>
            {nextHours.length ? (
              <div className="rain-timeline">
                {nextHours.map((h) => {
                  const valid = h.precipitation != null && Number.isFinite(Number(h.precipitation));
                  const amount = valid ? Math.max(0, Number(h.precipitation)) : 0;
                  const height = amount > 0
                    ? Math.max(8, (Math.log1p(amount) / Math.log1p(rainScaleMax)) * 100)
                    : 0;

                  return (
                    <div className="rain-bar-item" key={h.time}>
                      <span>{new Date(h.time).toLocaleTimeString([], { hour: 'numeric' })}</span>
                      <div className="rain-bar-track">
                        <i
                          title={valid ? `${amount.toFixed(2)} mm` : 'Data unavailable'}
                          style={{
                            height: `${height}%`,
                            opacity: amount > 0 ? 1 : 0.25
                          }}
                        />
                      </div>
                      <b>{valid ? amount.toFixed(1) : '—'}</b>
                    </div>
                  );
                })}
              </div>
            ) : <EmptyState loading={loading} text="Rainfall timeline unavailable."/>}
          </section>
          <section className="panel content-panel"><div className="panel-heading"><div><p className="eyebrow">TEMPERATURE &amp; RAIN OUTLOOK</p><h2>How conditions change over the next 12 hours</h2></div><span className="muted">°C · mm</span></div>{nextHours.length ? <TemperatureRainChart hours={nextHours}/> : <EmptyState loading={loading} text="Temperature trend unavailable."/>}</section>
          <section className="panel content-panel"><div className="panel-heading"><div><p className="eyebrow">PLAN AHEAD</p><h2>Next 12 hours</h2></div><span className="muted">Hourly forecast</span></div>{nextHours.length ? <div className="hourly-strip">{nextHours.map((h) => <div className="hour-item" key={h.time}><span className="hour-time">{new Date(h.time).toLocaleTimeString([], { hour: 'numeric' })}</span>{timedWeatherIcon(h.code, 23, h.time, daily)}<strong>{h.temperature == null ? '—' : `${Math.round(h.temperature)}°`}</strong><span className={`rain-chance ${h.probability >= 35 ? 'wet' : ''}`}><Droplets size={12}/>{h.probability ?? '—'}%</span></div>)}</div> : <EmptyState loading={loading} text="Hourly forecast will appear when weather data loads."/>}</section>
          <section className="panel content-panel"><div className="panel-heading"><div><p className="eyebrow">THE WEEK AHEAD</p><h2>5-day forecast</h2></div><button className="text-button" onClick={() => setActiveTab('Forecast')}>Full forecast <ExternalLink size={14}/></button></div>{daily?.time ? <div className="daily-list">{daily.time.map((date, i) => <div className="daily-row" key={date}><span className="daily-day">{i === 0 ? 'Today' : dateLabel(date, { weekday: 'long' })}</span><span className="daily-condition">{weatherIcon(daily.weather_code[i], 22)}<span>{weatherLabel(daily.weather_code[i])}</span></span><span className="daily-rain"><Droplets size={14}/>{daily.precipitation_probability_max?.[i] ?? '—'}%</span><div className="temp-range"><span>{Math.round(daily.temperature_2m_min[i])}°</span><div className="temp-track"><i style={{ left: `${Math.max(0, Math.min(100, (daily.temperature_2m_min[i] + 10) * 2.5))}%`, width: `${Math.max(8, Math.min(85, (daily.temperature_2m_max[i] - daily.temperature_2m_min[i]) * 2.5))}%` }}/></div><strong>{Math.round(daily.temperature_2m_max[i])}°</strong></div></div>)}</div> : <EmptyState loading={loading} text="The five-day forecast will appear here."/>}</section>
          <section className="api-extras"><div className="panel extra-card"><Map size={20}/><div><strong>Explore the area</strong><p>Open the selected location in Google Maps.</p><a href={`https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`} target="_blank" rel="noreferrer">View map <ExternalLink size={13}/></a></div></div><div className="panel extra-card"><Youtube size={20}/><div><strong>See the destination</strong><p>Find recent videos about this place.</p><a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(location.name + ' ' + (location.country || '') + ' travel')}`} target="_blank" rel="noreferrer">Watch videos <ExternalLink size={13}/></a></div></div></section>
        </>}

        {activeTab === 'Forecast' && <><PageHeading icon={<CalendarDays/>} eyebrow="PLAN WITH CONFIDENCE" title="Forecast explorer" description="Review the five-day outlook and save a date-range weather query to your history."/><section className="panel content-panel"><div className="panel-heading"><div><p className="eyebrow">DAILY OUTLOOK</p><h2>{location.name} · 5 days</h2></div><button className="text-button" onClick={() => loadWeather()}><RefreshCw size={14}/> Refresh</button></div>{daily?.time ? <div className="forecast-cards">{daily.time.map((date, i) => <div className="forecast-day" key={date}><span>{dateLabel(date)}</span><div className="forecast-day-icon">{weatherIcon(daily.weather_code[i], 32)}</div><strong>{Math.round(daily.temperature_2m_max[i])}° <small>/ {Math.round(daily.temperature_2m_min[i])}°</small></strong><p>{weatherLabel(daily.weather_code[i])}</p><span className="forecast-rain"><Droplets size={14}/>{daily.precipitation_probability_max?.[i] ?? '—'}% rain</span></div>)}</div> : <EmptyState loading={loading} text="Forecast unavailable. Retry from the top bar."/>}</section>
          <section className="panel content-panel"><div className="panel-heading"><div><p className="eyebrow">DATABASE · CREATE</p><h2>Save a weather query</h2></div><History size={20}/></div><p className="panel-description">Choose a location and date range. WeatherOS validates the range, retrieves real weather data, and stores the result for later review.</p><div className="form-grid"><label>Location<input value={locationName(location)} readOnly/></label><label>Start date<input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)}/></label><label>End date<input type="date" value={endDate} min={startDate} max={addDays(15)} onChange={(e) => setEndDate(e.target.value)}/></label><button className="primary-button" onClick={saveRange} disabled={rangeLoading}>{rangeLoading ? 'Retrieving…' : 'Retrieve & save weather'}</button></div>{rangeError && <div className="inline-error"><AlertTriangle size={16}/>{rangeError}</div>}{rangeData.length > 0 && <RangeTable days={rangeData}/>}</section></>}

        {activeTab === 'Saved Places' && <><PageHeading icon={<MapPin/>} eyebrow="YOUR SHORTLIST" title="Saved places" description="Quickly switch between the locations you want to keep an eye on."/><div className="place-grid">{savedPlaces.map((p) => <div className="panel place-card" key={p.id}><div className="place-card-icon">{weatherIcon(2, 26)}</div><h3>{p.name}</h3><p>{[p.admin1, p.country].filter(Boolean).join(', ') || 'GPS location'}</p><span className="muted coordinates">{p.latitude.toFixed(3)}°, {p.longitude.toFixed(3)}°</span><div className="place-card-actions"><button className="primary-button" onClick={() => chooseLocation(p)}>View weather</button><button className="icon-button" title="Remove place" onClick={() => removeSavedPlace(p.id)}><Trash2 size={16}/></button></div></div>)}<button className="panel add-place-card" onClick={addSavedPlace}><Plus size={25}/><strong>Save current location</strong><span>Add {location.name} to this list</span></button></div></>}

        {activeTab === 'History' && <><PageHeading icon={<History/>} eyebrow="PERSISTED QUERIES" title="Weather history" description="Previously requested date ranges, saved in the backend. Edit dates, delete records, or export your data."/><section className="panel content-panel"><div className="panel-heading"><div><p className="eyebrow">DATABASE · READ / UPDATE / DELETE</p><h2>{records.length} saved {records.length === 1 ? 'record' : 'records'}</h2></div><div className="export-actions"><button className="secondary-button" onClick={() => exportData('json')}><Download size={15}/> JSON</button><button className="secondary-button" onClick={() => exportData('csv')}><Download size={15}/> CSV</button></div></div>{recordsError && <div className="inline-error">{recordsError}<button className="text-button" onClick={loadRecords}>Retry</button></div>}{records.length === 0 ? <EmptyState text="No saved weather queries yet. Go to Forecast and save your first date range."/> : <div className="records-list">{records.map((r) => <article className="record-row" key={r.id}>{editing?.id === r.id ? <div className="edit-record"><label>Start<input type="date" value={editing.startDate} max={editing.endDate} onChange={(e) => setEditing({ ...editing, startDate: e.target.value })}/></label><label>End<input type="date" value={editing.endDate} min={editing.startDate} max={addDays(15)} onChange={(e) => setEditing({ ...editing, endDate: e.target.value })}/></label><div className="record-actions"><button className="icon-button success" title="Save changes" onClick={() => updateRecord(editing)}><Check size={17}/></button><button className="icon-button" title="Cancel" onClick={() => setEditing(null)}><X size={17}/></button></div></div> : <><div className="record-icon">{weatherIcon(r.temperatures?.[0]?.code, 24)}</div><div className="record-info"><strong>{r.location?.name || 'Unknown location'}</strong><span>{r.startDate} → {r.endDate}</span><small>{r.summary || `${r.temperatures?.length || 0} daily weather results`} · Saved {new Date(r.createdAt).toLocaleDateString()}</small>{r.temperatures?.length > 0 && <div className="record-temp">{r.temperatures.slice(0, 5).map((d) => <span key={d.date}>{dateLabel(d.date, { weekday: 'short' })}: <b>{d.high ?? '—'}°</b> / {d.low ?? '—'}°</span>)}</div>}</div><div className="record-actions"><button className="icon-button" title="Edit date range" onClick={() => setEditing({ ...r })}><Pencil size={16}/></button><button className="icon-button danger" title="Delete record" onClick={() => deleteRecord(r.id)}><Trash2 size={16}/></button></div></>}</article>)}</div>}</section></>}

        <footer className="footer"><span>WeatherOS · Built by <strong>Shaurya Anurag</strong></span><span className="pma-credit"><strong>PM Accelerator</strong> supports product-management careers through training, coaching, and a professional community. <a href="https://www.linkedin.com/school/pmaccelerator/" target="_blank" rel="noreferrer">About PM Accelerator <ExternalLink size={11}/></a></span><span>Weather data from Open-Meteo · <a href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer">API documentation <ExternalLink size={11}/></a></span></footer>
      </main>
    </div>
  </div>;
}

function Metric({ icon, label, value, detail }) { return <div className="panel metric-card"><div className="metric-top">{icon}<span>{label}</span></div><strong>{value}</strong><small>{detail}</small></div>; }
function EmptyState({ loading = false, text }) { return <div className="empty-state">{loading ? <RefreshCw className="spinning" size={20}/> : <Cloud size={23}/>}<p>{loading ? 'Loading live data…' : text}</p></div>; }
function PageHeading({ icon, eyebrow, title, description }) { return <div className="page-heading"><div className="page-heading-icon">{icon}</div><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div></div>; }
function RangeTable({ days }) { return <div className="range-results"><h3>Retrieved daily temperatures</h3><div className="range-list">{days.map((d) => <div key={d.date}><span>{dateLabel(d.date)}</span><span>{weatherLabel(d.code)}</span><strong>{d.high == null ? '—' : `${Math.round(d.high)}°`} <small>/ {d.low == null ? '—' : `${Math.round(d.low)}°`}</small></strong><span className="muted">{d.source}</span></div>)}</div></div>; }
