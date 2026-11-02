# WeatherOS

### Full-Stack AI Engineer Intern Technical Assessment
**PM Accelerator**

**A full-stack weather intelligence application built with React, Vite, Node.js, Express, and SQLite.**

WeatherOS retrieves live weather information, presents current conditions and forecasts, and allows users to save, manage, and export weather-query history. It integrates external weather and location services with a persistent backend.

No weather API key is required.

## Features

### Weather Dashboard

- Search locations by city, town, landmark, or postal/place name.
- Retrieve weather for the current location using browser geolocation.
- Display current temperature, feels-like temperature, humidity, wind speed, and precipitation.
- View hourly weather conditions and a five-day forecast.
- Explore rainfall trends and weather visualizations.
- View additional environmental information, including UV index and air quality, where available.
- Display weather conditions using context-aware icons.
- Provide loading, empty-search, validation, network-error, and retry states.

### Location Management

- Search and switch between locations.
- Save frequently accessed places.
- Restore saved places and the previously selected location after refreshing the application.
- Access location-related Google Maps links and YouTube video searches.

### Weather History

- Retrieve daily weather data for a selected location and date range.
- Save weather queries and their retrieved results.
- View previously saved records.
- Update existing records with a revised date range and refreshed weather data.
- Delete saved records.
- Export stored weather-query data as JSON or CSV.

## Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | React, Vite, JavaScript |
| UI and Visualization | CSS, CSS Grid, Flexbox, lucide-react |
| Backend | Node.js, Express |
| Database | SQLite (`node:sqlite`) |
| Weather and Geocoding | Open-Meteo APIs |
| Location and Media Integrations | Google Maps, YouTube |
| Browser Persistence | localStorage |

## Architecture

WeatherOS follows a frontend–backend architecture.

**Frontend — React + Vite**

Responsible for the weather dashboard, location search, forecast visualization, saved places, and weather-history interface.

**Backend — Node.js + Express**

Handles API requests, location geocoding, weather retrieval, input validation, database operations, and data exports.

**Database — SQLite**

Stores weather-query records, including location information, coordinates, requested date ranges, retrieved daily weather data, summaries, and timestamps.

**External Services**

- Open-Meteo provides geocoding, current weather, forecast, and historical weather data.
- Google Maps provides location links.
- YouTube provides location-related video searches.
- OpenStreetMap/Nominatim may be used as a geocoding fallback where configured.

During development, Vite proxies API requests to the Express backend. In production, Express serves the built frontend and API from the same server.

## API Documentation

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | API and database health status |
| GET | `/api/geocode?q=<location>` | Search for locations |
| GET | `/api/weather?lat=<lat>&lon=<lon>` | Retrieve current conditions, hourly data, and five-day forecast |
| GET | `/api/range?lat=<lat>&lon=<lon>&start=YYYY-MM-DD&end=YYYY-MM-DD` | Retrieve daily weather for a date range |
| GET | `/api/records` | Retrieve saved weather records |
| POST | `/api/records` | Create a weather-query record |
| PUT | `/api/records/:id` | Update an existing record |
| DELETE | `/api/records/:id` | Delete a record |
| GET | `/api/export/json` | Export stored records as JSON |
| GET | `/api/export/csv` | Export stored records as CSV |

### Backend Capabilities

- RESTful API design with JSON responses and HTTP status codes.
- Request validation and consistent error responses.
- CRUD operations backed by SQLite.
- Validation of coordinates, ISO date formats, date ordering, maximum date-range length, forecast horizon, and location objects.
- Retrieval of historical daily weather through Open-Meteo's Historical Weather API.
- Retrieval of current and future daily weather through Open-Meteo's forecast API.
- JSON and CSV data exports.
- Database health reporting through the health endpoint.

## Database and Persistence

Weather-query history is stored in SQLite.

The database is initialized automatically when the backend starts:

```text
server/data/weatheros.sqlite
```

Each saved record contains:

- Location information and coordinates.
- Requested start and end dates.
- Retrieved daily weather payload.
- Weather summary.
- Creation and update timestamps.

The database path can be customized using the `WEATHEROS_DB_PATH` environment variable.

The application also uses browser `localStorage` to restore the selected location, saved places, active tab, and date-range inputs after refresh. Live weather is fetched again for the restored location rather than relying on stale cached conditions.

## Installation and Setup

### Requirements

- Node.js **22.5 or newer**.
- npm.
- Internet access for live weather and geocoding requests.

Node.js 22.5+ is required because the backend uses the built-in `node:sqlite` module.

### Development

Clone the repository and install dependencies:

```bash
npm install
```

Start the application:

```bash
npm run dev
```

Open:

[http://127.0.0.1:5173](http://127.0.0.1:5173)

The Vite development server runs on port `5173` and proxies `/api` requests to the Express backend on port `4000`.

### Production

Build the frontend:

```bash
npm run build
```

Start the production server:

```bash
npm start
```

Express serves the production frontend from `dist/` alongside the API on port `4000`.

### Automated Tests

Run the API integration tests:

```bash
npm test
```

The test suite uses a temporary SQLite database and covers the health endpoint, request validation, CRUD operations, and JSON/CSV exports.

The automated tests do not call external weather services. Live provider availability, browser geolocation, and responsive layouts require separate manual verification.

## Data Sources and Limitations

- [Open-Meteo](https://open-meteo.com/) — geocoding and current/forecast weather.
- [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api) — historical daily weather.
- [OpenStreetMap](https://www.openstreetmap.org/) / Nominatim — geocoding fallback, where configured.

Forecast date ranges are limited by the forecast horizon supported by Open-Meteo. Historical dates are retrieved through the archive API.

Browser geolocation requires user permission and may require HTTPS outside localhost.

WeatherOS is a local assessment demonstration rather than a multi-user production deployment. It does not currently implement authentication or user-level row security.

## Project Information

**Developed by Shaurya Anurag**

Built as part of the **PM Accelerator AI Engineer Intern Technical Assessment**, covering both frontend application development and backend engineering.

### About PM Accelerator

[PM Accelerator](https://www.linkedin.com/school/pmaccelerator/) supports product-management professionals through training, coaching, skill development, and a professional community.
