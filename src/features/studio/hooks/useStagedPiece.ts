import { useEffect, useRef, useState } from "react"

export interface PieceSnapshot {
  productId: string | null
  title: string
  images: string[]
  attributes: string[]
  saved: boolean
}

export interface StagedPieceInput extends PieceSnapshot {
  /** The photo query has settled, so `images` is final for this product. */
  ready: boolean
}

const EMPTY_PIECE: PieceSnapshot = { productId: null, title: "", images: [], attributes: [], saved: false }

/** The longest the card holds its transition state before it reveals with what it has. */
const REVEAL_DEADLINE_MS = 1200

/** Pulls the image into the browser cache so the reveal paints in one frame. Never rejects. */
function decodeImage(url: string | undefined): Promise<void> {
  if (!url) return Promise.resolve()
  const img = new Image()
  img.src = url
  return img.decode().catch(() => {})
}

function afterDeadline(deadline: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now())))
}

/**
 * The piece card changes as one unit. A new product blanks the card, then reveals it once its
 * first photo is decoded, with its tags and saved state; a photo that lands later for the same
 * product is decoded before it replaces the one on screen. Nothing on the card changes in place
 * while an image is still loading.
 */
export function useStagedPiece({ ready, ...next }: StagedPieceInput): { piece: PieceSnapshot; isStaging: boolean } {
  const [shown, setShown] = useState<PieceSnapshot | null>(null)
  const shownRef = useRef<PieceSnapshot | null>(null)
  // When the incoming product was first seen, so the deadline counts from the change itself.
  const stagedRef = useRef<{ productId: string; since: number } | null>(null)

  const { productId, title, images, attributes, saved } = next
  useEffect(() => {
    let alive = true
    const snapshot: PieceSnapshot = { productId, title, images, attributes, saved }
    const commit = () => {
      if (!alive) return
      shownRef.current = snapshot
      stagedRef.current = null
      setShown(snapshot)
    }
    const current = shownRef.current

    if (!productId) {
      commit()
      return
    }

    if (current?.productId === productId) {
      // Same piece: live updates, except a new first photo waits for its decode.
      if (images[0] && images[0] !== current.images[0]) {
        void decodeImage(images[0]).then(commit)
      } else {
        commit()
      }
      return () => {
        alive = false
      }
    }

    // A new piece: hold the blank card until its first photo is in, or the deadline passes.
    if (stagedRef.current?.productId !== productId) {
      stagedRef.current = { productId, since: Date.now() }
    }
    const deadline = stagedRef.current.since + REVEAL_DEADLINE_MS
    const gate = ready ? decodeImage(images[0]) : afterDeadline(deadline)
    void Promise.race([gate, afterDeadline(deadline)]).then(commit)
    return () => {
      alive = false
    }
  }, [attributes, images, productId, ready, saved, title])

  const isStaging = shown === null || shown.productId !== productId
  return { piece: isStaging ? EMPTY_PIECE : shown, isStaging }
}
