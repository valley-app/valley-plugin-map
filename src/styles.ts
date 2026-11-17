import maplibreCss from 'maplibre-gl/dist/maplibre-gl.css'

// All colours use the app's real design tokens (src/renderer/src/styles/tokens.css)
// so the plugin tracks both light and dark themes; overlay cards sit on the map,
// so they use opaque surface backgrounds.
const CSS = `
.map-panel .panel-body { padding:0 0 12px; }
.map-planner .panel-body { padding:6px 0 14px; }
.map-open-page { display:inline-flex; align-items:center; gap:4px; padding:3px 7px; font-size:0.6875rem;
  font-weight:600; cursor:pointer; border-radius:5px; border:1px solid var(--border-medium);
  background:none; color:var(--text-secondary); -webkit-app-region:no-drag; }
.map-open-page:hover { background:var(--hover-bg); color:var(--text-color); }
.map-open-page svg { width:12px; height:12px; }

.map-empty { padding:14px; color:var(--text-secondary); font-size:0.75rem; line-height:1.5;
  display:flex; gap:6px; align-items:flex-start; }
.map-empty svg { width:15px; height:15px; flex-shrink:0; margin-top:1px; }
.map-error { margin:8px 12px; padding:8px 10px; border-radius:6px; font-size:0.75rem;
  color:var(--tint-red-text, #b91c1c); background:var(--tint-red-bg, rgba(185,28,28,.08)); }
.map-notice { margin:8px 12px 0; font-size:0.6875rem; color:var(--text-secondary); }
.map-hint { padding:3px 2px 0; font-size:0.6875rem; color:var(--text-tertiary, var(--text-secondary)); }

/* ---- tab strip + rows (sidebar) ------------------------------------- */
/* Its own row under the panel header — same treatment as the clock plugin's
   tab strip, so both panels read as one system. */
.map-extension-form { padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-3); }
.map-extension-form label { display: flex; flex-direction: column; gap: var(--space-1); color: var(--text-secondary); }
.map-extension-form .map-place-actions { flex-wrap: wrap; }
.map-extension-form .map-place-actions .map-btn { flex: 1 0 auto; }
.map-extension-form .search-field-row { padding: 0; border-bottom: 1px solid transparent; }
.map-extension-form input { min-width: 0; width: 100%; color: var(--text-color); background: transparent; border: 0; outline: 0; box-shadow: none; }
/* ---- journey planner (sidebar tabs such as SBB) --------------------- */
.map-journey { display:flex; flex-direction:column; min-height:0; }
/* Segments never shrink: a narrow sidebar scrolls them sideways, with no visible scrollbar. */
.map-journey-segments { position:sticky; top:0; z-index:3; display:flex; align-items:center; gap:2px; height:var(--app-bar-height); box-sizing:border-box; flex-shrink:0; background:var(--container-color);
  overflow-x:auto; overflow-y:hidden; overscroll-behavior-x:contain; scrollbar-width:none;
  padding:0 var(--space-2, 8px); border-bottom:1px solid var(--border-light); }
.map-journey-segments::-webkit-scrollbar { display:none; }
.map-journey-segment { flex:0 0 auto; height:var(--shell-control-toolbar, 26px); padding:0 6px; border:none; border-radius:var(--shell-control-radius, var(--radius-sm));
  background:transparent; color:var(--text-secondary); font:inherit; font-size:var(--small-font-size); font-weight:var(--font-semi-bold);
  white-space:nowrap; cursor:pointer; -webkit-app-region:no-drag; }
.map-journey-segment:hover:not(:disabled) { background:var(--hover-bg); color:var(--text-color); }
.map-journey-segment.active, .map-journey-segment.active:hover:not(:disabled) { background:var(--accent-tint-bg); color:var(--title-color); }
.map-journey-segment:disabled { opacity:.45; cursor:default; }
.map-journey-body { display:flex; flex-direction:column; gap:8px; padding:8px; }
.map-route-card { display:flex; flex-direction:column; border:1px solid var(--border-light); border-radius:8px; background:var(--container-color-alt); }
.map-route { display:flex; align-items:center; gap:4px; }
/* Starts where the stop rows start (their 10px inset); the date and time fields are only as wide as a ten-character date or HH:mm plus the icon. */
.map-route-when { display:flex; flex-wrap:wrap; align-items:center; gap:6px; min-height:36px; padding:4px 4px 4px 10px; box-sizing:border-box; border-top:1px solid var(--border-light); }
.map-route-when-field { min-width:0; }
.map-route-when-field.is-date { flex:0 0 auto; width:calc(8.5ch + 48px); }
.map-route-when-field.is-time { flex:0 0 auto; width:calc(4ch + 46px); }
.map-route-when-field > * { min-width:0 !important; width:100% !important; max-width:100%; }
.map-route-when-mode { display:flex; gap:2px; flex:0 0 auto; }
.map-route-when-mode button { height:26px; padding:0 8px; border:0; border-radius:var(--radius-sm); background:transparent; color:var(--text-secondary); font:inherit; font-size:var(--small-font-size); white-space:nowrap; cursor:pointer; }
.map-route-when-mode button:hover:not(:disabled) { background:var(--hover-bg); color:var(--text-color); }
.map-route-when-mode button.active, .map-route-when-mode button.active:hover:not(:disabled) { background:var(--accent-tint-bg); color:var(--title-color); }
.map-route-when-now { display:grid; place-items:center; flex:0 0 auto; width:28px; height:28px; margin-left:auto; padding:0; border:0; border-radius:50%; background:transparent; color:var(--text-secondary); cursor:pointer; }
.map-route-when-now svg { width:16px; height:16px; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
.map-route-when-now:hover:not(:disabled) { color:var(--text-color); background:var(--hover-bg); }
.map-route-ring.is-location { border-color:var(--accent-color); box-shadow:inset 0 0 0 2px var(--container-color-alt); background:var(--accent-color); }
.map-journey-more { width:100%; height:37px; box-sizing:border-box; padding:0 10px; border:1px solid var(--border-light); border-radius:8px; background:var(--container-color-alt);
  color:var(--text-color); font:inherit; font-size:0.78125rem; cursor:pointer; }
.map-journey-more:hover:not(:disabled) { background:var(--hover-bg); }
.map-journey-day { padding:4px 2px 0; font-size:0.71875rem; color:var(--text-secondary); }
.map-occupancies { display:inline-flex; align-items:center; gap:8px; }
.map-occupancy { display:inline-flex; align-items:center; gap:1px; }
.map-occupancy > span { margin-right:2px; }
.map-occupancy svg { width:5px; height:10px; fill:currentColor; opacity:.35; }
.map-occupancy svg.is-on { opacity:1; }
.map-journey-track.is-timed { display:block; }
.map-journey-track.is-timed .map-journey-track-dot.is-end { position:absolute; top:1px; left:0; }
.map-journey-track.is-timed .map-journey-track-dot.is-end:last-child { left:auto; right:0; }
.map-journey-track-dot.is-placed { position:absolute; top:1px; transform:translateX(-50%); }
.map-route-stops { flex:1; min-width:0; display:flex; flex-direction:column; }
.map-route-stop { position:relative; display:flex; align-items:center; gap:8px; min-height:36px; padding:0 4px 0 10px; cursor:text; }
.map-route-stop + .map-route-stop input { border-top:1px solid var(--border-light) !important; }
.map-route-stop input { flex:1; min-width:0; align-self:stretch; padding:0; font:inherit; font-size:0.8125rem; color:var(--text-color);
  background:transparent; border:0; outline:0; box-shadow:none; }
.map-route-stop input:focus, .map-route-stop input:focus-visible { outline:0; box-shadow:none; }
.map-route-stop input::placeholder { color:var(--text-tertiary, var(--text-secondary)); }
.map-route-stop.is-via { min-height:30px; }
.map-route-stop.is-via input { font-size:0.75rem; }
.map-route-stop.is-location input { color:var(--accent-color); }
/* Stops reorder by dragging: the source row dims, a chip follows the pointer and the shared insertion line with its dot marks the gap. */
.map-route-stops { position:relative; }
.map-route-stops.is-reordering, .map-route-stops.is-reordering * { cursor:grabbing !important; user-select:none; }
.map-route-stop.is-dragged { opacity:.35; }
.map-route-drop { position:absolute; z-index:3; left:4px; right:4px; height:var(--drop-knob, 8px); transform:translateY(-50%);
  background:var(--drop-indicator-fill, var(--accent-color)); pointer-events:none; }
.map-route-chip { position:fixed; z-index:50; display:flex; align-items:center; gap:8px; max-width:260px; height:30px; padding:0 12px 0 9px; box-sizing:border-box;
  border:1px solid var(--border-light); border-radius:15px; background:var(--container-color-alt); color:var(--text-color);
  box-shadow:0 6px 18px rgba(0,0,0,.22), 0 1px 3px rgba(0,0,0,.18); font-size:0.8125rem; white-space:nowrap; pointer-events:none; }
.map-route-chip > span:last-child { min-width:0; overflow:hidden; text-overflow:ellipsis; }
.map-route-chip .map-route-ring { flex:none; }
.is-sbb .map-route-chip { color:var(--sbb-text); border-color:var(--sbb-line); }
.map-route-spine { position:relative; display:grid; place-items:center; flex:0 0 14px; align-self:stretch; color:var(--accent-color); }
.map-route-spine svg { position:relative; z-index:1; width:14px; height:14px; }
.map-route-link { position:absolute; left:50%; width:1px; background:var(--border-medium); transform:translateX(-50%); }
.map-route-link.is-up { top:0; bottom:calc(50% + 6px); }
.map-route-link.is-down { top:calc(50% + 6px); bottom:0; }
.map-route-ring { position:relative; z-index:1; width:10px; height:10px; box-sizing:border-box; border-radius:50%; border:2px solid var(--text-secondary); background:var(--container-color-alt); }
.map-route-ring.is-via { width:6px; height:6px; border-width:1.5px; }
.map-route-ring.is-target { border-color:var(--text-color); box-shadow:inset 0 0 0 2px var(--container-color-alt); background:var(--text-color); }
.map-route-swap { flex:0 0 auto; margin-right:4px; }
.map-route-swap svg { width:16px; height:16px; }
.map-route-submit { width:100%; }
.map-journey-caption { padding:2px 2px 0; font-size:0.6875rem; font-weight:600; text-transform:uppercase; letter-spacing:.04em; color:var(--text-secondary); }
.map-journey-list { display:flex; flex-direction:column; gap:6px; }
.map-row.map-journey-suggestion { gap:10px; height:37px; box-sizing:border-box; padding:0 12px; border-radius:6px; font-size:0.875rem; }
.map-extension-row.map-journey-suggestion .map-row-title, .map-extension-row.map-journey-suggestion .map-row-sub { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; overflow-wrap:normal; }
.map-journey-suggestion .map-row-title { font-size:0.875rem; line-height:1.25; }
.map-journey-error { margin:0; padding:6px 8px; border-radius:6px; font-size:0.75rem; color:var(--tint-red-text, #b91c1c); background:var(--tint-red-bg, transparent); }
.map-journey-card { display:flex; flex-direction:column; gap:6px; width:100%; padding:9px 10px; box-sizing:border-box; border:1px solid var(--border-light);
  border-radius:8px; background:var(--container-color-alt); color:inherit; font:inherit; text-align:left; cursor:pointer; }
.map-journey-card:hover:not(:disabled):not(.is-static) { background:var(--hover-bg); }
.map-journey-card.is-static { cursor:default; }
.map-journey-head { display:flex; align-items:center; gap:7px; min-width:0; }
.map-journey-direction { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.78125rem; color:var(--text-color); }
.map-journey-times { display:flex; align-items:center; gap:8px; }
.map-journey-time { display:inline-flex; align-items:baseline; gap:4px; font-size:0.78125rem; font-variant-numeric:tabular-nums; color:var(--text-color); }
.map-journey-time.is-strong { font-size:0.875rem; font-weight:700; }
.map-journey-late { font-size:0.6875rem; font-weight:600; color:var(--tint-red-text, #b91c1c); }
.map-journey-track { position:relative; flex:1; display:flex; align-items:center; justify-content:space-between; height:10px; }
.map-journey-track::before { content:''; position:absolute; left:4px; right:4px; top:50%; height:2px; background:var(--text-secondary); transform:translateY(-50%); }
.map-journey-track-dot { position:relative; width:8px; height:8px; box-sizing:border-box; border-radius:50%; border:2px solid var(--text-secondary); background:var(--container-color-alt); }
.map-journey-track-dot.is-end { background:var(--text-color); border-color:var(--text-color); }
.map-journey-meta { display:flex; align-items:center; gap:8px; font-size:0.71875rem; color:var(--text-secondary); }
.map-journey-duration { margin-left:auto; font-variant-numeric:tabular-nums; }
.map-journey-warn { color:var(--tint-red-text, #b91c1c); font-weight:600; }
/* Departure board: every row is one line in its own box, all boxes on one shared grid (subgrid), so time,
   line, destination, delay and platform line up like a table. Time and line are always complete; badges keep
   their natural size and complete text (the column is as wide as the widest one; a badge is never stretched, shrunk or truncated), and the
   destination starts 8px after the column. Only the destination gives way (down to nothing, with an
   ellipsis), then the platform; never a second line. */
.map-journey-list.is-board { display:grid; grid-template-columns:max-content max-content minmax(0, 1fr) minmax(0, max-content) minmax(0, max-content); row-gap:6px; }
.map-journey-list.is-board > :not(.map-journey-card) { grid-column:1 / -1; }
.map-journey-card.is-board { display:grid; grid-column:1 / -1; grid-template-columns:subgrid; align-items:center; column-gap:6px; min-width:0; overflow:hidden; }
.map-board-time { font-size:0.875rem; font-weight:700; font-variant-numeric:tabular-nums; color:var(--text-color); white-space:nowrap; }
.map-board-time.is-late { color:var(--tint-red-text, #b91c1c); }
.map-board-line { display:flex; align-items:center; justify-self:start; min-width:max-content; white-space:nowrap; }
.map-journey-card .map-board-line .map-line, .map-journey-card .map-board-line .map-line-picto, .map-journey-card .map-board-line .map-line-badge { flex:none; }
.map-board-dest { margin-left:2px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.8125rem; color:var(--text-color); }
.map-board-end { display:contents; }
.map-board-delay { justify-self:end; max-width:100%; min-width:0; overflow:hidden; text-overflow:ellipsis; font-size:0.75rem; font-weight:600; font-variant-numeric:tabular-nums; color:var(--tint-red-text, #b91c1c); white-space:nowrap; }
.map-board-delay:empty { display:none; }
/* An on-time row lends its empty delay cell to the destination. */
.map-journey-card.is-board:not(:has(.map-board-delay:not(:empty))) .map-board-dest { grid-column:3 / 5; }
.map-board-platform { grid-column:5; justify-self:end; max-width:100%; min-width:0; overflow:hidden; text-overflow:ellipsis; font-size:0.75rem; font-variant-numeric:tabular-nums; color:var(--text-secondary); white-space:nowrap; }
.map-board-platform.is-changed { color:var(--tint-red-text, #b91c1c); font-weight:600; }
.map-line-badge { display:inline-flex; align-items:center; flex:0 0 auto; height:18px; padding:0 5px; box-sizing:border-box; border-radius:3px;
  font-size:0.6875rem; font-weight:800; letter-spacing:.01em; line-height:1; white-space:nowrap; }
.map-line-badge.is-train { background:var(--text-color); color:var(--pane-bg, var(--container-color)); }
.map-line-badge.is-regional { border:1.5px solid var(--text-color); color:var(--text-color); }
.map-line-badge.is-bus, .map-line-badge.is-tram, .map-line-badge.is-ship, .map-line-badge.is-cableway, .map-line-badge.is-other {
  background:var(--accent-tint-bg); color:var(--title-color); }
.map-journey-detail { display:flex; flex-direction:column; gap:8px; }
.map-journey-backbar { position:sticky; top:0; z-index:2; display:flex; align-items:center; gap:4px; flex-shrink:0; height:var(--app-bar-height); box-sizing:border-box;
  padding:0 8px 0 4px; border-bottom:1px solid var(--border-light); background:var(--container-color); }
.map-journey-backbar.is-under-segments { top:var(--app-bar-height); }
.map-journey-backbar .panel-tool-btn svg { width:16px; height:16px; }
.map-journey-backbar-title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--small-font-size); font-weight:var(--font-semi-bold); color:var(--text-color); }
.map-journey-summary { display:flex; flex-direction:column; gap:6px; padding:9px 10px; border:1px solid var(--border-light); border-radius:8px; background:var(--container-color-alt); }
.map-legs { display:flex; flex-direction:column; gap:6px; }
.map-leg { display:flex; flex-direction:column; padding:8px 10px; border:1px solid var(--border-light); border-radius:8px; background:var(--container-color-alt); }
.map-leg.is-walk { flex-direction:row; align-items:center; gap:8px; padding:6px 10px; background:transparent; border-style:dashed; }
.map-leg-call, .map-leg-ride { display:grid; grid-template-columns:44px 14px minmax(0,1fr) auto; align-items:center; column-gap:8px; }
.map-leg-ride { min-height:30px; }
.map-leg-time { font-variant-numeric:tabular-nums; }
.map-leg-time .map-journey-time { flex-direction:column; align-items:flex-start; gap:0; line-height:1.15; }
.map-leg.is-walk .map-leg-time { flex:0 0 44px; font-size:0.71875rem; color:var(--text-secondary); }
.map-leg-spine { position:relative; display:grid; place-items:center; align-self:stretch; color:var(--text-secondary); }
.map-leg-spine.is-line::before { content:''; position:absolute; top:-6px; bottom:-6px; left:50%; width:2px; background:var(--text-secondary); transform:translateX(-50%); }
.map-leg-spine.is-walk { flex:0 0 14px; }
.map-leg-spine.is-walk svg { width:13px; height:13px; }
.map-leg-dot { width:9px; height:9px; box-sizing:border-box; border-radius:50%; border:2px solid var(--text-color); background:var(--container-color-alt); }
.map-leg-station { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.78125rem; color:var(--text-color); }
.map-leg-station.is-strong, .map-leg-platform.is-strong { font-weight:700; }
.map-leg-platform { font-size:0.71875rem; color:var(--text-secondary); white-space:nowrap; }
.map-leg-body { display:flex; flex-direction:column; gap:3px; min-width:0; font-size:0.75rem; color:var(--text-secondary); }
.map-leg.is-walk .map-leg-body { flex-direction:row; }
.map-leg-direction { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.map-leg.is-action { cursor:pointer; }
.map-leg.is-action:hover { background:var(--hover-bg); }
.map-leg.is-action:focus-visible { outline:2px solid var(--accent-color, currentColor); outline-offset:-2px; }
.map-leg .map-journey-head .map-occupancies, .map-ride-head .map-journey-head .map-occupancies { margin-left:auto; }
/* A ride's run: header card, then the stops on one spine (time | spine | name | platform), one line per stop. */
.map-ride { display:flex; flex-direction:column; gap:8px; }
.map-ride-head { display:flex; flex-direction:column; gap:4px; min-width:0; padding:10px 12px; border:1px solid var(--border-light); border-radius:8px; background:var(--container-color-alt); font-size:0.75rem; color:var(--text-secondary); }
.map-ride-number { font-size:0.84375rem; font-weight:700; color:var(--text-color); white-space:nowrap; font-variant-numeric:tabular-nums; }
.map-ride-stops { --ride-line:var(--text-secondary); --ride-dim:color-mix(in srgb, var(--ride-line) 40%, transparent); margin:0; padding:0 12px 12px; list-style:none; border:1px solid var(--border-light); border-radius:8px; background:var(--container-color-alt); }
.map-ride-stop { display:grid; grid-template-columns:40px 12px minmax(0,1fr) auto; align-items:end; column-gap:8px; }
.map-ride-times { display:flex; flex-direction:column; justify-content:flex-end; padding-top:12px; font-size:0.75rem; line-height:18px; font-variant-numeric:tabular-nums; color:var(--text-secondary); }
.map-ride-time { white-space:nowrap; }
.map-ride-time.is-strong { font-weight:700; color:var(--text-color); }
.map-ride-delay { font-size:0.6875rem; line-height:16px; white-space:nowrap; color:var(--tint-red-text, #b91c1c); }
.map-ride-delay.is-strong { font-weight:700; }
.map-ride-spine { position:relative; align-self:stretch; }
.map-ride-spine::before, .map-ride-spine::after { content:''; position:absolute; left:50%; width:2px; background:var(--ride-line); transform:translateX(-50%); }
.map-ride-stop { --ride-dot:9px; }
.map-ride-stop.has-tail { --ride-dot:25px; }
.map-ride-spine::before { top:0; bottom:var(--ride-dot); }
.map-ride-spine::after { bottom:0; height:var(--ride-dot); }
.map-ride-stop.has-tail :is(.map-ride-name, .map-ride-platform) { padding-bottom:16px; }
.map-ride-stop:first-child .map-ride-spine::before, .map-ride-stop:last-child .map-ride-spine::after { display:none; }
.map-ride-stop.is-after .map-ride-spine::before, .map-ride-stop.is-after .map-ride-spine::after, .map-ride-stop.is-outside .map-ride-spine::before, .map-ride-stop.is-outside .map-ride-spine::after,
.map-ride-stop.is-outside + .map-ride-stop .map-ride-spine::before, .map-ride-stop:has(+ .is-after) .map-ride-spine::after, .map-ride-stop:has(+ .is-outside) .map-ride-spine::after { background:var(--ride-dim); }
.map-ride-dot { position:absolute; z-index:1; left:50%; bottom:var(--ride-dot); width:7px; height:7px; box-sizing:border-box; border:1.5px solid var(--ride-line); border-radius:50%; background:var(--container-color-alt); transform:translate(-50%, 50%); }
.map-ride-stop.is-board .map-ride-dot, .map-ride-stop.is-alight .map-ride-dot { width:11px; height:11px; border:0; background:var(--text-color); }
.map-ride-stop.is-late:not(.is-after, .is-outside) .map-ride-dot { border-color:var(--tint-red-text, #b91c1c); }
.map-ride-stop.is-late:is(.is-board, .is-alight) .map-ride-dot { background:var(--tint-red-text, #b91c1c); }
.map-ride-name { display:flex; align-items:center; gap:8px; min-width:0; font-size:0.8125rem; line-height:18px; color:var(--text-color); }
.map-ride-title { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.map-ride-name .map-occupancies { flex-shrink:0; }
.map-ride-platform { font-size:0.75rem; line-height:18px; white-space:nowrap; color:var(--text-color); }
.map-ride-stop.is-board :is(.map-ride-title, .map-ride-platform), .map-ride-stop.is-alight :is(.map-ride-title, .map-ride-platform) { font-weight:700; }
.map-ride-stop:is(.is-after, .is-outside) :is(.map-ride-times, .map-ride-name, .map-ride-platform) { opacity:.5; }
.map-tiles { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:6px; }
/* Placed tiles (column/row/columns/rows) sit on a four-column grid and may leave empty cells. */
.map-tiles.is-placed { grid-template-columns:repeat(4, minmax(0, 1fr)); grid-auto-rows:62px; }
/* The tile grid and its swipe line share one area. */
.map-tiles-area { position:relative; display:flex; flex-direction:column; gap:6px; }
.map-tiles.is-swipe { touch-action:none; user-select:none; -webkit-user-select:none; }
.map-tile-text { display:flex; flex-direction:column; min-width:0; max-width:100%; }
.map-tile-place { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.75rem; }
/* While swiping, the tiles not on the line step back, as in the SBB app. */
.map-tiles.is-swiping .map-tile { transition:opacity .12s ease; }
.map-tiles.is-swiping .map-tile:not(.is-from):not(.is-over):not(.is-via) { opacity:.45; }
.map-tile { display:flex; flex-direction:column; align-items:flex-start; justify-content:space-between; gap:8px; min-height:68px; padding:9px 10px;
  box-sizing:border-box; border:1px solid var(--border-light); border-radius:8px; background:var(--container-color-alt); color:var(--text-color);
  font:inherit; text-align:left; cursor:pointer; min-width:0; }
.map-tile.is-wide, .map-tile.is-large { grid-column:1 / -1; min-height:54px; }
.map-tile:hover:not(:disabled) { background:var(--hover-bg); }
.map-tile.active { background:var(--accent-tint-bg); border-color:transparent; color:var(--title-color); }
.map-tile-icon { display:grid; place-items:center; width:16px; height:16px; color:var(--text-secondary); }
.map-tile-icon svg { width:15px; height:15px; }
.map-tile.active .map-tile-icon { color:var(--title-color); }
.map-tile-label { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.8125rem; font-weight:600; }
.map-tile-detail { max-width:100%; margin-top:-6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.6875rem; color:var(--text-secondary); }
/* ---- SBB look (look: 'sbb'): the SBB app's colours, light and dark --- */
/* The SBB page colour runs to the bottom of the sidebar, not just under the content. */
.panel-body:has(> .map-extension-panel > .map-journey.is-sbb) { background:var(--container-color); }
/* Everything is the SBB app's (red, radii, text, lines, badges) except the two surfaces:
   the page and the item backgrounds come from Valley's tokens, so they match the rest of the app. */
.map-journey.is-sbb { --sbb-red:#eb0000; --sbb-red-dark:#c60018; --sbb-blue:#2d327d;
  --sbb-page:var(--container-color); --sbb-card:var(--container-color-alt); --sbb-text:light-dark(#151515, #f6f6f6);
  --sbb-muted:light-dark(#767676, #8d8d8d); --sbb-line:light-dark(#e5e5e5, #353535); --sbb-late:light-dark(#eb0000, #ff5a4f);
  --sbb-location:light-dark(#2272c6, #4b9be8); --sbb-hover:var(--hover-bg); --sbb-shadow:light-dark(0 1px 3px rgba(0,0,0,.08), none);
  min-height:100%; background:var(--sbb-page); color:var(--sbb-text); }
/* The segment header is Valley's: a 38px bar (37px plus its 1px line) of chips, the chosen one in the accent tint. */
.is-sbb .map-journey-segments { gap:6px; padding:0 8px; background:var(--container-color); border-bottom:1px solid var(--border-light); }
.is-sbb .map-journey-segment { height:26px; padding:0 10px; border-radius:var(--radius-sm); background:var(--hover-bg); color:var(--text-secondary); font-weight:400; }
.is-sbb .map-journey-segment:hover:not(:disabled) { background:var(--container-color-light); color:var(--text-color); }
.is-sbb .map-journey-segment.active, .is-sbb .map-journey-segment.active:hover:not(:disabled) { background:var(--accent-tint-bg); color:var(--title-color); }
.is-sbb .map-journey-segment:disabled { opacity:.55; }
.is-sbb .map-route-card, .is-sbb .map-journey-card, .is-sbb .map-journey-summary, .is-sbb .map-leg:not(.is-walk), .is-sbb .map-journey-more {
  border:0; border-radius:10px; background:var(--sbb-card); color:var(--sbb-text); box-shadow:var(--sbb-shadow); }
.is-sbb .map-route-stop + .map-route-stop input, .is-sbb .map-route-when { border-color:var(--sbb-line) !important; }
.is-sbb .map-route-stop input { color:var(--sbb-text); font-size:0.84375rem; }
.is-sbb .map-route-stop input::placeholder { color:var(--sbb-muted); }
.is-sbb .map-route-stop.is-location input { color:var(--sbb-text); }
.is-sbb .map-route-spine { color:var(--sbb-muted); }
.is-sbb .map-route-link { background:var(--sbb-muted); }
.is-sbb .map-route-ring { width:12px; height:12px; border:1.5px solid var(--sbb-muted); background:var(--sbb-card); box-shadow:inset 0 0 0 2px var(--sbb-card), inset 0 0 0 4px var(--sbb-muted); }
.is-sbb .map-route-ring.is-via { width:5px; height:5px; border:0; background:var(--sbb-muted); box-shadow:none; }
.is-sbb .map-route-ring.is-target { border-color:var(--sbb-muted); background:var(--sbb-card); }
.is-sbb .map-route-ring.is-location { border-color:var(--sbb-location); box-shadow:inset 0 0 0 2px var(--sbb-card), inset 0 0 0 4px var(--sbb-location); }
.is-sbb .map-route-swap { width:30px; height:30px; border:1px solid var(--sbb-line); border-radius:50%; color:var(--sbb-text); }
.is-sbb .map-route-when-now { color:var(--sbb-text); }
.is-sbb .map-route-submit { height:37px; border:0; border-radius:18.5px; background:var(--sbb-red); color:#fff; font-weight:400; }
.is-sbb .map-route-submit:hover:not(:disabled) { background:#d30000; }
.is-sbb .map-journey-day { padding:4px 2px 0; color:var(--sbb-muted); font-size:0.78125rem; }
.is-sbb .map-journey-caption { color:var(--sbb-muted); }
.is-sbb .map-journey-more { height:37px; min-height:0; box-sizing:border-box; font-size:0.8125rem; }
.is-sbb .map-journey-more:hover:not(:disabled) { background:var(--sbb-hover); }
.is-sbb .map-journey-card { gap:7px; padding:10px 12px; }
.is-sbb .map-journey-card:hover:not(:disabled):not(.is-static) { background:var(--sbb-hover); }
.is-sbb .map-journey-direction { font-size:0.8125rem; color:var(--sbb-text); }
.is-sbb .map-journey-time { color:var(--sbb-text); }
.is-sbb .map-journey-time.is-strong { font-size:0.875rem; font-weight:700; }
.is-sbb .map-journey-late, .is-sbb .map-journey-warn { color:var(--sbb-late); }
.is-sbb .map-journey-track::before { left:4px; right:4px; height:1.5px; background:var(--sbb-text); }
.is-sbb .map-journey-track-dot { width:8px; height:8px; border:1.5px solid var(--sbb-text); background:var(--sbb-card); }
.is-sbb .map-journey-track-dot.is-end { background:var(--sbb-text); border-color:var(--sbb-text); }
.is-sbb .map-journey-meta { color:var(--sbb-text); font-size:0.75rem; }
.is-sbb .map-journey-duration { color:var(--sbb-text); }
.is-sbb .map-board-time, .is-sbb .map-board-dest { color:var(--sbb-text); }
.is-sbb .map-board-time.is-late, .is-sbb .map-board-delay, .is-sbb .map-board-platform.is-changed { color:var(--sbb-late); }
.is-sbb .map-board-platform { color:var(--sbb-text); }
.is-sbb .map-line { display:inline-flex; align-items:center; gap:4px; flex:0 0 auto; }
.is-sbb .map-line-picto { width:18px; height:18px; padding:1px; box-sizing:border-box; border-radius:2px; background:var(--sbb-blue); color:#fff; }
.is-sbb .map-line-badge { height:18px; padding:0; border:0; border-radius:2px; background:transparent; color:var(--sbb-text); font-size:0.84375rem; font-weight:700; }
.is-sbb .map-line-badge.is-train { gap:4px; padding:0 5px; background:var(--sbb-red); color:#fff; }
.is-sbb .map-line-cat { font-style:italic; font-weight:800; letter-spacing:-.02em; }
.is-sbb .map-line-badge.is-regional { min-width:46px; padding:0 4px; border:1.5px solid var(--sbb-text); border-radius:1px; }
.is-sbb .map-journey-summary { padding:10px 12px; }
.is-sbb .map-journey-backbar-title { color:var(--sbb-text); }
.is-sbb .map-journey-summary .map-journey-meta { color:var(--sbb-muted); }
.is-sbb .map-legs { gap:8px; }
.is-sbb .map-leg:not(.is-walk) { padding:10px 12px; }
.is-sbb .map-leg-call, .is-sbb .map-leg-ride { grid-template-columns:40px 12px minmax(0,1fr) auto; }
.is-sbb .map-leg-ride { min-height:44px; }
.is-sbb .map-leg-station { color:var(--sbb-text); font-size:0.8125rem; }
.is-sbb .map-leg-platform { color:var(--sbb-text); font-size:0.75rem; }
.is-sbb .map-leg-body { color:var(--sbb-muted); font-size:0.75rem; }
.is-sbb .map-leg-spine { color:var(--sbb-text); }
.is-sbb .map-leg-spine.is-line::before { width:2px; background:var(--sbb-text); }
.is-sbb .map-leg-dot { width:9px; height:9px; border:0; background:var(--sbb-text); }
/* Where a change departs, the app draws a hollow ring instead of a dot. */
.is-sbb .map-leg:not(.is-walk) ~ .map-leg:not(.is-walk) .map-leg-call:first-child .map-leg-dot { border:2px solid var(--sbb-text); background:var(--sbb-card); }
.is-sbb .map-leg.is-walk { min-height:37px; padding:0 14px; border:1px solid var(--sbb-line); border-style:solid; border-radius:18.5px; background:var(--sbb-card); color:var(--sbb-text); }
.is-sbb .map-leg.is-walk .map-leg-time { flex:0 0 32px; text-align:right; color:var(--sbb-text); font-size:0.75rem; }
.is-sbb .map-leg.is-walk .map-leg-spine { color:var(--sbb-text); }
.is-sbb .map-leg.is-walk .map-leg-body { color:var(--sbb-text); font-size:0.8125rem; }
.is-sbb .map-leg.is-action:hover { background:var(--sbb-hover); }
.is-sbb .map-occupancy.is-level-3 svg.is-on { fill:var(--sbb-late); }
.is-sbb .map-ride-head, .is-sbb .map-ride-stops { border:0; border-radius:10px; background:var(--sbb-card); box-shadow:var(--sbb-shadow); }
.is-sbb .map-ride-head { color:var(--sbb-text); font-size:0.8125rem; }
.is-sbb .map-ride-stops { --ride-line:var(--sbb-text); }
.is-sbb .map-ride-dot { background:var(--sbb-card); }
.is-sbb .map-ride-number, .is-sbb .map-ride-name, .is-sbb .map-ride-platform, .is-sbb .map-ride-times, .is-sbb .map-ride-time.is-strong { color:var(--sbb-text); }
.is-sbb .map-ride-stop.is-board .map-ride-dot, .is-sbb .map-ride-stop.is-alight .map-ride-dot { background:var(--sbb-text); }
.is-sbb .map-ride-delay { color:var(--sbb-late); }
.is-sbb .map-ride-stop.is-late:not(.is-after, .is-outside) .map-ride-dot { border-color:var(--sbb-late); }
.is-sbb .map-ride-stop.is-late:is(.is-board, .is-alight) .map-ride-dot { background:var(--sbb-late); }
.is-sbb .map-journey-error { color:var(--sbb-late); background:var(--sbb-card); }
.is-sbb .map-journey-suggestion { background:var(--sbb-card); color:var(--sbb-text); }
.is-sbb .map-journey-suggestion .map-row-icon { color:var(--sbb-text); }
.is-sbb .map-journey-suggestion .map-row-icon svg { width:18px; height:18px; }
.is-sbb .map-empty { color:var(--sbb-muted); }
/* Touch timetable: the app's mosaic of station tiles, four cells wide, no photos. */
/* Edge to edge: the 2px gap between tiles is also the margin to the sidebar edges and the header; square corners. */
.is-sbb .map-tiles { grid-template-columns:repeat(4, minmax(0, 1fr)); grid-auto-rows:62px; grid-auto-flow:dense; gap:2px; overflow:hidden; border-radius:0; }
.is-sbb .map-tiles-area { gap:0; margin:-6px; }
.is-sbb .map-tiles-area > .map-empty { margin:8px 6px; }
.is-sbb .map-tile { justify-content:flex-end; gap:6px; min-height:0; padding:7px 8px; border:0; border-radius:0; color:var(--sbb-text); }
.is-sbb .map-tile.is-tone-0 { background:color-mix(in srgb, var(--text-color) 24%, var(--container-color-alt)); }
.is-sbb .map-tile.is-tone-1 { background:color-mix(in srgb, var(--text-color) 14%, var(--container-color-alt)); }
.is-sbb .map-tile.is-tone-2 { background:var(--container-color-light); }
.is-sbb .map-tile.is-small { grid-column:span 1; }
.is-sbb .map-tile.is-wide { grid-column:span 2; }
.is-sbb .map-tile.is-large { grid-column:span 2; grid-row:span 2; }
.is-sbb .map-tile.is-control { background:var(--sbb-card); color:var(--sbb-text); justify-content:space-between; }
.is-sbb .map-tile.is-control.is-small { align-items:center; text-align:center; }
.is-sbb .map-tile:hover:not(:disabled) { filter:brightness(1.08); }
.is-sbb .map-tile-icon { color:var(--sbb-text); }
.is-sbb .map-tile.is-control .map-tile-icon .map-route-ring { width:12px; height:12px; }
.is-sbb .map-tile-place { font-size:0.6875rem; font-weight:400; line-height:1.2; }
.is-sbb .map-tile-label { font-size:0.6875rem; font-weight:700; line-height:1.2; white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
.is-sbb .map-tile.is-control .map-tile-label { font-weight:400; font-size:0.75rem; }
.is-sbb .map-tile-detail { margin-top:0; color:var(--sbb-muted); }
/* The swipe is drawn as a line from the first tile through the via to the pointer. */
.map-swipe-line { position:absolute; inset:0; z-index:2; width:100%; height:100%; overflow:visible; pointer-events:none; color:var(--accent-color); }
.is-sbb .map-swipe-line { color:var(--sbb-red); }
.map-swipe-line polyline { fill:none; stroke:currentColor; stroke-width:3; stroke-linecap:round; stroke-linejoin:round; }
.map-swipe-line circle { fill:currentColor; }
.map-swipe-line circle.is-via { stroke:var(--container-color-alt); stroke-width:2.5; }
.map-swipe-line circle.is-end { fill:var(--container-color-alt); stroke:currentColor; stroke-width:3; }
.map-extension-row { width: 100%; border: 0; background: transparent; color: inherit; text-align: left; font: inherit; }
.map-extension-row:disabled { opacity: 1; cursor: default; }
.map-extension-row .map-row-title, .map-extension-row .map-row-sub { white-space: pre-line; overflow-wrap: anywhere; }
.map-tab { position: relative; }
.map-tab-drop::before { content: ''; position: absolute; left: -3px; top: 4px; bottom: 4px; width: 2px; background: var(--accent-color); }
.map-tabs { display:flex; align-items:center; gap:var(--space-1, 4px); width:100%; box-sizing:border-box;
  height:var(--app-bar-height); padding:0 var(--space-2, 8px); flex-shrink:0;
  background:var(--container-color); border-bottom:1px solid var(--border-light); }
.map-tab { display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto; padding:0;
  width:var(--shell-control-action, 30px); height:var(--shell-control-toolbar, 26px);
  border:none; border-radius:var(--shell-control-radius, var(--radius-sm)); background:transparent; color:var(--text-secondary);
  cursor:pointer; -webkit-app-region:no-drag; }
.map-tab svg { width:var(--shell-glyph-medium, 16px); height:var(--shell-glyph-medium, 16px); }
.map-tab:hover { background:var(--hover-bg); color:var(--text-color); }
.map-tab.active { background:var(--accent-tint-bg); color:var(--title-color); }
.map-header-actions { display:inline-flex; align-items:center; gap:5px; }
.map-locate-btn { display:inline-flex; align-items:center; height:var(--shell-control-toolbar, 26px);
  padding:0 8px; font:inherit; font-size:var(--small-font-size); font-weight:var(--font-semi-bold); white-space:nowrap; cursor:pointer;
  border:none; border-radius:var(--shell-control-radius, var(--radius-sm)); background:var(--accent-tint-bg);
  color:var(--title-color); -webkit-app-region:no-drag; }
.map-locate-btn:hover { background:var(--hover-bg); }
.map-locate-btn:disabled { opacity:0.5; cursor:default; background:var(--accent-tint-bg); }

.map-tab-head { display:flex; align-items:center; gap:6px; padding:6px 10px; color:var(--text-secondary);
  font-size:0.6875rem; font-weight:600; text-transform:uppercase; letter-spacing:.03em; }
.map-tab-head > span:first-child { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.map-tab-body { display:flex; flex-direction:column; gap:6px; padding:3px 8px 0; }

/* ---- add / edit a favourite place ------------------------------------ */
/* Layout only: the name input is .map-input, the address field is the shared
   SearchBox and the document field is the settings kit's RealmFileField,
   which brings its own frame, width and error line. */
.map-place-form { display:flex; flex-direction:column; gap:6px; margin:0 8px 6px; padding:8px;
  border:1px solid var(--border-light); border-radius:var(--radius);
  background:var(--container-color-alt); }
.map-place-form .settings-input-stack { width:100%; }
.map-place-form .map-place-actions { margin-top:2px; }

/* ---- search results + place card (sidebar) --------------------------- */
.map-result-list { display:flex; flex-direction:column; border:1px solid var(--border-light);
  border-radius:10px; overflow:hidden; background:var(--container-color-alt); }
.map-result-list .map-search-result + .map-search-result { border-top:1px solid var(--border-light); }

.map-place-card { display:flex; flex-direction:column; gap:6px; padding:8px; border-radius:8px;
  border:1px solid var(--border-light); background:var(--container-color-alt); }
.map-place-head { display:flex; align-items:center; gap:6px; min-width:0; }
.map-place-name { flex:1; min-width:0; font-size:0.8125rem; font-weight:600; color:var(--text-color);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.map-place-head .map-row-action { opacity:.7; }
.map-place-head .map-row-action:hover { opacity:1; }
/* The geocoder's region/country line, riding tight under the name. */
.map-place-sub { margin-top:-4px; font-size:0.6875rem; color:var(--text-tertiary, var(--text-secondary));
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.map-place-coords { margin-top:-2px; font-size:0.6875rem; color:var(--text-tertiary, var(--text-secondary));
  font-variant-numeric:tabular-nums; }
/* min-width:0 or the labels refuse to shrink and the row spills out of the card. */
.map-place-actions { display:flex; gap:5px; min-width:0; }
.map-place-actions .map-btn { flex:1 1 0; min-width:0; padding:5px 8px; font-size:0.71875rem;
  white-space:nowrap; overflow:hidden; }
.map-place-actions .map-btn:last-child { flex:0 0 auto; padding:5px 9px; }
.map-place-actions .map-btn.active { border-color:var(--accent-color);
  color:var(--accent-tint-text, var(--accent-color)); background:var(--accent-tint-bg); }
/* Saved reads at a glance: the bookmark fills instead of only changing colour. */
.map-place-actions .map-btn.active svg { fill:currentColor; }

/* ---- route stop spine (shared by both sidebars' route card) ----------- */
/* One glyph column (hollow ring → filled pin), a dotted spine joining the rows
   inside it, a label/field to its right, and the ⇅ beside the whole block. The
   entire row is the drag handle — no grip glyph stealing the left column. */
.map-dir-stops { flex:1; min-width:0; display:flex; flex-direction:column; }
/* min-height 30px is load-bearing: the spine offsets below are derived from it
   (row centre 15px, ±9px clearance around the glyph). Change one, change both. */
.map-dir-row { position:relative; display:flex; align-items:center; gap:6px; min-width:0;
  min-height:30px; padding:0 2px 0 0; border-radius:6px; }
.map-dir-row:not(:last-child)::before { content:''; position:absolute; left:8px; width:2px;
  top:24px; bottom:-6px; border-radius:1px;
  background-image:repeating-linear-gradient(to bottom,
    var(--border-medium) 0 2px, transparent 2px 6px); }
.map-dir-row:hover { background:var(--hover-bg); }
.map-dir-row:focus-visible { outline:1px solid var(--accent-color); outline-offset:-1px; }
/* The shared horizontal insertion marker, restated under this prefix (a plugin
   never borrows a core class). Geometry stays on the --drop-* tokens; the
   spine already owns ::before, so this seam draws on ::after. */
.map-dir-row.is-drop-target::after { content:''; position:absolute; left:0; right:0; top:-1px;
  height:var(--drop-knob); margin-top:var(--drop-indicator-inset);
  background:var(--drop-indicator-fill); pointer-events:none; }
/* The one column every glyph shares — the start ring, the vias, the finish flag
   and the ⊕ of "Add via" all land on the same centre line, at one size. The old
   column mixed an 11px ring with a 15px pin, so the two ends of the same spine
   read as different weights. */
.map-dir-glyph { flex:0 0 18px; height:18px; display:grid; place-items:center;
  color:var(--text-tertiary, var(--text-secondary)); }
.map-dir-glyph svg { width:13px; height:13px; }
/* The flag's artwork is tall and narrow inside a square viewBox, so it needs a
   larger box to reach the ring's optical height — 18px of box is ~15px of flag. */
.map-dir-glyph[data-kind="dest"] { color:var(--tint-red-text, #b91c1c); }
.map-dir-glyph[data-kind="dest"] svg { width:18px; height:18px; }
.map-dir-label { flex:1; min-width:0; font-size:0.78125rem; color:var(--text-color);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.map-dir-swap { flex:0 0 auto; display:grid; place-items:center; width:26px; height:26px; padding:0;
  border:none; border-radius:50%; background:none; color:var(--text-tertiary, var(--text-secondary));
  cursor:pointer; }
.map-dir-swap svg { width:15px; height:15px; }
.map-dir-swap:hover { background:var(--hover-bg); color:var(--text-color); }
.map-add-stop-btn { display:flex; align-items:center; gap:6px; align-self:flex-start;
  min-height:26px; margin:0; padding:0 6px 0 0; border:none; border-radius:6px; background:none;
  color:var(--text-secondary); font-size:0.75rem; cursor:pointer; }
/* Cloned row handed to setDragImage: parked offscreen for the frame the browser
   needs to snapshot it, so the ghost keeps the row's radius and surface. */
.map-drag-ghost { position:fixed; top:-9999px; left:-9999px; pointer-events:none; box-sizing:border-box;
  border-radius:7px; overflow:hidden; background:var(--surface-color);
  border:1px solid var(--border-medium); box-shadow:0 6px 18px rgba(0,0,0,.22); }
.map-add-stop-btn:hover { background:var(--hover-bg); color:var(--text-color); }
.map-dir-field { flex:1; min-width:0; display:flex; align-items:center; gap:4px; }
.map-dir-field .map-search { flex:1; min-width:0; }
.map-dir-fav { opacity:.7; }
.map-dir-fav:hover { opacity:1; }
.map-section-count { font-variant-numeric:tabular-nums; color:var(--text-tertiary, var(--text-secondary)); }

.map-row { display:flex; align-items:center; gap:8px; padding:5px 10px; cursor:pointer; min-width:0; }
.map-row:hover { background:var(--hover-bg); }
.map-row.active { background:var(--accent-tint-bg); }
.map-row.active .map-row-title { color:var(--accent-tint-text, var(--accent-color)); }
.map-row-icon { display:grid; place-items:center; color:var(--accent-color); flex-shrink:0; }
.map-row-icon svg { width:15px; height:15px; }
.map-row-meta { flex:1; display:flex; flex-direction:column; min-width:0; }
.map-row-title { font-size:0.8125rem; color:var(--text-color); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.map-row-meta .map-row-title, .map-row > .map-row-title { flex:1; }
.map-row-sub { font-size:0.6875rem; color:var(--text-tertiary, var(--text-secondary)); }
.map-row-action { border:none; background:none; color:var(--text-tertiary, var(--text-secondary));
  cursor:pointer; opacity:0; padding:3px; display:grid; place-items:center; border-radius:4px; flex-shrink:0; }
.map-row:hover .map-row-action { opacity:1; }
.map-row-eye { opacity:1; }
.map-row-action svg { width:14px; height:14px; }
.map-row-action:hover { background:var(--container-color-alt); color:var(--text-color); }
.map-row-danger:hover { color:var(--tint-red-text, #b91c1c); }

/* The head's own add action. .map-row-action is opacity:0 until its row is
   hovered; the head has no row to hover, so it stays visible. */
.map-tab-head-action { flex:0 0 auto; opacity:.7; }
.map-tab-head-action:hover { opacity:1; }

/* The Favorites bar: one 38px grid row (37px content + 1px line) with the Files header's tool buttons. */
.map-places-bar { display:flex; align-items:center; gap:6px; height:var(--app-bar-height); box-sizing:border-box; flex-shrink:0;
  padding:0 var(--space-2, 8px) 0 10px; border-bottom:1px solid var(--border-light); }
.map-places-bar-title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.map-places-bar .panel-tool-btn.is-off { color:var(--text-tertiary, var(--text-secondary)); }
.map-places-bar .panel-tool-btn svg { width:var(--shell-glyph-medium, 16px); height:var(--shell-glyph-medium, 16px); }
/* A pin source's glyph on a disc in its colour, like its pins on the map. */
.map-pin-badge { display:grid; place-items:center; flex:0 0 18px; width:18px; height:18px; border-radius:50%;
  background:var(--badge-fill); color:#fff; box-shadow:inset 0 0 0 1px rgba(0,0,0,.08); }
.map-pin-badge svg { width:11px; height:11px; }
.map-pin-badge.is-small { flex-basis:14px; width:14px; height:14px; }
.map-pin-badge.is-small svg { width:8px; height:8px; }
.map-tree-row.is-hidden > .map-pin-badge { opacity:.45; }
/* ---- favourite places tree: folders, one subfolder level, places ---- */
.map-place-tree { position:relative; min-height:40px; padding-bottom:24px; }
.map-tree-row { position:relative; padding-left:calc(6px + var(--map-tree-depth, 0) * 16px); }
.map-tree-slot { display:grid; place-items:center; flex:0 0 14px; width:14px; height:14px; margin-right:-4px;
  color:var(--text-tertiary, var(--text-secondary)); }
.map-tree-slot svg { width:12px; height:12px; transition:transform .12s ease; }
.map-folder-chevron.open svg { transform:rotate(90deg); }
.map-folder-icon { color:var(--text-secondary); }
.map-place-icon-btn { border:none; background:none; padding:0; font:inherit; cursor:pointer; border-radius:4px; }
.map-row-icon.map-place-icon-btn { width:20px; height:20px; margin:-2px; }
.map-place-icon-btn:hover { background:var(--container-color-alt); }
.map-folder-input { flex:1; min-width:0; padding:0; font:inherit; font-size:0.8125rem; color:var(--text-color);
  background:transparent; border:none; outline:none; box-shadow:none; }
.map-folder-input:focus, .map-folder-input:focus-visible { border:none; outline:none; box-shadow:none; }
.map-tree-row.drop-before::before, .map-tree-row.drop-after::before { content:''; position:absolute; z-index:2;
  left:calc(6px + var(--map-tree-depth, 0) * 16px); right:0; height:var(--drop-knob, 2px);
  background:var(--drop-indicator-fill, var(--accent-color)); pointer-events:none; }
.map-tree-row.drop-before::before { top:0; transform:translateY(-50%); }
.map-tree-row.drop-after::before { bottom:0; transform:translateY(50%); }
.map-tree-row .map-row-eye { opacity:1; }
.map-tree-row .map-row-eye.is-off { color:var(--text-tertiary, var(--text-secondary)); }
.map-tree-row.is-hidden > .map-row-icon, .map-tree-row.is-hidden > .map-row-title, .map-tree-row.is-hidden > .map-section-count { opacity:.45; }
.map-tree-row.is-hidden > .map-row-meta { opacity:.45; }
.map-tree-row.drop-inside, .map-tree-row.drop-inside:hover { background:var(--accent-tint-bg); box-shadow:inset 0 0 0 1px var(--accent-color); }
.map-place-tree.drop-root::after { content:''; position:absolute; left:6px; right:0; bottom:24px; height:var(--drop-knob, 2px);
  background:var(--drop-indicator-fill, var(--accent-color)); pointer-events:none; }
.map-place-name-row { display:flex; align-items:center; gap:6px; }
.map-place-editor { display:flex; flex-direction:column; gap:8px; }
.map-place-editor .settings-input-stack { width:100%; }
.map-editor-field { display:flex; align-items:center; gap:10px; min-width:0; font-size:0.78125rem; color:var(--text-secondary); }
.map-editor-field > span { flex:0 0 72px; }
.map-editor-field .map-input, .map-editor-field .map-editor-folder { flex:1; min-width:0; }
.map-editor-footer { display:flex; align-items:center; gap:6px; width:100%; }
.map-editor-spacer { flex:1; }
.map-editor-footer .map-btn { display:inline-flex; align-items:center; gap:5px; }
.map-editor-footer .map-btn svg { width:13px; height:13px; }
.map-editor-delete:hover { color:var(--tint-red-text, #b91c1c); }
.map-place-name-row .map-input { flex:1; min-width:0; }
.map-place-form .map-place-icon-btn { display:grid; place-items:center; flex:0 0 auto; width:28px; height:28px; color:var(--accent-color); }
.map-place-form .map-place-icon-btn svg { width:16px; height:16px; }

/* ---- search box ----------------------------------------------------- */
.map-search { position:relative; }
.search-field-row > .map-search { flex:1 1 auto; min-width:0; }
/* Flat variant: inside a directions stop row the field draws no box at all —
   the row's own hover is the affordance and focus is a hairline under the text.
   It keeps the compact 26px metrics: the stop spine's dash offsets are derived
   from the row height, so this one must not grow with the panel field. */
.map-search.is-flat .map-search-field { --search-field-action-size:18px; min-height:26px; height:26px; max-height:26px; gap:6px; padding:0;
  border:none; background:none; border-radius:0; }
.map-search.is-flat .map-search-field:focus-within { border:none;
  box-shadow:inset 0 -1px 0 var(--accent-color); }
.map-search.is-flat .map-search-input { font-size:0.78125rem; }
.map-search-results { position:absolute; top:calc(100% + 5px); left:0; right:0; z-index:30;
  background:var(--surface-color); border:1px solid var(--border-medium); border-radius:10px;
  box-shadow:0 8px 24px rgba(0,0,0,.18); overflow:hidden; max-height:240px; overflow-y:auto; }
/* Anchored to the viewport (inline style carries the rect), so a sidebar field's
   hits can be wider than the panel instead of wrapping onto five lines. */
.map-search-results.is-float { z-index:1200; box-shadow:0 14px 34px rgba(0,0,0,.26); }
.map-search-result { display:flex; flex-direction:column; gap:1px; width:100%; text-align:left;
  padding:7px 10px; border:none; background:none; color:var(--text-color); font-size:0.78125rem;
  cursor:pointer; line-height:1.3; }
.map-search-result-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.map-search-result-sub { min-width:0; font-size:0.6875rem; color:var(--text-tertiary, var(--text-secondary));
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.map-search-result:hover { background:var(--hover-bg); }
/* Keyboard cursor: an accent bar down the left, so ↑/↓ never reads as hover. */
.map-search-result.is-active { background:var(--hover-bg); box-shadow:inset 2px 0 0 var(--accent-color); }

/* Searching / no matches / geocoder error. One centred block for all three, in
   the dropdown and in the sidebar's inline list alike — a left-aligned line of
   11px grey read as a broken first result rather than as a state. */
.map-search-status { display:flex; flex-direction:column; align-items:center; gap:7px;
  padding:20px 14px; text-align:center; }
.map-search-status-icon { width:20px; height:20px; opacity:.5;
  color:var(--text-tertiary, var(--text-secondary)); }
.map-search-status-text { font-size:0.78125rem; font-weight:600; color:var(--text-secondary); }
.map-search-status-sub { font-size:0.71875rem; line-height:1.4;
  color:var(--text-tertiary, var(--text-secondary)); }
.map-spinner { width:18px; height:18px; border-radius:50%; box-sizing:border-box;
  border:2px solid var(--border-medium); border-top-color:var(--accent-color);
  animation:map-spin .7s linear infinite; }
@keyframes map-spin { to { transform:rotate(360deg); } }

/* ---- main map page -------------------------------------------------- */
.map-page { display:flex; flex-direction:column; width:100%; height:100%; overflow:hidden; }
.map-topbar { position:relative; display:flex; align-items:center; gap:8px; flex:0 0 auto;
  height:var(--app-bar-height); box-sizing:border-box; padding:0 10px; border-bottom:1px solid var(--border-light);
  background:var(--container-color-alt); font-size:0.75rem; color:var(--text-secondary); }
.map-topbar-more { display:grid; place-items:center; width:26px; height:26px; padding:0; border:0; border-radius:6px;
  color:var(--text-secondary); background:transparent; cursor:pointer; }
.map-topbar-more:hover { color:var(--text-color); background:var(--hover-color); }
.map-topbar-more svg { width:16px; height:16px; }
.map-topbar-name { position:absolute; left:50%; transform:translateX(-50%); max-width:max(0px, calc(100% - 160px));
  min-width:0; text-align:center; font-weight:600; font-variant-numeric:tabular-nums; color:var(--text-color);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.map-body { position:relative; flex:1; min-height:0; }
.map-canvas { position:absolute; inset:0; }
.map-canvas .maplibregl-map { width:100%; height:100%; }
.map-file-title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.map-file-notices { position:absolute; top:12px; left:12px; max-width:calc(100% - 80px); pointer-events:none; }
.map-file-notice { margin:0 0 8px; padding:8px 12px; border:1px solid var(--border-light);
  border-radius:var(--radius); background:var(--container-color); color:var(--text-color); font-size:0.75rem; }
.map-file-details { position:absolute; left:12px; bottom:30px; box-sizing:border-box; width:320px;
  max-width:calc(100% - 80px); max-height:50%; overflow:auto; padding:12px; border:1px solid var(--border-light);
  border-radius:var(--radius); background:var(--container-color); color:var(--text-color); font-size:0.75rem; }
.map-file-details-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.map-file-details .map-row-action { opacity:1; }
.map-file-details dl { display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 2fr); gap:6px 12px; margin-bottom:0; }
.map-file-details dt { color:var(--text-secondary); overflow-wrap:anywhere; }
.map-file-details dd { margin:0; overflow-wrap:anywhere; white-space:pre-wrap; }
.map-overlay { position:absolute; z-index:5; pointer-events:none; }
.map-overlay > * { pointer-events:auto; }
/* The search affordance is ONE capsule: the round button is its left cap (its
   position never changes) and the input grows out of the right side. */
.map-overlay-top { top:12px; left:12px; display:flex; align-items:center; max-width:calc(100% - 24px); }
/* Capped against the viewport: the old fixed 340px overflowed the map on a
   narrow window and pushed the round controls off the right edge. */
.map-overlay-top.is-open { width:min(360px, calc(100vw - 140px)); height:var(--search-field-height); box-sizing:border-box;
  border-radius:var(--search-field-radius); background:var(--search-field-bg); border:var(--border-width) solid var(--search-field-border);
  box-shadow:0 4px 16px rgba(0,0,0,.22); }
.map-overlay-top.is-open:focus-within { border-color:var(--search-field-focus);
  box-shadow:0 0 0 var(--focus-ring-width) var(--search-field-focus-ring); }
/* Inside the capsule the cap loses its own outline — one shape, one shadow. */
.map-overlay-top.is-open .map-round-btn { border:none; box-shadow:none; background:none;
  color:var(--accent-color); margin:-1px 0 -1px -1px; }
.map-overlay-top.is-open .map-round-btn:hover { background:none; }
.map-search-pill { flex:1; min-width:0; }
.map-search-pill .map-search-field { height:calc(var(--search-field-height) - 2 * var(--border-width));
  min-height:calc(var(--search-field-height) - 2 * var(--border-width)); box-sizing:border-box;
  padding:0 var(--search-field-padding) 0 0; border:none; background:none; border-radius:0; }
.map-search-pill .map-search-field:focus-within { box-shadow:none; }
.map-search-pill .map-search-results { top:calc(100% + 10px); left:-40px; right:0; border-radius:12px;
  border-color:var(--border-light); }
.map-overlay-controls { top:12px; right:12px; display:flex; flex-direction:column; gap:8px; align-items:center; }
.map-overlay-save { bottom:24px; left:50%; transform:translateX(-50%); width:300px; max-width:calc(100% - 24px); }
/* A locked control has to say why it did nothing — top-centre, clear of the
   search capsule (left) and the round controls (right). */
.map-overlay-notice { top:12px; left:50%; transform:translateX(-50%); z-index:6;
  max-width:min(440px, calc(100% - 140px)); }
.map-notice-card { display:flex; align-items:center; gap:10px; padding:8px 8px 8px 12px; }
.map-notice-text { min-width:0; font-size:0.78125rem; color:var(--text-color); }
.map-notice-card .map-btn { flex:0 0 auto; padding:5px 10px; font-size:0.71875rem; }
.map-notice-card .map-row-action { opacity:.7; }
.map-notice-card .map-row-action:hover { opacity:1; }
.map-overlay-card { background:var(--surface-color); border:1px solid var(--border-medium);
  border-radius:10px; box-shadow:0 6px 20px rgba(0,0,0,.16); padding:10px; }
.map-segment { display:flex; background:var(--container-color-alt); border-radius:7px;
  padding:2px; gap:2px; border:1px solid var(--border-light); }
.map-segment-btn { flex:1; display:inline-flex; align-items:center; justify-content:center; gap:4px;
  padding:5px 8px; border:none; background:none; border-radius:5px; cursor:pointer; font-size:0.75rem;
  font-weight:500; color:var(--text-secondary); }
.map-segment-btn svg { width:14px; height:14px; }
.map-segment-btn:hover:not(:disabled) { color:var(--text-color); }
.map-segment-btn.active { background:var(--surface-color); color:var(--accent-color);
  box-shadow:0 1px 2px rgba(0,0,0,.12); }
.map-segment-btn:disabled { opacity:.45; cursor:not-allowed; }

/* ---- round map controls (zoom + layer picker + search) --------------- */
/* These sit ON the map, so every state stays fully opaque — a translucent
   hover token would let the tiles bleed through. */
.map-round-btn { display:grid; place-items:center; width:34px; height:34px; padding:0; border-radius:50%;
  border:1px solid var(--border-medium); background:var(--surface-color); color:var(--text-color);
  cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,.18); flex:0 0 auto; }
.map-round-btn svg { width:16px; height:16px; }
.map-round-btn:hover { background:var(--container-color-light); }
.map-round-btn.active { color:var(--accent-color); border-color:var(--accent-color); }
.map-round-btn.is-locked { color:var(--text-tertiary, var(--text-secondary)); opacity:.55; }
.map-layers { position:relative; display:grid; place-items:center; }
/* The style choices are plain circles continuing the button stack — no card. */
.map-layers-pop { position:absolute; top:calc(100% + 8px); right:0; display:flex; flex-direction:column; gap:8px; }

.map-save-card { display:flex; flex-direction:column; gap:8px; }
.map-save-head { display:flex; align-items:center; gap:6px; }
/* .map-row-action is opacity:0 by default — it is a hover-revealed action
   for list rows. On a floating card there is no row to hover and no second
   way out, so the dismiss has to be visible from the moment the card appears. */
.map-save-card .map-row-action { opacity:.7; }
.map-save-card .map-row-action:hover { opacity:1; }
.map-save-icon { color:var(--accent-color); display:grid; place-items:center; }
.map-save-icon svg { width:15px; height:15px; }
.map-save-coords { flex:1; font-size:0.6875rem; color:var(--text-secondary); font-variant-numeric:tabular-nums; }

.map-input { width:100%; padding:7px 9px; border:1px solid var(--border-medium); border-radius:7px;
  background:var(--container-color-alt); color:var(--text-color); font-size:0.78125rem; outline:none; }
.map-input:focus { border-color:var(--accent-color); }
.map-btn { display:inline-flex; align-items:center; justify-content:center; gap:5px; padding:7px 11px;
  border-radius:7px; border:1px solid var(--border-medium); background:var(--container-color-alt);
  color:var(--text-color); font-size:0.75rem; font-weight:600; cursor:pointer; }
.map-btn svg { width:14px; height:14px; }
.map-btn:hover:not(:disabled) { background:var(--hover-bg); }
.map-btn:disabled { opacity:.5; cursor:not-allowed; }
.map-btn-primary { background:var(--accent-color); border-color:var(--accent-color); color:#fff; }
.map-btn-primary:hover:not(:disabled) { filter:brightness(1.05); background:var(--accent-color); }

/* ---- planner (right sidebar) --------------------------------------- */
.map-planner .panel-body { padding:10px 12px 16px; display:flex; flex-direction:column; gap:10px; }
.map-mode .map-segment-btn { padding:6px 4px; }
/* Travel-mode glyphs are the segment's only content — they carry it at 18px. */
.map-mode .map-segment-btn svg { width:18px; height:18px; }

/* ---- route card (shared: sidebar directions + right-sidebar planner) --- */
.map-rc { display:flex; flex-direction:column; gap:var(--space-3); min-width:0;
  padding:var(--space-3); border-radius:var(--radius-lg); border:1px solid var(--border-light);
  background:var(--container-color-alt); }
/* Nested inside .map-place-card, which already draws a frame — one border,
   not two: the hairline stands in for it. */
.map-rc--panel { gap:var(--space-2); padding:var(--space-2) 0 0; border:none; border-radius:0;
  border-top:1px solid var(--border-light); background:none; }

.map-rc-head { display:flex; align-items:flex-start; gap:var(--space-2); min-width:0; }
.map-rc-headtext { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.map-rc-title { font-size:0.875rem; font-weight:700; color:var(--title-color);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.map-rc--panel .map-rc-title { font-size:0.8125rem; }
.map-rc-sub { font-size:0.6875rem; color:var(--text-tertiary, var(--text-secondary));
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* "Birmenstorf → Sion" — the arrow comes from CSS, never a translated literal.
   Tertiary + normal weight so the two place names carry the line, not the glue. */
.map-rc-title-to::before { content:'→'; margin:0 5px; font-weight:500;
  color:var(--text-tertiary, var(--text-secondary)); }
/* "Birmenstorf · Aargau" — the middot comes from CSS, never a translated literal. */
.map-rc-sub-context::before { content:'·'; margin:0 var(--space-1); }
.map-rc-close { flex:0 0 auto; display:grid; place-items:center; width:24px; height:24px; padding:0;
  border:none; border-radius:50%; background:var(--container-color-light); color:var(--text-secondary);
  cursor:pointer; transition:background var(--duration-fast) var(--ease-out),
  color var(--duration-fast) var(--ease-out); }
.map-rc-close:hover { background:var(--hover-bg); color:var(--text-color); }
.map-rc-close svg { width:13px; height:13px; }

/* The hero: big numerals, small unit words, muted distance chip beside them. */
.map-rc-hero { display:flex; align-items:center; gap:var(--space-2); flex-wrap:wrap; min-width:0;
  transition:opacity .12s ease; }
/* Re-planning: the previous answer stays put and dims. Never display:none and
   never a conditional mount — this row is 30px tall and the card jumps without
   it, which is exactly what a mode switch used to do. */
.map-rc-hero.is-stale { opacity:.4; }
.map-rc-time { display:flex; align-items:baseline; gap:1px; min-width:0;
  color:var(--title-color); font-variant-numeric:tabular-nums; }
.map-rc-num { font-size:1.75rem; font-weight:700; line-height:1.05; letter-spacing:-.01em; }
.map-rc-unit { font-size:0.875rem; font-weight:600; color:var(--text-secondary); margin-right:var(--space-2); }
.map-rc-unit:last-child { margin-right:0; }
.map-rc--panel .map-rc-num { font-size:1.375rem; }
.map-rc--panel .map-rc-unit { font-size:0.75rem; }
.map-rc-chip { flex:0 0 auto; padding:3px var(--space-2); border-radius:999px;
  background:var(--container-color-light); color:var(--text-secondary);
  font-size:0.71875rem; font-weight:600; font-variant-numeric:tabular-nums; white-space:nowrap; }
.map-rc-rule { height:1px; margin:0; border:none; background:var(--border-light); }

/* The spine's rows grow a frame here. The glyph column keeps its geometry, so
   the dotted connector follows the new left padding:
   glyph centre = padding-left(8) + 18/2 = 17 → spine left:16px (width 2). */
.map-rc-spine { display:flex; align-items:center; gap:var(--space-1); min-width:0; }
.map-rc .map-dir-row { padding:0 var(--space-1) 0 var(--space-2);
  border:1px solid var(--border-light); border-radius:var(--radius); background:var(--surface-color); }
.map-rc .map-dir-row + .map-dir-row { margin-top:var(--space-2); }
.map-rc .map-dir-row:not(:last-child)::before { left:16px; top:26px; bottom:-10px; }
.map-rc .map-add-stop-btn { padding-left:var(--space-2); }
/* The framed row shows focus on its own border. The flat field's accent
   underline used to draw that line a second time, full-width under the input. */
.map-rc .map-search.is-flat .map-search-field:focus-within { box-shadow:none; }
.map-rc .map-dir-row:focus-within { border-color:var(--search-field-focus);
  box-shadow:0 0 0 var(--focus-ring-width) var(--search-field-focus-ring); }

/* Start is the whole footer — saving lives on the bookmark above the card. */
.map-rc-foot { display:flex; min-width:0; }
.map-rc-start { flex:1; min-width:0; padding-top:9px; padding-bottom:9px; }

/* Turn-by-turn. Back reuses ChevronRight flipped — no icon just for one arrow. */
.map-rc-back { align-self:flex-start; display:inline-flex; align-items:center; gap:var(--space-1);
  padding:var(--space-1) var(--space-2) var(--space-1) var(--space-1); border:none;
  border-radius:var(--radius-sm); background:none; color:var(--text-secondary);
  font-size:0.75rem; font-weight:600; cursor:pointer; }
.map-rc-back:hover { background:var(--hover-bg); color:var(--text-color); }
.map-rc-back svg { width:14px; height:14px; transform:rotate(180deg); }
.map-rc-steps { display:flex; flex-direction:column; margin:0; padding:0; list-style:none;
  min-width:0; border:1px solid var(--border-light); border-radius:var(--radius);
  background:var(--surface-color); overflow:hidden; }
.map-rc-step { display:flex; align-items:flex-start; gap:var(--space-2); min-width:0; padding:var(--space-2); }
.map-rc-step + .map-rc-step { border-top:1px solid var(--border-light); }
.map-rc-step-no { flex:0 0 18px; height:18px; display:grid; place-items:center; border-radius:50%;
  background:var(--accent-tint-bg); color:var(--accent-tint-text, var(--accent-color));
  font-size:0.65625rem; font-weight:700; font-variant-numeric:tabular-nums; }
.map-rc-step-text { flex:1; min-width:0; font-size:0.78125rem; line-height:1.35;
  color:var(--text-color); overflow-wrap:anywhere; }
.map-rc-step-dist { flex:0 0 auto; font-size:0.6875rem; white-space:nowrap;
  color:var(--text-tertiary, var(--text-secondary)); font-variant-numeric:tabular-nums; }
/* At 245px the distance drops under the instruction instead of crushing it. */
.map-rc--panel .map-rc-step { flex-wrap:wrap; }
.map-rc--panel .map-rc-step-dist { margin-left:calc(18px + var(--space-2)); }

.map-export-row { display:flex; gap:6px; }
.map-export-row .map-btn { flex:1; }
.map-import { margin-top:2px; border-top:1px solid var(--border-light); padding-top:10px; }
.map-import-row { display:flex; gap:6px; }
.map-import-row .map-input { flex:1; }

/* ---- elevation profile --------------------------------------------- */
.map-elev { display:flex; flex-direction:column; gap:4px; }
.map-elev-head { display:flex; align-items:center; justify-content:space-between; }
.map-elev-title { font-size:0.6875rem; font-weight:600; text-transform:uppercase; letter-spacing:.04em;
  color:var(--text-secondary); }
.map-elev-stats { display:flex; gap:8px; font-size:0.6875rem; font-variant-numeric:tabular-nums; }
.map-elev-up { color:var(--tint-green-text, #15803d); }
.map-elev-down { color:var(--text-tertiary, var(--text-secondary)); }
.map-elev-svg { width:100%; height:88px; display:block; background:var(--container-color-alt);
  border:1px solid var(--border-light); border-radius:8px; }
.map-elev-area { fill:var(--accent-tint-bg); stroke:none; }
.map-elev-line { fill:none; stroke:var(--accent-color); stroke-width:1.5; vector-effect:non-scaling-stroke; }
.map-elev-cursor { stroke:var(--text-tertiary, var(--text-secondary)); stroke-width:1; stroke-dasharray:2 2; vector-effect:non-scaling-stroke; }
.map-elev-dot { fill:var(--accent-color); }
.map-elev-foot { font-size:0.6875rem; color:var(--text-tertiary, var(--text-secondary)); font-variant-numeric:tabular-nums; }

/* ---- waypoint marker (on the map) ---------------------------------- */
.map-wp-marker { width:24px; height:24px; border-radius:50%;
  background:var(--accent-color, #2563eb); border:2px solid #fff; box-shadow:0 2px 6px rgba(0,0,0,.35);
  display:grid; place-items:center; cursor:default; color:#fff; font-size:0.6875rem; font-weight:700; }

/* ---- note-pin marker + hover popup (on the map) -------------------- */
.map-note-marker { width:26px; height:34px; cursor:pointer; line-height:0;
  filter:drop-shadow(0 2px 3px rgba(0,0,0,.4)); }
.map-note-marker svg { width:100%; height:100%; display:block; }
/* The selected favourite place stands out: a larger pin drawn above the others. */
.map-place-marker.is-selected { width:34px; height:44px; z-index:3; filter:drop-shadow(0 3px 5px rgba(0,0,0,.5)); }
.maplibregl-popup.map-pin-popup-wrap .maplibregl-popup-content { padding:0; border-radius:8px;
  background:var(--surface-color); border:1px solid var(--border-medium); box-shadow:0 8px 24px rgba(0,0,0,.2);
  overflow:hidden; }
.maplibregl-popup.map-pin-popup-wrap .maplibregl-popup-tip { display:none; }
.map-pin-popup { min-width:120px; max-width:240px; padding:8px 10px; }
.map-pin-popup-title { font-size:0.78125rem; font-weight:600; color:var(--text-color); margin-bottom:3px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.map-stop-popup .map-pin-popup { min-width:0; padding:4px 8px; }
.map-stop-popup .map-pin-popup-title { margin-bottom:0; }
.map-pin-popup-row { display:flex; gap:8px; font-size:0.71875rem; line-height:1.5; }
.map-pin-popup-row > span:first-child { color:var(--text-tertiary, var(--text-secondary));
  text-transform:capitalize; flex:0 0 auto; }
.map-pin-popup-row > span:last-child { color:var(--text-color); min-width:0; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; margin-left:auto; }

/* ---- pin-source settings editor ------------------------------------ */
/* One radius for the whole surface — cards, chips, inputs and buttons all sit on var(--radius). */
.map-settings .settings-path-input { border-radius:var(--radius); }
/* Properties fields fill their value column. The shared dropdown otherwise keeps
   its Settings width (min(320px, 50%), never under 180px) and overflows a narrow
   sidebar. Two classes, because the host's own sizing rule is one. */
.select-field.map-select-fill { width:100%; min-width:0; max-width:100%; }
.props-info-row.map-props-control-row { align-items:center; }
.map-provider-description { margin:0 0 var(--space-3); padding-inline:var(--space-3); color:var(--text-secondary); font-size:var(--smaller-font-size); line-height:1.5; }
.map-provider-manage { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:var(--space-2); margin-top:var(--space-3); padding:4px var(--space-3); color:var(--text-secondary); font-size:var(--smaller-font-size); }
.map-provider-manage > button { margin-left:auto; flex-shrink:0; }
.map-usage-value { display:flex; flex-direction:column; gap:4px; overflow-wrap:anywhere; }
.map-usage-detail { color:var(--text-secondary); font-size:var(--smaller-font-size); }
.map-usage-note { margin-top:var(--space-3); }
/* Pin sources: one flat list on fixed columns. Every line runs edge to edge like
   the header bar's (the frame insets content 10px); the content keeps its inset. */
.map-sources-toolbar { display:flex; align-items:center; gap:var(--space-2); min-width:0; }
.map-sources-toolbar .map-sources-search { flex:1 1 auto; min-width:0; margin:0; }
.map-sources-search input { width:100%; min-width:0; border:0; background:none; outline:0; box-shadow:none; color:inherit; }
.map-sources-search input:focus, .map-sources-search input:focus-visible,
.map-pin-icon-browser .search-field input:focus, .map-pin-icon-browser .search-field input:focus-visible {
  border:0; outline:none; box-shadow:none; background:none;
}
.map-sources-fold { flex:0 0 auto; }
.map-sources-fold svg { width:var(--shell-glyph-medium, 16px); height:var(--shell-glyph-medium, 16px); }
.map-add-source-row { display:flex; align-items:center; flex:0 0 auto; padding:2px; margin-right:-2px; }
.map-add-source { display:inline-flex; align-items:center; justify-content:center; gap:6px; width:auto; margin:0; min-height:28px; padding:5px 10px; border:1px solid var(--border-medium); border-radius:var(--radius); background:var(--hover-bg); color:var(--text-color); font:inherit; }
.map-add-source svg { display:block; width:14px; height:14px; flex-shrink:0; padding:0; background:none; }
.map-add-source:hover { background:var(--selected-bg, var(--hover-bg)); border-color:var(--accent-color); }
.map-sources-empty > span { display:block; }
.map-source-list { display:flex; flex-direction:column; min-width:0; container-type:inline-size; }
.map-source-sortable { position:relative; min-width:0; }
/* The reorder announcement: the SDK 8.4 frame styles lack the shared visually-hidden rule. */
.map-source-list > .settings-visually-hidden { position:absolute; width:1px; height:1px; margin:-1px; padding:0; overflow:hidden; clip-path:inset(50%); white-space:nowrap; border:0; }
.map-source-sortable[data-drop-position]::before { content:''; position:absolute; z-index:2; left:-10px; right:-10px; height:var(--drop-knob, 6px); margin:0; background:var(--drop-indicator-fill, var(--accent-color)); pointer-events:none; }
.map-source-list .map-source-sortable[data-drop-position='before']::before { top:0; transform:translateY(-50%); }
.map-source-list .map-source-sortable[data-drop-position='after']::before { bottom:0; transform:translateY(50%); }
.map-source-row { min-width:0; margin:0 -10px; padding:0 10px; border-bottom:1px solid var(--border-light); }
/* The line under the toolbar sits directly on the first source. No pseudo-element here:
   host widgets copy their ancestors' classes into their own shadow tree with this
   stylesheet, so a generated box on an ancestor class pushes every widget aside. */
.map-source-list > .map-source-sortable:first-of-type > .map-source-row { border-top:1px solid var(--border-light); }
/* The head never changes when the source opens: fixed height, same content. */
.map-source-head { display:grid; grid-template-columns:22px 24px minmax(0, 1fr) auto 22px auto; align-items:center; column-gap:8px;
  height:44px; box-sizing:border-box; min-width:0; cursor:pointer; }
.map-source-grip, .map-source-disclosure { display:grid; place-items:center; width:22px; height:28px; border:0; border-radius:var(--radius-sm); padding:0; margin:0; background:none; color:var(--text-secondary); cursor:pointer; }
.map-source-grip { cursor:grab; color:var(--text-tertiary); }
.map-source-grip:active { cursor:grabbing; }
.map-source-grip:hover, .map-source-disclosure:hover { background:var(--hover-bg); color:var(--text-color); }
.map-source-grip svg, .map-source-disclosure svg { display:block; width:16px; height:16px; }
.map-source-disclosure[aria-expanded='true'] svg { transform:rotate(90deg); }
.map-source-disc { display:grid; place-items:center; width:24px; height:24px; box-sizing:border-box; border-radius:50%;
  background:var(--swatch-fill); border:2px solid var(--swatch-ring); color:var(--swatch-on); box-shadow:0 0 0 1px var(--border-light); }
.map-source-disc svg { width:12px; height:12px; }
.map-source-meta { display:flex; flex-direction:column; justify-content:center; gap:2px; min-width:0; }
.map-source-name { font-weight:600; color:var(--text-color); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.map-source-name.is-placeholder { color:var(--text-secondary); }
.map-source-sub { font-size:var(--smaller-font-size); color:var(--text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.map-source-warn { color:var(--tint-red-text, #b91c1c); }
.map-source-count { min-width:3ch; text-align:right; font-size:var(--smaller-font-size); font-variant-numeric:tabular-nums; color:var(--text-secondary); }
.map-source-row.is-off .map-source-name, .map-source-row.is-off .map-source-sub, .map-source-row.is-off .map-source-count { color:var(--text-tertiary, var(--text-secondary)); }
.map-source-row.is-off .map-source-disc { opacity:.45; }
/* What the source currently finds — a rule matching nothing must not stay silent. */
.map-source-stats { display:block; margin:0; font-size:var(--smaller-font-size); font-variant-numeric:tabular-nums; color:var(--text-secondary);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.map-source-stats.warn { color:var(--tint-red-text, #b91c1c); }
/* The open source: a label column right beside its controls, lines only between groups. */
.map-source-editor { min-width:0; padding:2px 0 var(--space-3) calc(22px + 24px + 2 * 8px); }
.map-source-form { display:grid; grid-template-columns:132px minmax(0, 440px); column-gap:var(--space-3); row-gap:6px; align-items:center; min-width:0; }
.map-source-form-label { min-width:0; overflow-wrap:anywhere; }
.settings-row-control.map-source-form-control { width:100%; min-width:0; min-height:32px; justify-content:flex-start; flex-wrap:nowrap; }
.map-source-form-control > [data-plugin-widget]:not([data-plugin-widget-inline]) { flex:1 1 0; min-width:0; }
.map-source-form-note { min-width:0; margin-top:-2px; font-size:var(--smaller-font-size); line-height:1.4; color:var(--text-secondary); }
.map-source-group { min-width:0; margin-top:var(--space-3); padding-top:var(--space-3); border-top:1px solid var(--border-light); }
.map-source-group-title { margin:0 0 6px; font-size:var(--smaller-font-size); font-weight:600; color:var(--text-secondary); }
.map-source-footer { display:flex; align-items:center; justify-content:space-between; gap:var(--space-3); }
.map-source-use { display:inline-flex; align-items:center; gap:var(--space-2); min-width:0; }
.map-source-match-eq { flex:0 0 auto; color:var(--text-secondary); }
.map-source-icon-btn { display:grid; place-items:center; flex:0 0 auto; width:28px; height:28px; box-sizing:border-box; padding:0;
  border:1px solid var(--border-medium); border-radius:50%; background:none; color:var(--text-color); cursor:pointer; }
.map-source-icon-btn svg { width:16px; height:16px; }
.map-pin-icon-browser { width:100%; padding:6px; box-sizing:border-box; }
.map-pin-icon-browser .search-field { width:100%; box-sizing:border-box; }
.map-pin-icon-browser .search-field input { width:100%; min-width:0; border:0; background:none; color:inherit; outline:none; box-shadow:none; }
.map-icon-grid { display:grid; grid-template-columns:repeat(6, minmax(0, 1fr)); gap:4px; padding:8px 0;
  max-height:180px; overflow-y:auto; }
.map-icon-opt { min-width:0; height:32px; display:grid; place-items:center;
  padding:4px; border:1px solid transparent; border-radius:var(--radius); background:none; color:var(--text-secondary); cursor:pointer; }
.map-icon-opt svg { width:18px; height:18px; }
.map-pin-icon-browser .map-hint { font-size:0.6875rem; line-height:1.4; margin:4px 0 8px; }
.map-icon-opt:hover { background:var(--hover-bg); color:var(--text-color); }
.map-icon-opt.active { border-color:var(--accent-color); background:var(--hover-bg); color:var(--accent-color); }
.map-icon-actions { display:flex; flex-wrap:wrap; gap:8px; }
/* Layout only — the kit's ColorField owns the chip itself, including the
   fill/ring drawing. Sizing the two up from the kit's default 20px is the only
   thing this surface asks of it, and the Calendar's note-date row asks for the
   same 26px, so the pair read as one control in both places. */
.map-source-color { display:flex; align-items:center; gap:6px; flex:0 0 auto; }
.map-source-color .settings-color-swatch { width:26px; height:26px; }
/* Layout only — these are kit Buttons, which own the frame, padding and
   typography. Same three rules on the Calendar's note-date row. */
.map-source-toggle { display:inline-flex; align-items:center; justify-content:center; gap:5px; }
.map-source-toggle svg { display:block; flex:0 0 auto; width:14px; height:14px; vertical-align:middle; }
.map-icon-opt:focus-visible, .map-source-icon-btn:focus-visible, .map-source-disclosure:focus-visible { outline:2px solid var(--accent-color); outline-offset:2px; }
@container (max-width:480px) {
  .map-source-editor { padding-left:0; }
  .map-source-form { grid-template-columns:minmax(0, 1fr); row-gap:4px; }
  .map-source-form-label:empty { display:none; }
  .map-source-form-label + .map-source-form-control { margin-bottom:4px; }
}
.map-sources-header { display:flex; align-items:center; gap:8px; flex:0 0 var(--app-bar-height, 38px); height:var(--app-bar-height, 38px); min-height:var(--app-bar-height, 38px); box-sizing:border-box; padding:0 10px; border-bottom:1px solid var(--border-light); font-size:var(--small-font-size); font-weight:600; background:var(--container-color); }
.map-sources-header > span:first-child { flex:1; min-width:0; }
.map-sources-description { margin:10px 0; color:var(--text-secondary); font-size:var(--smaller-font-size); line-height:1.5; }
.map-sidebar-sources { flex:0 0 auto; min-height:0; }
.map-sidebar-list { padding:4px 6px; }
.map-sidebar-row { display:flex; align-items:center; gap:4px; min-height:36px; min-width:0; }
.map-sidebar-row:hover { background:var(--hover-bg); border-radius:var(--radius); }
.map-sidebar-title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.map-sidebar-details { display:flex; flex-direction:column; gap:6px; padding:4px 10px 12px 54px; color:var(--text-secondary); font-size:var(--smaller-font-size); overflow-wrap:anywhere; }
.map-sidebar-details button { align-self:flex-start; border:0; background:none; color:var(--accent-color); padding:0; font:inherit; cursor:pointer; }

.map-sidebar-focus { display:flex; flex:1; min-width:0; align-items:center; gap:6px; height:32px; border:0; padding:0; background:none; color:var(--text-color); font:inherit; text-align:left; cursor:pointer; }

/* ---- searched-address marker (on the map) -------------------------- */
.map-search-marker { width:26px; height:34px; cursor:default;
  filter:drop-shadow(0 2px 3px rgba(0,0,0,.4)); }
.map-search-marker svg { width:100%; height:100%; display:block;
  fill:var(--accent-color, #2563eb); stroke:#fff; stroke-width:1.5; }
.map-search-marker svg circle { fill:#fff; stroke:none; }

/* ---- reading-view embed -------------------------------------------- */
.map-embed { position:relative; width:100%; height:280px; border-radius:10px; overflow:hidden;
  border:1px solid var(--border-medium); margin:8px 0; }
.map-file-embed { height:320px; min-height:0; border-radius:3px; overflow:hidden; }
.map-embed-error { display:flex; align-items:center; justify-content:center; height:auto; padding:14px;
  color:var(--text-secondary); font-size:0.78125rem; background:var(--container-color-alt); }
.map-embed-label { position:absolute; top:8px; left:8px; z-index:2; padding:3px 8px; border-radius:6px;
  background:var(--surface-color); border:1px solid var(--border-light); font-size:0.71875rem; font-weight:600;
  color:var(--text-color); box-shadow:0 2px 8px rgba(0,0,0,.14); }

/* ---- dashboard map row ---------------------------------------------- */
.map-dash-row { margin:14px 0; }
.map-dash-row-head { display:flex; align-items:baseline; gap:8px; margin-bottom:6px; }
.map-dash-row-title { font-size:0.8125rem; font-weight:600; color:var(--title-color); }
.map-dash-row-sub { font-size:0.75rem; color:var(--text-secondary); }
.map-dash-map { margin:0; height:auto; }

.map-meta-empty { padding:4px var(--space-3); font-size:var(--smaller-font-size); line-height:1.5;
  color:var(--text-tertiary, var(--text-secondary)); }

/* ---- reduced motion -------------------------------------------------- */
/* Transitions and animations only. NOT \`transform: none\` — several elements
   here are *positioned* by a transform (the top bar's centring translate, the
   settings caret's open state, the flipped Back chevron), and killing those
   moves them rather than calming them. */
@media (prefers-reduced-motion: reduce) {
  .map-rc-close, .map-icon-opt, .map-source-toggle,
  .map-add-source, .map-rc-hero {
    transition:none; animation:none;
  }
  /* The spinner is the one animation that carries meaning, so it degrades to a
     static ring rather than disappearing — the accent arc still says "busy". */
  .map-spinner { animation:none; }
}
`

const MAPLIBRE_STYLE_ID = 'notes-map-maplibre-css'
const STYLE_ID = 'notes-map-styles'

function upsert(id: string, css: string): void {
  let el = document.getElementById(id) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = id
    document.head.appendChild(el)
  }
  el.textContent = css
}

/** Inject (or refresh, on hot reload) the MapLibre stylesheet + the plugin CSS. */
export function injectStyles(): () => void {
  upsert(MAPLIBRE_STYLE_ID, maplibreCss)
  upsert(STYLE_ID, CSS)
  const maplibre = document.getElementById(MAPLIBRE_STYLE_ID)
  const plugin = document.getElementById(STYLE_ID)
  return () => {
    if (document.getElementById(MAPLIBRE_STYLE_ID) === maplibre) maplibre?.remove()
    if (document.getElementById(STYLE_ID) === plugin) plugin?.remove()
  }
}
