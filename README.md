# Freight Dispatch

A freight dispatch game in the style of Mission Chief. You start with a free hub you place on the map, a cargo van and a hired driver, take delivery jobs on a real street map, and grow into a trucking company. Trucks follow real roads, and the map shows the route each one is driving.

## Play it on GitHub Pages

1. Put these files in the root of your repository: `index.html`, `style.css`, `data.js`, `game.js`.
2. On GitHub, open the repository's **Settings**, then **Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*, pick the `main` branch and the `/ (root)` folder, and save.
4. After a minute, the game is live at `https://<your-username>.github.io/<repository-name>/`.

Progress saves in your browser, so each device keeps its own company for now.

## How it works

| File | What it holds |
| --- | --- |
| `index.html` | Page layout: header, map, side panel, start screen |
| `style.css` | All styling |
| `data.js` | Cities, cargo types, businesses, trucks, prices and unlock levels |
| `game.js` | Job generation, dispatching, pay, drivers, saving, offline progress, and the map |

**Map:** [Leaflet](https://leafletjs.com) with OpenStreetMap tiles.
**Road routes:** the public [OSRM](https://project-osrm.org) demo server. When you open a job, the game asks OSRM for the real driving route and quotes the pay by road miles.

## Before many people play

The OpenStreetMap tile server and the OSRM demo server are free shared services meant for light use. Once the game has real traffic, switch to a provider with a free tier and an API key:

- **Map tiles:** MapTiler, Stadia Maps or Thunderforest. Change `TILE_URL` and `TILE_ATTR` at the top of `game.js`.
- **Routing:** OpenRouteService, GraphHopper or Mapbox Directions. Change `ROUTER` and the parsing in `getRoute()`.

Accounts, shared alliances and server-side offline progress will need a backend later (for example Supabase or Firebase).

## Tuning

Prices, capacities, ranges and unlock levels live in `data.js`. The pay formula is `payFor()` in `game.js`, and travel time is in `planTrip()` (trucks: 1 minute + 1 minute per 30 road miles).
