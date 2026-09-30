import { React } from './runtime'
import { mapIconSvg, useMapIcons } from './pinIcons'
import { DEFAULT_PIN_ICONS } from './pinIconDefaults'
import type { ReactElement, ReactNode } from 'react'
import { readPaletteColor } from '@valley/plugin-sdk/palette'

/**
 * Inline SVG glyphs drawn with the host's React (Lucide-style). Plugins cannot
 * bundle react-icons (it would pull in a second React), so the glyphs are
 * hand-rolled and stay monochrome via `currentColor`. Each is a component so the
 * JSX only runs at render time — never at module top level.
 */
type IconProps = { className?: string; title?: string }

const Svg = (props: IconProps & { children: ReactNode }): ReactElement =>
  React.createElement(
    'svg',
    {
      className: props.className,
      width: '1em',
      height: '1em',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true
    },
    props.title ? <title>{props.title}</title> : null,
    props.children
  )

/**
 * Filled glyphs keep their source viewBox (they are traced artwork, not our
 * 24×24 stroke grid), so they get their own wrapper. A plugin may never
 * import `react-icons`.
 */
const FilledSvg = (props: IconProps & { viewBox: string; children: ReactNode }): ReactElement =>
  React.createElement(
    'svg',
    {
      className: props.className,
      width: '1em',
      height: '1em',
      viewBox: props.viewBox,
      fill: 'currentColor',
      'aria-hidden': true
    },
    props.title ? <title>{props.title}</title> : null,
    props.children
  )

export const MapPin = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></Svg>
)

/**
 * Circum `route` (react-icons `CiRoute`), hand-inlined for the reason above. Its
 * artwork is filled outlines about one unit thick on the 24 grid, which renders
 * at well under a pixel in a 14–15px slot — the thin stroke on top is what keeps
 * it as legible as the 2px-stroke glyphs it sits beside.
 */
export const RouteIcon = (p: IconProps): ReactElement => (
  <FilledSvg {...p} viewBox="0 0 24 24">
    <path
      stroke="currentColor"
      strokeWidth="0.5"
      d="M21.792,17.086c-.58-.58-1.16-1.17-1.75-1.75-.08-.08-.16-.17-.25-.25a.492.492,0,0,0-.7,0,.5.5,0,0,0,0,.71l1.14,1.14H9.282a2.22,2.22,0,0,1,0-4.44h3a3.215,3.215,0,1,0,0-6.43H7.012a2.5,2.5,0,1,0,0,1h5.27a2.215,2.215,0,1,1,0,4.43h-3a3.22,3.22,0,1,0,0,6.44h10.96l-.9.9c-.09.08-.17.17-.25.25a.5.5,0,0,0,0,.71.511.511,0,0,0,.7,0l1.75-1.75.25-.25A.5.5,0,0,0,21.792,17.086ZM4.562,8.066a1.5,1.5,0,1,1,1.5-1.5A1.5,1.5,0,0,1,4.562,8.066Z"
    />
  </FilledSvg>
)

export const Search = (p: IconProps): ReactElement => (
  <Svg {...p}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></Svg>
)

export const Plus = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
)

export const Minus = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M5 12h14" /></Svg>
)


export const Copy = (p: IconProps): ReactElement => (
  <Svg {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Svg>
)


export const Settings = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" /><circle cx="12" cy="12" r="3" /></Svg>
)

/** Basemap choices in the map's layer picker: a road grid and a satellite. */
export const Road = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M4 21 8 3M20 21 16 3" /><path d="M12 4v3M12 10.5v3M12 17v3" /></Svg>
)

export const Sun = (p: IconProps): ReactElement => (
  <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" /></Svg>
)

export const Moon = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" /></Svg>
)

export const Mountain = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="m3 20 6-12 4 7 3-12 6 17H3Z" /><path d="m14 11 2 2 2-2" /></Svg>
)

export const Satellite = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z" />
  </Svg>
)

export const Trash = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></Svg>
)

export const GripVertical = (p: IconProps): ReactElement => <Svg {...p}><circle cx="9" cy="5" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="9" cy="19" r="1" /><circle cx="15" cy="5" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="19" r="1" /></Svg>

export const X = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>
)

export const Crosshair = (p: IconProps): ReactElement => (
  <Svg {...p}><circle cx="12" cy="12" r="8" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></Svg>
)

export const Layers = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></Svg>
)

export const Download = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></Svg>
)

export const Upload = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" /></Svg>
)

export const ChevronRight = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="m9 18 6-6-6-6" /></Svg>
)

/** Lucide `navigation` — the paper-plane arrow on the route card's Start button. */
export const Navigation = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M3 11l19-9-9 19-2-8-8-2Z" /></Svg>
)

/** Lucide `bookmark` — the one save affordance for a place or a route. Outline
 *  by default; `.map-btn.active svg` fills it once the thing is saved. */
export const Bookmark = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z" /></Svg>
)

/** Ionicons `car-sport` (react-icons `IoCarSportSharp`). */
export const Car = (p: IconProps): ReactElement => (
  <FilledSvg {...p} viewBox="0 0 512 512">
    <path d="M488 224c-3-5-32.61-17.79-32.61-17.79 5.15-2.66 8.67-3.21 8.67-14.21 0-12-.06-16-8.06-16h-27.14c-.11-.24-.23-.49-.34-.74-17.52-38.26-19.87-47.93-46-60.95C347.47 96.88 281.76 96 256 96s-91.47.88-126.49 18.31c-26.16 13-25.51 19.69-46 60.95 0 .11-.21.4-.4.74H55.94c-7.94 0-8 4-8 16 0 11 3.52 11.55 8.67 14.21C56.61 206.21 28 220 24 224s-8 32-8 80 4 96 4 96h11.94c0 14 2.06 16 8.06 16h80c6 0 8-2 8-16h256c0 14 2 16 8 16h82c4 0 6-3 6-16h12s4-49 4-96-5-75-8-80zm-362.74 44.94A516.94 516.94 0 0 1 70.42 272c-20.42 0-21.12 1.31-22.56-11.44a72.16 72.16 0 0 1 .51-17.51L49 240h3c12 0 23.27.51 44.55 6.78a98 98 0 0 1 30.09 15.06C131 265 132 268 132 268zm247.16 72L368 352H144s.39-.61-5-11.18c-4-7.82 1-12.82 8.91-15.66C163.23 319.64 208 304 256 304s93.66 13.48 108.5 21.16C370 328 376.83 330 372.42 341zm-257-136.53a96.23 96.23 0 0 1-9.7.07c2.61-4.64 4.06-9.81 6.61-15.21 8-17 17.15-36.24 33.44-44.35 23.54-11.72 72.33-17 110.23-17s86.69 5.24 110.23 17c16.29 8.11 25.4 27.36 33.44 44.35 2.57 5.45 4 10.66 6.68 15.33-2 .11-4.3 0-9.79-.19zm347.72 56.11C461 273 463 272 441.58 272a516.94 516.94 0 0 1-54.84-3.06c-2.85-.51-3.66-5.32-1.38-7.1a93.84 93.84 0 0 1 30.09-15.06c21.28-6.27 33.26-7.11 45.09-6.69a3.22 3.22 0 0 1 3.09 3 70.18 70.18 0 0 1-.49 17.47z" />
  </FilledSvg>
)

/** Bootstrap `person-walking` (react-icons `BsPersonWalking`). */
export const Walk = (p: IconProps): ReactElement => (
  <FilledSvg {...p} viewBox="0 0 16 16">
    <path d="M9.5 1.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M6.44 3.752A.75.75 0 0 1 7 3.5h1.445c.742 0 1.32.643 1.243 1.38l-.43 4.083a1.8 1.8 0 0 1-.088.395l-.318.906.213.242a.8.8 0 0 1 .114.175l2 4.25a.75.75 0 1 1-1.357.638l-1.956-4.154-1.68-1.921A.75.75 0 0 1 6 8.96l.138-2.613-.435.489-.464 2.786a.75.75 0 1 1-1.48-.246l.5-3a.75.75 0 0 1 .18-.375l2-2.25Z" />
    <path d="M6.25 11.745v-1.418l1.204 1.375.261.524a.8.8 0 0 1-.12.231l-2.5 3.25a.75.75 0 1 1-1.19-.914zm4.22-4.215-.494-.494.205-1.843.006-.067 1.124 1.124h1.44a.75.75 0 0 1 0 1.5H11a.75.75 0 0 1-.531-.22Z" />
  </FilledSvg>
)

/** Phosphor `person-simple-bike` (react-icons `PiPersonSimpleBikeFill`). */
export const Bike = (p: IconProps): ReactElement => (
  <FilledSvg {...p} viewBox="0 0 256 256">
    <path d="M136,52a28,28,0,1,1,28,28A28,28,0,0,1,136,52ZM240,176a40,40,0,1,1-40-40A40,40,0,0,1,240,176Zm-16,0a24,24,0,1,0-24,24A24,24,0,0,0,224,176Zm-24-64a8,8,0,0,0-8-8H155.31L125.66,74.34a8,8,0,0,0-11.32,0l-32,32a8,8,0,0,0,0,11.32L120,155.31V200a8,8,0,0,0,16,0V152a8,8,0,0,0-2.34-5.66L99.31,112,120,91.31l26.34,26.35A8,8,0,0,0,152,120h40A8,8,0,0,0,200,112ZM96,176a40,40,0,1,1-40-40A40,40,0,0,1,96,176Zm-16,0a24,24,0,1,0-24,24A24,24,0,0,0,80,176Z" />
  </FilledSvg>
)

export const Star = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8 6.8 19.2l1-5.8L3.5 9.2l5.9-.9L12 3Z" /></Svg>
)

export const FileText = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M9 13h6M9 17h6" /></Svg>
)

/** ✎ — edit a saved place (rename, move, attach a note). */
export const Pencil = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></Svg>
)

export const Eye = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></Svg>
)

export const EyeOff = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="m3 3 18 18" /><path d="M10.6 6.1A9.7 9.7 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.3 3.9" /><path d="M6.6 6.6A17 17 0 0 0 2 12s3.5 6 10 6a9.7 9.7 0 0 0 3.4-.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></Svg>
)

/** ⇅ — reverse the stop list (start ⇄ destination). */
export const SwapVertical = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M7 20V4" /><path d="m3 8 4-4 4 4" /><path d="M17 4v16" /><path d="m13 16 4 4 4-4" /></Svg>
)

/**
 * ◎ — the start of the route: a ring with a solid core, the counterpart to the
 * finish flag at the other end of the dashed spine. Every stop glyph is centred
 * on (12,12) of the same 24 grid so the whole column lands on one axis — the
 * spine is drawn against that centre line, and a glyph drawn off it reads as a
 * misaligned row rather than as art.
 */
export const StartDot = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
  </Svg>
)

/** ▢ — an intermediate stop: neutral, distinct from both endpoints. */
export const ViaSquare = (p: IconProps): ReactElement => (
  <Svg {...p}><rect x="6" y="6" width="12" height="12" rx="3" /></Svg>
)

/**
 * ⛳ — the finish. Game-icons `golf-flag` (react-icons `GiGolfFlag`), inlined
 * like every other traced glyph here, and reduced to the pole and its banner:
 * the source also draws a mound and a golf ball beside it, which at an 18px
 * glyph collapse into a smear and a stray dot rather than into scenery.
 *
 * Two corrections make it land on the stop spine. The translate: the source
 * plants its pole at x≈200 with the banner flying right, so centring the
 * *drawing* would leave the pole beside the dashes instead of at the end of
 * them — this puts the pole itself on 256, which is the column's axis. The
 * stroke: a 16-unit pole in a 512 viewBox is barely half a pixel once the glyph
 * is 18px, so it needs the extra weight to read at all next to a 2px-stroke ring.
 */
export const FinishFlag = (p: IconProps): ReactElement => (
  <FilledSvg {...p} viewBox="0 0 512 512">
    <path
      transform="translate(55 0)"
      stroke="currentColor"
      strokeWidth="13"
      strokeLinejoin="round"
      d="M193 33v443.55c5.33.678 10.708 1.133 16.123 1.307l-.076-278.337L383.727 136 209.014 72.467 209.002 33H193z"
    />
  </FilledSvg>
)

/** ⊕ — "Add destination", sitting in the same glyph column as the ring. */
export const PlusCircle = (p: IconProps): ReactElement => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></Svg>
)

/** ↑ — reset the camera to north-up, flat. Rendered only while rotated/tilted. */
export const Compass = (p: IconProps): ReactElement => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="m14.5 9.5-5.6 2.1-2.1 5.6 5.6-2.1 2.1-5.6Z" /></Svg>
)

/**
 * Glyphs drawn inside a note-pin marker (see `pinMarkerSvg`) and shown in the
 * settings icon picker / sidebar rows. Each value is inner SVG markup in the
 * shared 24×24 space, stroke-based like the icons above.
 */
export const PIN_GLYPHS: { id: string; labelKey: string; markup: string }[] = [
  { id: 'pin', labelKey: 'auto.46856bf70223', markup: DEFAULT_PIN_ICONS.pin },
  { id: 'person', labelKey: 'auto.8c41ae88467f', markup: DEFAULT_PIN_ICONS.person },
  { id: 'home', labelKey: 'auto.70f8bb9a8a53', markup: DEFAULT_PIN_ICONS.home },
  { id: 'star', labelKey: 'auto.85a7de6e2705', markup: DEFAULT_PIN_ICONS.star },
  { id: 'briefcase', labelKey: 'auto.00040bab8a78', markup: DEFAULT_PIN_ICONS.briefcase },
  { id: 'heart', labelKey: 'auto.2a37335eebda', markup: DEFAULT_PIN_ICONS.heart },
  { id: 'flag', labelKey: 'auto.a774409a00c2', markup: DEFAULT_PIN_ICONS.flag },
  { id: 'cart', labelKey: 'auto.55de88709232', markup: DEFAULT_PIN_ICONS.cart }
]

const GLYPH_MARKUP: Record<string, string> = Object.fromEntries(PIN_GLYPHS.map((g) => [g.id, g.markup]))

/** Inner markup for a glyph id (falls back to the plain dot). */
export function glyphMarkup(id: string): string {
  return GLYPH_MARKUP[id] ?? GLYPH_MARKUP.pin
}

/** A React glyph (colored via `currentColor`) for sidebar rows / pickers. */
export const PinGlyph = ({ id, className }: { id: string; className?: string }): ReactElement => {
  useMapIcons()
  return React.createElement('svg', {
    className,
    width: '1em',
    height: '1em',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    dangerouslySetInnerHTML: { __html: mapIconSvg(id) }
  })
}

/**
 * A full teardrop marker SVG string for a DOM `Marker` element: a color-filled
 * pin with the glyph rendered in white inside its head. Anchored bottom-centre.
 *
 * The colours are resolved to concrete hexes here, at draw time, rather than
 * left as `var(--color-…)`: this markup is handed to a MapLibre `Marker`, one of
 * the three places the app allows `readPaletteColor` because CSS custom
 * properties cannot reach it. Resolving at draw time (not once at construction)
 * is what keeps a theme switch and a user's `.valley/design/*.css` working.
 */
export function pinMarkerSvg(color: string, glyphId: string, borderColor = '#ffffff', iconSvg?: string): string {
  const fill = readPaletteColor(color)
  const stroke = readPaletteColor(borderColor)
  return (
    `<svg viewBox="0 0 24 32" width="26" height="34" aria-hidden="true">` +
    `<path d="M12 31C7 24 2 18.5 2 11.5A10 10 0 0 1 22 11.5C22 18.5 17 24 12 31Z" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>` +
    // The glyph stays white: it is read against the pin's own fill on the
    // basemap, not against the app's background, so it must not follow a theme.
    `<g color="#ffffff" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" ` +
    `stroke-linejoin="round" transform="translate(4.2 3.6) scale(0.65)">` +
    `${iconSvg ?? glyphMarkup(glyphId)}</g>` +
    `</svg>`
  )
}

export const ValleyIcon = (p: IconProps): ReactElement => (
  <svg className={p.className} width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true"
    style={{ mask: 'var(--icon-open-in-new) center / contain no-repeat' }}>
    {p.title ? <title>{p.title}</title> : null}
    <rect width="24" height="24" fill="currentColor" />
  </svg>
)
