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

  it.each(SURFACES)('$name gives Delete and Add source a glyph on a kit Button', ({ view }) => {
    for (const glyph of ['<Trash />', '<Plus />']) {
      expect(view, `${glyph} missing`).toContain(glyph)
    }
    // A raw <button> for these is how the Calendar's row ended up without
    // any glyph at all while the Map's had both.
    expect(view).not.toMatch(/<button\s+type="button"\s+className="[a-z-]*source-toggle/)
  })

  it.each(SURFACES)('$name turns a source off with a switch, not a Hide/Show text button', ({ view }) => {
    expect(view).toContain("checked={!source.hidden}")
    expect(view).toContain('onChange({ hidden: !on })')
    expect(view).not.toContain('<EyeOff />')
    expect(view).not.toContain('auto.ea463ac7f93c')
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

  it('draws one flat list separated by hairlines, not cards', () => {
    for (const { css, prefix } of SURFACES) {
      const rule = ruleFor(css, `.${prefix}-row`)
      expect(rule).toMatch(/border-bottom:\s*1px solid var\(--border-light\)/)
      for (const property of ['border-radius', 'box-shadow', 'background', 'border:']) {
        expect(rule, `${prefix}-row restates ${property}`).not.toContain(property)
      }
      expect(css).not.toContain(`.${prefix}-row:hover`)
      expect(ruleFor(css, `.${prefix}-head`)).toContain('grid-template-columns:22px 22px 24px minmax(0, 1fr) auto auto')
    }
  })

  it('removes the old card editor rules', () => {
    for (const { css } of SURFACES) {
      for (const gone of ['.map-source-tools', '.map-source-grid', '.map-source-field', '.map-source-location', '.map-source-hover', '.map-source-help', '.map-add-field']) {
        expect(css, `${gone} is still styled`).not.toContain(gone)
      }
    }
  })

  it('states what each source currently finds', () => {
    for (const { view, css, prefix } of SURFACES) {
      expect(view).toContain('const MatchStats')
      expect(view).toContain('sourceStats(entries, source)')
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
