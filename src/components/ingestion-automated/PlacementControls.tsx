import { useEffect, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Shared control-panel pieces for the placement editors.
 *
 * Deliberately generic (value in, committed value out — no knowledge of transforms, canvases or
 * units): the 3D mesh editor drives tx/ty/scale/rotation with these today, and the 2D editor's
 * x/y/length can adopt them unchanged.
 */

/** Press-and-hold auto-repeat, so holding + walks the value instead of stepping once. */
const REPEAT_DELAY_MS = 400
const REPEAT_INTERVAL_MS = 60

function round(v: number, precision: number): number {
  const f = 10 ** precision
  return Math.round(v * f) / f
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/**
 * The one label line-box shared by the rail's sections and by any preview column beside them.
 *
 * Height is fixed rather than left to the font: neighbouring columns align *by this box*, so a
 * section's first control and a preview image only start at the same y while both labels occupy
 * an identical line. Change it here, not at a call site.
 */
const LABEL_LINE = 'flex h-4 items-center text-[10px] uppercase leading-4 tracking-wide text-muted-foreground'

type ControlSectionProps = {
  label: string
  children: React.ReactNode
  /** Omit the top divider — for the first section in a rail. */
  first?: boolean
  className?: string
}

/** A titled group in the control rail. */
export function ControlSection({ label, children, first, className }: ControlSectionProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', !first && 'border-t border-border pt-2.5', className)}>
      <span className={LABEL_LINE}>{label}</span>
      {children}
    </div>
  )
}

/**
 * Caption above a preview box, on the same line-box as ControlSection's label so a rail and the
 * previews next to it share one top edge. Two children lay out as left title / right meta.
 */
export function ColumnLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn(LABEL_LINE, 'justify-between gap-2', className)}>{children}</div>
}

type NumberStepperProps = {
  /** Single-character-ish axis label to the left of the field ('X', 'Y', ''). */
  label?: string
  value: number
  /** Suffix inside the row ('px', '°', '×'). */
  unit?: string
  step: number
  /** Step used while Shift is held. */
  bigStep: number
  min: number
  max: number
  /** Decimal places kept on commit and used to render the value when the field isn't focused. */
  precision: number
  disabled?: boolean
  /** Called with the clamped, rounded value whenever the user commits a change. */
  onCommit: (value: number) => void
  /**
   * Fired once at the START of a gesture (a button press, or a typed commit) — never per
   * auto-repeat tick. The mesh editor hangs its undo snapshot here, so holding + for a second is
   * one undo entry rather than fifty.
   */
  onGestureStart?: () => void
}

/**
 * `⟨−⟩ [ 1.00 ] ⟨+⟩` — a labelled numeric field with steppers.
 *
 * The input keeps a STRING while focused rather than the number itself. Clamping/rounding a live
 * value would fight the caret: typing "-" (not yet a number), "1." (mid-decimal) or clearing the
 * field to retype would each get rewritten under the cursor. So edits are free-form until Enter or
 * blur commits them, Escape abandons them, and the field re-syncs from `value` whenever it isn't
 * focused — which is what lets a canvas drag update the readout live.
 */
export function NumberStepper({
  label, value, unit, step, bigStep, min, max, precision, disabled, onCommit, onGestureStart,
}: NumberStepperProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const timers = useRef<{ delay?: ReturnType<typeof setTimeout>; repeat?: ReturnType<typeof setInterval> }>({})
  // Set by Escape so the blur it triggers abandons the draft instead of committing it — setDraft is
  // async, so onBlur's closure would otherwise still see the old draft and save it.
  const abortRef = useRef(false)

  /**
   * The value each step is measured from.
   *
   * Not just the `value` prop: the owner may apply a commit asynchronously (the mesh editor
   * coalesces its readout onto an animation frame), so between a commit and the prop catching up
   * this holds the optimistic result. Without it, typing a value and then clicking + — which blurs
   * and commits first — would step from the pre-edit number and throw the typed one away.
   */
  const latest = useRef(value)
  const stepping = useRef(false)
  useEffect(() => { if (!stepping.current) latest.current = value }, [value])

  const stopRepeat = () => {
    stepping.current = false
    if (timers.current.delay) clearTimeout(timers.current.delay)
    if (timers.current.repeat) clearInterval(timers.current.repeat)
    timers.current = {}
  }
  useEffect(() => stopRepeat, [])

  const commit = (raw: number) => {
    if (!Number.isFinite(raw)) return
    const next = clamp(round(raw, precision), min, max)
    latest.current = next
    onCommit(next)
  }

  const beginStep = (dir: 1 | -1, shift: boolean) => {
    const delta = (shift ? bigStep : step) * dir
    stepping.current = true
    onGestureStart?.()
    commit(latest.current + delta)
    timers.current.delay = setTimeout(() => {
      timers.current.repeat = setInterval(() => commit(latest.current + delta), REPEAT_INTERVAL_MS)
    }, REPEAT_DELAY_MS)
  }

  const shown = draft ?? value.toFixed(precision)

  return (
    <div className="flex items-center gap-1">
      {label && (
        <span className="w-3 shrink-0 text-[10.5px] text-muted-foreground">{label}</span>
      )}
      <Button
        type="button" size="icon" variant="outline" className="h-7 w-7 shrink-0" disabled={disabled}
        title={`−${step} (Shift: −${bigStep})`}
        onPointerDown={(e) => beginStep(-1, e.shiftKey)}
        onPointerUp={stopRepeat}
        onPointerLeave={stopRepeat}
        onPointerCancel={stopRepeat}
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <Input
        value={shown}
        disabled={disabled}
        inputMode="decimal"
        className="h-7 min-w-0 flex-1 px-1.5 text-center text-[11px] tabular-nums"
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => { abortRef.current = false; setDraft(value.toFixed(precision)); e.target.select() }}
        onBlur={() => {
          if (!abortRef.current && draft !== null && draft.trim() !== '') {
            onGestureStart?.()
            commit(Number(draft))
          }
          abortRef.current = false
          setDraft(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.currentTarget.blur(); return }
          if (e.key === 'Escape') {
            // Escape belongs to the field here, not the dialog — without this it would abandon the
            // edit AND close the editor.
            e.stopPropagation()
            abortRef.current = true
            setDraft(null)
            e.currentTarget.blur()
          }
        }}
      />
      {unit && (
        <span className="w-4 shrink-0 text-[10px] text-muted-foreground">{unit}</span>
      )}
      <Button
        type="button" size="icon" variant="outline" className="h-7 w-7 shrink-0" disabled={disabled}
        title={`+${step} (Shift: +${bigStep})`}
        onPointerDown={(e) => beginStep(1, e.shiftKey)}
        onPointerUp={stopRepeat}
        onPointerLeave={stopRepeat}
        onPointerCancel={stopRepeat}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
