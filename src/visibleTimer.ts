/** Runs `tick` at once and every `intervalMs` while `doc` is shown; nothing stays armed while it is hidden. */
export function visibleTimer(doc: Document, tick: () => void, intervalMs: number): () => void {
  const view = doc.defaultView ?? window
  let timer: number | undefined
  const sync = (): void => {
    if (doc.hidden) { if (timer !== undefined) view.clearInterval(timer); timer = undefined }
    else if (timer === undefined) { tick(); timer = view.setInterval(tick, intervalMs) }
  }
  doc.addEventListener('visibilitychange', sync)
  sync()
  return () => { doc.removeEventListener('visibilitychange', sync); if (timer !== undefined) view.clearInterval(timer) }
}
