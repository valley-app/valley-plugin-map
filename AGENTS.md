# Map plugin

- Keep Map settings responsive in the real sandbox: render layout-only rows and sections locally with shared Settings classes; collapsed pin sources must not mount host-backed fields, colour pickers, or action widgets. Mount editing controls only for expanded sources and verify the installed UI.
- Keep Add source visually distinct with a compact accent treatment and a clear plus icon; avoid an oversized dashed placeholder. When asked to remove red source errors, remove the identified broken rules from the development configuration rather than hiding validation warnings.
- Search fields use the shared container focus ring only; explicitly clear native input focus and focus-visible borders, outlines, and shadows, and verify the focused field in the sandbox. Put spacing around host buttons on a local wrapper so their measured bounds are not clipped.
- Keep the pin icon picker compact: small icon-only cells with accessible names and tooltips, not oversized captioned tiles.

- Map pin sources use compact Add source buttons with a plain aligned plus, chevrons for details, persisted shared drag ordering in Settings and the left sidebar, and a 37px content / 1px separator header with a master visibility switch. Keep icon and text inside one inline-flex button child in the sandbox.

- Zero matching notes are a neutral empty state: show “0 notes found” without red warning styling. Preserve validation for notes with unusable locations.

- Pin sources uses the shared Settings list-header class so its master-switch bar spans the complete pane width while descriptions, search and source cards retain their inset.
