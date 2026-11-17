import { React } from './runtime'
import type { FC, ReactNode } from 'react'
import { Check, Copy } from './icons'
import { uiText } from './localization'

/**
 * Text that copies itself: click the line (or its copy glyph) and the glyph
 * turns into a check for a moment. With no children it is the glyph alone.
 */
export const CopyText: FC<{ text: string; label: string; className?: string; children?: ReactNode }> = ({ text, label, className, children }) => {
  const [copied, setCopied] = React.useState(false)
  const timer = React.useRef<number | null>(null)
  React.useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current) }, [])
  const copy = (view: Window | null): void => {
    void (view ?? window).navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => { setCopied(false); timer.current = null }, 1400)
    }).catch(() => {})
  }
  const title = copied ? uiText('place.copied') : label
  return (
    <button type="button" className={`map-copy${children === undefined ? ' is-icon' : ''}${copied ? ' is-copied' : ''}${className ? ` ${className}` : ''}`}
      title={title} aria-label={title} disabled={!text}
      onClick={(event) => { event.stopPropagation(); copy(event.currentTarget.ownerDocument.defaultView) }}>
      {children !== undefined && <span className="map-copy-text">{children}</span>}
      <span className="map-copy-icon" aria-hidden="true">{copied ? <Check /> : <Copy />}</span>
    </button>
  )
}
