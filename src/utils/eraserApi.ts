// Modal LaMa eraser endpoint. Swap VITE_MODAL_ERASER_URL for a self-hosted/prod link later.
const MODAL_ERASER_URL =
  (import.meta.env as Record<string, string>).VITE_MODAL_ERASER_URL ??
  'https://nikunjgupta2136--atlyr-lama-eraser-lamaeraser-web.modal.run'

/**
 * Wake + warm the Modal container (cold start loads big-lama onto the GPU, ~20–30s).
 * Fire-and-forget when the editor opens so the first real Erase is fast. Errors ignored.
 */
export function warmUpEraser(): void {
  fetch(`${MODAL_ERASER_URL}/health`, { method: 'GET' }).catch(() => {})
}

/**
 * Magic eraser — send the working image + a binary mask (white = erase) to the Modal
 * big-lama endpoint and get an inpainted PNG back. Same multipart contract as /inpaint.
 */
export async function magicErase(image: Blob, mask: Blob): Promise<Blob> {
  const fd = new FormData()
  fd.append('image', image, 'image.png')
  fd.append('mask', mask, 'mask.png')
  // Generous timeout — first (cold) call can take ~30s while the model loads.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 90_000)
  try {
    const res = await fetch(`${MODAL_ERASER_URL}/inpaint`, { method: 'POST', body: fd, signal: ctrl.signal })
    if (!res.ok) {
      const text = await res.text().catch(() => `HTTP ${res.status}`)
      throw new Error(text || `HTTP ${res.status}`)
    }
    return res.blob()
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error('Erase timed out (model took too long to respond). Try again — the model is now warming up.')
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}
