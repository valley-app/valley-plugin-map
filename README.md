# Map

Interactive map for favorite places and route planning: a left-sidebar list of saved places and routes, a full-workspace map, and a right-sidebar route planner with travel modes, distance/ETA and an elevation profile. Uses free providers by default; optional Mapbox, OpenRouteService, and community Map connections are managed under Accounts.

This repository owns the plugin’s interface, behavior, dependencies, schemas, tests, translations, and compiled releases. It uses Valley manifest API 5 and the injected SDK 6.

## Map files

Open `.gpx`, `.kml`, or `.geojson` files in independent, read-only map tabs. Each tab fits its file automatically and provides pan, zoom, fit-to-content, and click-to-inspect feature details. File changes reload the geometry without changing the camera. Opening a file never imports it into saved places or routes.

- GPX: waypoints, routes, and tracks, including disconnected track segments.
- KML: points, paths, polygons with holes, MultiGeometry, and tracks. Linked content, image overlays, and 3D models are omitted with a notice.
- GeoJSON: geometries, features, and feature collections, including multipart geometries and geometry collections. Coordinates must use WGS84 longitude/latitude.

Rendering uses the configured basemap. Authored simplestyle colours, widths, and opacities (including converted KML styles) are kept; unstyled features use Map's route colour. Feature details show the geometry, coordinates, elevation, length, climb, and start/end times, followed by the file's own properties; styling and converter bookkeeping are hidden and descriptions are displayed as plain text. Files are never modified. Existing route import/export commands are unchanged.

## Appearance and details

The round control on the map switches between Light and Dark only. System, which follows Valley's appearance, is chosen in the right-sidebar Map mode field; both controls show the same mode. On the map page, the footer's Coordinates and Address describe the same point as the header, the map centre.

Valley ships this core plugin as a verified release artifact in its application resources. Core and external installations run with the same sandbox, permissions, and SDK/IPC contract. The core package and its locale files are never installed into `.valley`; ordinary vault documents and saved plugin data retain their existing locations.

## Map pins

Map pins settings offers searchable source cards with chevrons for expandable details, folder filtering, coordinate or address properties, labels, and hover fields. Switching between the default address and coordinate modes also updates the default property name; custom property names are retained.

Settings and the left sidebar share the saved source order; drag the grips or use their arrow keys to reorder. Each source list has a standard-height header with an All sources visibility switch. Hidden and empty source definitions remain saved.

Pin artwork lives in `.valley/assets/icon/map-icon/`. The eight bundled SVGs are added only when missing, preserving user edits. Add your own SVG files there, then choose them with the source's icon button. The searchable picker offers Open icon folder and Refresh; SVG edits update the sidebar and map pins. Invalid SVGs are reported and executable or external SVG content is removed before rendering.

## Package

- `manifest.json`: readable English identity, version, and paired `author` / `authorUrl` arrays.
- `config.json`: runtime entry points, permissions, contributions, and storage declarations.
- `src/`: plugin interface and background engine.
- `locales/`: English, German, Spanish, French, and Simplified Chinese catalogs.
- `tests/`: package-owned checks using the portable SDK testkit.
- `runtime/`: compiled installation artifact, including the package’s locale catalogs.
- `vendor/`: pinned SDK, testkit, and build-tool archives for independent development.

The package’s `manifest.name` and `manifest.description` catalog entries translate its identity, including while disabled. Missing translations fall back to this package’s English catalog. A plugin never falls back to Valley’s catalog or another plugin’s catalog.

## Development and releases

Use Node 24.19.0 and npm 11.17.0. From this repository, run:

```sh
npm ci
npm run check
```

The standalone rendering check uses synthetic in-memory files in a sandboxed browser frame and the compiled map runtime. It does not launch the application or access a vault:

```sh
npm run build
npx playwright install chromium
npm run test:render
```

To use an installed Chrome instead, run `MAP_TEST_BROWSER_CHANNEL=chrome npm run test:render`. The browser uses a temporary isolated profile; all external requests are blocked. The check verifies points, lines, polygon holes, track gaps, feature details, independent tab controls, file updates, and cleanup in light and dark themes, and saves screenshots to a temporary directory.

The check validates types and package boundaries, runs the package tests, and rebuilds `runtime/`. It requires no Valley source checkout. Keep the rebuilt runtime, locale files, dependency lock, and vendored tools with each release. Increment the package and manifest versions together.

Valley release maintainers explicitly import the compiled artifact into the application’s `plugins.lock.json`; building Valley does not build or read this repository. All privileged work uses declared SDK capabilities, authenticated IPC, and explicit grants. Disabling or unloading the plugin releases its subscriptions and resources.

Measurements in Map settings updates shared vault units for distance, elevation, area, large area, speed, pace, and coordinates. Changes apply live across map views and other plugins without moving the map camera.

## Maps sidebar extensions

The `map.sidebarTab@1.0.0` extension lets other plugins add an icon and a panel through Valley interop IPC. Declare it in `provides`, keep a self-contained copy of `src/sidebarContract.ts`, and publish a descriptor with `id`, `label`, SVG path icon, `getSnapshot`, `subscribe` and async `run`. Snapshots contain fields, actions, result rows, busy/error/status text. Optional `setActive` lets a provider suspend polling when its tab is hidden. Unregister and release timers on plugin disposal. The SBB plugin uses this contract.

Drag sidebar icons or use Alt+Left/Right to reorder. `sidebarTabOrder` persists through the settings SDK and retains positions for temporarily disabled plugins. Wheel scrolling over a Markdown map fence scrolls the note; map zoom controls remain explicit. Geographic file views use the host breadcrumb only; read-only status appears in Info.

## Embedded maps

Settings → Map → Embed and Codeblock each have independent provider, map style, and appearance defaults. File embeds accept pipe overrides: `![[route.gpx|satellite|mapbox|light]]` (also KML and GeoJSON). Supported styles are `streets`, `satellite`, `navigation`, and `outdoors`; use `free` or `mapbox` as the provider and `system`, `light`, or `dark` for appearance. A missing or unusable account falls back to free maps; navigation and outdoors then use streets.

Map code blocks accept the same pipe options after coordinates or in the fence metadata, and named lines:

```map
47.3769, 8.5417
zoom: 14
style: satellite
provider: mapbox
theme: light
```

Scrolling the note preserves a static copy of the last map while its interactive renderer is suspended. Drag to pan and use the +/− controls to zoom. Wheel scrolling moves the note without zooming the map.
