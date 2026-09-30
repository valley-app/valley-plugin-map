// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
const ROOT = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const SURFACES = [{ name: 'map source editor', view: read('src/SettingsView.tsx'), css: read('src/styles.ts'), prefix: 'map-source', chipScope: '.map-source-color' }]

describe('source editor control contract', () => {
  it.each(SURFACES)('$name draws both colours with the kit ColorField', ({ view }) => {
    // Not a hand-rolled chip with a ColorField hidden inside it: the kit owns
    // the fill/ring/unset drawing, so the two surfaces cannot diverge on it.
    expect(view).toMatch(/<ColorField\b[\s\S]*?variant=\{variant\}/)
    expect(view).toContain('variant="fill"')
    expect(view).toContain('variant="ring"')
  })

  it.each(SURFACES)('$name puts the fill chip before the ring chip', ({ view }) => {
    expect(view.indexOf('variant="fill"')).toBeLessThan(view.indexOf('variant="ring"'))
  })

  it.each(SURFACES)('$name gives Hide and Delete a glyph on a kit Button', ({ view }) => {
    for (const glyph of ['<Eye />', '<EyeOff />', '<Trash />', '<Plus />']) {
      expect(view, `${glyph} missing`).toContain(glyph)
    }
    // A raw <button> for these two is how the Calendar's row ended up without
    // any glyph at all while the Map's had both.
    expect(view).not.toMatch(/<button\s+type="button"\s+className="[a-z-]*source-toggle/)
  })

  it.each(SURFACES)('$name passes palette colours as custom properties', ({ view }) => {
    // An inline concrete colour outranks every stylesheet, so a palette value
    // has to arrive as `var(--color-…)` on a custom property the CSS reads.
    expect(view).toContain("['--swatch-fill' as string]: paletteCssValue(")
    expect(view).toContain("['--swatch-ring' as string]: paletteCssValue(")
    expect(view).not.toMatch(/style=\{\{\s*background:\s*color\b/)
    expect(view).not.toMatch(/border:\s*`2px solid \$\{/)
  })

  it.each(SURFACES)('$name sizes the kit chip but does not repaint it', ({ css, chipScope }) => {
    expect(css).toContain(`${chipScope} .settings-color-swatch`)
    // The dead `input[type=color]` selector is exactly what let the kit button
    // paint straight over the Map's ring chip.
    expect(css).not.toContain('input[type=color]')
    // `-color-chip` (not `--chip-color`, which the Calendar's entry chips use
    // for something else entirely) — the per-plugin chip classes are gone.
    for (const restated of ['-color-chip', 'color-chip--fill', 'color-chip--ring', 'color-chip-btn']) {
      expect(css, `${restated} is the kit's job now`).not.toContain(restated)
    }
  })

  it.each(SURFACES)('$name lets the kit Button own its frame', ({ css, prefix }) => {
    const toggle = ruleFor(css, `.${prefix}-toggle`)
    for (const property of ['border-radius', 'font-size', 'cursor', 'background']) {
      expect(toggle, `${prefix}-toggle restates ${property}`).not.toMatch(new RegExp(`\\b${property}\\s*:`))
    }
  })

  it('uses the shared card radius', () => {
    const radii = SURFACES.map(({ css, prefix }) => {
      const rule = ruleFor(css, `.${prefix}-row`)
      return /border-radius:\s*([^;]+);/.exec(rule)?.[1].trim()
    })
    expect(radii[0]).toBe('var(--radius)')
  })

  it('states what each source currently finds', () => {
    for (const { view, css, prefix } of SURFACES) {
      expect(view).toContain('const MatchStats')
      expect(css).toContain(`.${prefix}-stats`)
      expect(css).toContain(`.${prefix}-stats.warn`)
    }
  })

  /**
   * Neither pane owns a second dataset snapshot.
   *
   * Both panes render the subscribed list their plugin already keeps live. A
   * second mount-time query could lag behind a commit and overwrite a newer
   * source list from another surface.
   */
  it.each(SURFACES)('$name holds no second copy of its source list', ({ view }) => {
    expect(view).not.toContain('.query(')
  })
})

/** The declaration block of the first rule whose selector list contains `selector`. */
function ruleFor(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`)
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('}', at))
}
