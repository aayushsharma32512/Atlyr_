import type { ReactNode } from "react"
import { Loader2 } from "lucide-react"

import { Icons } from "@/design-system/icons"
import { cn } from "@/lib/utils"
import { useProductCollectionMembership } from "@/features/collections/hooks/useMoodboards"
import { WARDROBE_PRIMARY } from "@/features/wardrobe-import/components/WardrobeImportChrome"
import {
  useCommitWardrobeBatch,
  type WardrobeWebCommit,
} from "@/features/wardrobe-import/hooks/useCommitWardrobeBatch"
import type { WardrobeReviewItem, WardrobeReviewItems } from "@/features/wardrobe-import/reviewItems"
import { useToast } from "@/hooks/use-toast"

type Props = {
  review: WardrobeReviewItems
  photoCount: number
  onPrevious: () => void
}

const PILL = "inline-flex h-7 flex-none items-center gap-1 rounded-control px-2.5 text-chip font-medium"
const EMPTY_IDS: ReadonlySet<string> = new Set<string>()

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

function SummaryTile({
  glyph,
  title,
  line,
  className,
}: {
  glyph: ReactNode
  title: string
  line: string
  className?: string
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-white text-violet">
        {glyph}
      </span>
      <div className="min-w-0">
        <p className="truncate text-card font-medium text-ink">{title}</p>
        <p className="truncate text-chip text-taupe">{line}</p>
      </div>
    </div>
  )
}

function ReviewRow({ item, pill }: { item: WardrobeReviewItem; pill: ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-control border border-hairline bg-white p-2">
      <div className="h-14 w-[52px] flex-none overflow-hidden rounded-chip bg-editorial">
        {item.selection.imageUrl ? (
          <img src={item.selection.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-card font-medium text-ink">{item.selection.title}</p>
        {item.selection.brand ? (
          <p className="truncate text-chip text-taupe">{item.selection.brand}</p>
        ) : null}
      </div>
      {pill}
    </li>
  )
}

function Section({
  title,
  count,
  subtitle,
  note,
  children,
}: {
  title: string
  count: number
  subtitle: string
  note?: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="font-display text-title font-medium text-ink">
          {title} <span className="text-taupe">· {count}</span>
        </h2>
        <p className="text-body text-taupe">{subtitle}</p>
        {note ? <p className="mt-1 text-chip text-taupe">{note}</p> : null}
      </div>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  )
}

/** The last stage: every pick in the batch, once, split by what happens to it next. */
export function WardrobeReviewStep({ review, photoCount, onPrevious }: Props) {
  const { inventory, web, total } = review
  const membershipQuery = useProductCollectionMembership()
  const inWardrobe = membershipQuery.data?.wardrobe ?? EMPTY_IDS
  const commit = useCommitWardrobeBatch()
  const { toast } = useToast()

  const isHeld = (item: WardrobeReviewItem) =>
    Boolean(item.selection.productId && inWardrobe.has(item.selection.productId))
  const toAdd = inventory.filter((item) => !isHeld(item))
  const heldCount = inventory.length - toAdd.length
  const addCount = toAdd.length + web.length

  const submit = () => {
    const webSelections = web.flatMap<WardrobeWebCommit>((item) => (
      item.importId && item.selection.selectionToken
        ? [{
            importId: item.importId,
            candidateId: item.selection.candidateId,
            selectionToken: item.selection.selectionToken,
          }]
        : []
    ))
    if (webSelections.length !== web.length) {
      toast({
        title: "Some online picks expired",
        description: "Go back and choose them again.",
        variant: "destructive",
      })
      return
    }
    commit.mutate({
      productIds: toAdd.flatMap((item) => (item.selection.productId ? [item.selection.productId] : [])),
      webSelections,
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-4 py-3">
        <div className="grid grid-cols-2 rounded-control bg-violet-tint p-3">
          <SummaryTile
            glyph={<Icons.image className="h-[18px] w-[18px]" aria-hidden="true" />}
            title={`${plural(photoCount, "photo")} reviewed`}
            line={`We found ${plural(total, "item")}`}
          />
          <SummaryTile
            className="border-l border-hairline pl-3"
            glyph={<Icons.sourceWardrobe className="h-[18px] w-[18px]" aria-hidden="true" />}
            title={`${plural(total, "item")} selected`}
            line={heldCount
              ? `${plural(heldCount, "item")} already in your wardrobe`
              : "Ready to add to your wardrobe"}
          />
        </div>

        {inventory.length ? (
          <Section title="Ready to add now" count={inventory.length} subtitle="Already on Atlyr">
            {inventory.map((item) => (
              <ReviewRow
                key={item.key}
                item={item}
                pill={isHeld(item) ? (
                  <span className={cn(PILL, "border border-hairline bg-white text-taupe")}>
                    already in wardrobe
                  </span>
                ) : (
                  <span className={cn(PILL, "bg-editorial text-ink")}>
                    <Icons.check className="h-3.5 w-3.5" aria-hidden="true" />
                    inventory
                  </span>
                )}
              />
            ))}
          </Section>
        ) : null}

        {web.length ? (
          <Section
            title="Will be added to Atlyr"
            count={web.length}
            subtitle="Selected from web"
            note="We’ll add these to Atlyr and notify you when they’re ready in your wardrobe."
          >
            {web.map((item) => (
              <ReviewRow
                key={item.key}
                item={item}
                pill={(
                  <span className={cn(PILL, "bg-violet-tint text-violet")}>
                    <Icons.findItems className="h-3.5 w-3.5" aria-hidden="true" />
                    web
                  </span>
                )}
              />
            ))}
          </Section>
        ) : null}

        {total ? null : (
          <p className="py-10 text-center text-body text-taupe">Nothing picked yet.</p>
        )}
      </div>

      <div className="flex h-[76px] flex-none items-center gap-3 border-t border-hairline bg-background px-4 pb-2">
        <button
          type="button"
          onClick={onPrevious}
          disabled={commit.isPending}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-control border border-hairline bg-white text-card font-medium text-ink disabled:opacity-40"
        >
          <Icons.carouselPrev className="h-[18px] w-[18px]" aria-hidden="true" />
          previous
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!addCount || commit.isPending}
          className={WARDROBE_PRIMARY}
        >
          {commit.isPending ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
          ) : null}
          add {plural(addCount, "item")}
        </button>
      </div>
    </div>
  )
}
