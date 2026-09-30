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
.map-extension-row { width: 100%; border: 0; background: transparent; color: inherit; text-align: left; font: inherit; }
.map-extension-row:disabled { opacity: 1; cursor: default; }
.map-extension-row .map-row-title, .map-extension-row .map-row-sub { white-space: pre-line; overflow-wrap: anywhere; }
.map-tab { position: relative; }
.map-tab-drop::before { content: ''; position: absolute; left: -3px; top: 4px; bottom: 4px; width: 2px; background: var(--accent-color); }
.map-tabs { display:flex; align-items:center; gap:var(--space-1, 4px); width:100%; box-sizing:border-box;
  height:var(--app-bar-height); padding:0 5px; flex-shrink:0;
  background:var(--container-color); border-bottom:1px solid var(--border-light); }
.map-tab { display:grid; place-items:center; width:26px; height:26px; flex:0 0 auto; padding:0;
  border:none; border-radius:var(--radius-sm); background:transparent; color:var(--text-tertiary, var(--text-secondary));
  cursor:pointer; -webkit-app-region:no-drag; }
.map-tab svg { width:15px; height:15px; }
.map-tab:hover { background:var(--hover-bg); color:var(--title-color, var(--text-color)); }
.map-tab.active { background:var(--hover-bg); color:var(--accent-color); }

.map-tab-head { display:flex; align-items:center; gap:6px; padding:6px 10px; color:var(--text-secondary);
  font-size:0.6875rem; font-weight:600; text-transform:uppercase; letter-spacing:.03em; }
.map-tab-head > span:first-child { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.map-tab-body { display:flex; flex-direction:column; gap:6px; padding:3px 8px 0; }

/* ---- add / edit a favourite place ------------------------------------ */
/* Layout only: the name input is .map-input, the address field is the shared
   SearchBox and the document field is the settings kit's VaultFileField,
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
.maplibregl-popup.map-pin-popup-wrap .maplibregl-popup-content { padding:0; border-radius:8px;
  background:var(--surface-color); border:1px solid var(--border-medium); box-shadow:0 8px 24px rgba(0,0,0,.2);
  overflow:hidden; }
.maplibregl-popup.map-pin-popup-wrap .maplibregl-popup-tip { display:none; }
.map-pin-popup { min-width:120px; max-width:240px; padding:8px 10px; }
.map-pin-popup-title { font-size:0.78125rem; font-weight:600; color:var(--text-color); margin-bottom:3px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
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
.map-source-row { display:flex; flex-direction:column; gap:12px; padding:14px 16px; margin:10px 0;
  border:1px solid var(--border-light); border-radius:var(--radius); background:var(--container-color-alt);
  transition:border-color .15s ease, box-shadow .15s ease; }
.map-source-row:hover { border-color:var(--border-medium); box-shadow:0 1px 3px rgba(0,0,0,.05); }
.map-source-head { display:flex; align-items:center; flex-wrap:wrap; gap:10px; min-width:0; }
.map-source-head > .settings-path-input, .map-source-head > .settings-input-stack,
.map-source-head > [data-plugin-widget]:not([data-plugin-widget-inline]) { flex:1 1 150px; min-width:0; }
.map-source-summary { flex:1; min-width:0; display:flex; flex-direction:column; align-items:flex-start; gap:3px; border:0; padding:0; background:none; color:var(--text-color); font:inherit; text-align:left; cursor:pointer; }
.map-source-summary span { font-weight:600; }
.map-source-summary small { font-size:var(--smaller-font-size); color:var(--text-secondary); overflow-wrap:anywhere; }
.map-source-head .map-source-title { width:100%; min-width:0; }
.map-source-swatch { width:30px; height:30px; flex-shrink:0; border-radius:var(--radius); display:grid;
  place-items:center; box-sizing:border-box; padding:0; cursor:pointer; transition:transform .12s ease;
  background:var(--swatch-fill); border:2px solid var(--swatch-ring);
  color:var(--swatch-on); box-shadow:0 1px 2px rgba(0,0,0,.15); }
button.map-source-swatch:hover { transform:scale(1.06); }
.map-source-swatch svg { width:16px; height:16px; }
.map-pin-icon-browser { width:248px; max-width:calc(100vw - 32px); padding:6px; box-sizing:border-box; }
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
.map-icon-opt:focus-visible, .map-source-swatch:focus-visible, .map-source-disclosure:focus-visible { outline:2px solid var(--accent-color); outline-offset:2px; }
.map-icon-actions { display:flex; flex-wrap:wrap; gap:8px; }
.map-source-title { flex:1; min-width:0; border-color:transparent; background:transparent;
  font-size:0.875rem; font-weight:600; }
.map-source-title:hover { background:var(--hover-bg); }
.map-source-title:focus { border-color:var(--border-medium); background:var(--surface-color); }
.map-source-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px 12px; }
.map-source-field { display:flex; flex-direction:column; gap:5px; min-width:0; }
.map-source-grid > .wide { grid-column:1 / -1; }
.map-source-field > label { font-size:0.625rem; font-weight:600; text-transform:uppercase; letter-spacing:.05em;
  color:var(--text-tertiary, var(--text-secondary)); }
.map-source-grid .settings-input-stack, .map-source-grid .settings-path-field,
.map-source-grid .settings-path-control, .map-source-grid .settings-select, .map-source-grid .settings-select-trigger,
.map-source-grid .settings-path-input { width:100%; min-width:0; max-width:100%; box-sizing:border-box; }
.map-source-grid [data-plugin-widget] { min-width:0; }
.map-source-hover-row > [data-plugin-widget]:not([data-plugin-widget-inline]) { flex:1; min-width:0; }
.map-source-grid .settings-input-stack { gap:4px; }
.map-source-field > label { margin:0; position:static; }
.map-source-field .settings-path-error { position:static; white-space:normal; margin:4px 0 0; }
.map-source-help { margin:0; color:var(--text-secondary); font-size:0.75rem; line-height:1.5; }
.map-source-disclosure { align-self:flex-start; border:0; background:none; color:var(--text-secondary); padding:0; font:inherit; font-size:0.75rem; cursor:pointer; }
.map-source-row { container-type:inline-size; }
.map-sources-search { margin:12px 0; }
.map-sources-search input { width:100%; min-width:0; border:0; background:none; outline:0; box-shadow:none; color:inherit; }
.map-sources-search input:focus, .map-sources-search input:focus-visible,
.map-pin-icon-browser .search-field input:focus, .map-pin-icon-browser .search-field input:focus-visible {
  border:0; outline:none; box-shadow:none; background:none;
}
@container (max-width:480px) {
  .map-source-grid { grid-template-columns:minmax(0, 1fr); }
  .map-source-grid .map-source-location { grid-template-columns:minmax(0, 1fr); }
}

/* Layout only — the kit's ColorField owns the chip itself, including the
   fill/ring drawing. Sizing the two up from the kit's default 20px is the only
   thing this surface asks of it, and the Calendar's note-date row asks for the
   same 26px, so the pair read as one control in both places. */
.map-source-color { display:flex; align-items:center; gap:6px; flex:0 0 auto; }
.map-source-color .settings-color-swatch { width:26px; height:26px; }
.map-source-location { display:grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items:start; gap:8px; }
.map-source-location .settings-path-input { flex:1; min-width:0; }
.map-source-hover { display:flex; flex-direction:column; align-items:stretch; gap:6px; }
.map-source-hover-row { display:flex; align-items:center; gap:6px; width:100%; }
.map-source-hover-row .settings-path-input { flex:1; min-width:0; }
.map-source-hover-remove { flex:0 0 auto; width:28px; height:28px; display:grid; place-items:center;
  border:none; border-radius:var(--radius); background:none; color:var(--text-tertiary, var(--text-secondary));
  cursor:pointer; font-size:1.0625rem; line-height:1; opacity:.5; transition:opacity .12s ease, background .12s ease; }
.map-source-hover-row:hover .map-source-hover-remove { opacity:1; }
.map-source-hover-remove:hover { background:var(--hover-bg); color:var(--text-color); }
/* What the source currently finds — a rule matching nothing must not stay silent. */
.map-source-stats { margin:0; font-size:0.71875rem; font-variant-numeric:tabular-nums;
  color:var(--text-tertiary, var(--text-secondary)); }
.map-source-stats.warn { color:var(--tint-red-text, #b91c1c); }
.map-source-actions { display:flex; align-items:center; gap:6px; flex:0 0 auto; }
/* Layout only — these are kit Buttons, which own the frame, padding and
   typography. Same three rules on the Calendar's note-date row. */
.map-source-toggle { gap:5px; }
.map-source-toggle svg { width:14px; height:14px; }
.map-add-source-row { padding:12px 0 8px; }


.map-source-list { display:flex; flex-direction:column; gap:12px; }
.map-source-list .map-source-row { margin:0; padding:12px; gap:10px; }
.map-source-sortable { position:relative; min-width:0; }
.map-source-sortable[data-drop-position]::before { content:''; position:absolute; z-index:2; left:0; right:0; height:var(--drop-knob, 6px); margin:0; background:var(--drop-indicator-fill, var(--accent-color)); pointer-events:none; }
.map-source-list .map-source-sortable[data-drop-position='before']::before { top:-6px; transform:translateY(-50%); }
.map-source-list .map-source-sortable[data-drop-position='after']::before { bottom:-6px; transform:translateY(50%); }
.map-sidebar-list .map-source-sortable[data-drop-position='before']::before { top:0; transform:translateY(-50%); }
.map-sidebar-list .map-source-sortable[data-drop-position='after']::before { bottom:0; transform:translateY(50%); }
.map-source-head { flex-wrap:nowrap; min-width:0; gap:8px; }
.map-source-grip, .map-source-disclosure { display:grid; place-items:center; flex:0 0 22px; width:22px; height:28px; align-self:center; border:0; border-radius:var(--radius-sm); padding:0; margin:0; background:none; color:var(--text-secondary); cursor:pointer; }
.map-source-grip { cursor:grab; color:var(--text-tertiary); }
.map-source-grip:active { cursor:grabbing; }
.map-source-grip:hover, .map-source-disclosure:hover { background:var(--hover-bg); color:var(--text-color); }
.map-source-grip svg, .map-source-disclosure svg { display:block; width:16px; height:16px; }
.map-source-disclosure[aria-expanded='true'] svg, .map-sources-heading[aria-expanded='true'] > svg { transform:rotate(90deg); }
.map-source-summary { flex:1; min-width:0; border:0; padding:0; background:none; color:var(--text-color); font:inherit; font-weight:600; text-align:left; cursor:pointer; overflow-wrap:anywhere; }
.map-source-head > [data-plugin-widget-inline] { flex:0 0 auto; }
.map-source-details { display:flex; flex-direction:column; gap:12px; min-width:0; }
.map-source-tools { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; }
.map-source-toggle { display:inline-flex; align-items:center; justify-content:center; }
.map-source-toggle svg { display:block; flex:0 0 auto; vertical-align:middle; }
.map-add-source-row { display:flex; align-items:center; padding:12px 0 4px; }
.map-add-source { display:inline-flex; align-items:center; justify-content:center; gap:6px; width:auto; margin:0; min-height:28px; padding:5px 10px; border:1px solid var(--border-medium); border-radius:var(--radius); background:var(--hover-bg); color:var(--text-color); font:inherit; }
.map-add-source svg, .map-add-field svg { display:block; width:14px; height:14px; flex-shrink:0; padding:0; background:none; }
.map-add-source:hover { background:var(--selected-bg, var(--hover-bg)); border-color:var(--accent-color); }
.map-add-field { display:inline-flex; align-items:center; gap:6px; align-self:flex-start; }
.map-sources-header { display:flex; align-items:center; gap:8px; flex:0 0 var(--app-bar-height, 38px); height:var(--app-bar-height, 38px); min-height:var(--app-bar-height, 38px); box-sizing:border-box; padding:0 10px; border-bottom:1px solid var(--border-light); font-size:var(--small-font-size); font-weight:600; background:var(--container-color); }
.map-sources-header > span:first-child, .map-sources-heading { flex:1; min-width:0; }
.map-sources-description { margin:10px 0; color:var(--text-secondary); font-size:var(--smaller-font-size); line-height:1.5; }
.map-sidebar-sources { flex:0 0 auto; min-height:0; }
.map-sidebar-sources .map-sources-header { position:sticky; top:0; z-index:1; }
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
  .map-rc-close, .map-icon-opt,
  .map-source-row, .map-source-swatch, .map-source-toggle, .map-source-hover-remove,
  .map-add-field, .map-add-source, .map-rc-hero {
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
