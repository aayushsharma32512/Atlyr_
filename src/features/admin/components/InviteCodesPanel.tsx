import { useEffect, useMemo, useRef, useState } from "react"
import { Copy, Link2, Loader2, Plus, RefreshCw, Send } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { useBulkUpdateInviteCodes, useCreateInviteCodes, useInviteCodesQuery, useSetInviteCodeActive } from "@/features/admin/hooks/useInviteCodes"
import type { InviteCode, InviteCodeBulkOp } from "@/services/admin/inviteAdminService"

type CodeState = "active" | "inactive" | "expired" | "used_up"

const STATE_BADGE: Record<CodeState, { label: string; cls: string }> = {
  active:   { label: "Active",   cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900" },
  used_up:  { label: "Used up",  cls: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-900/40 dark:text-slate-300 dark:border-slate-800" },
  expired:  { label: "Expired",  cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900" },
  inactive: { label: "Inactive", cls: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900" },
}

function codeState(c: InviteCode): CodeState {
  if (!c.is_active) return "inactive"
  if (c.expires_at && new Date(c.expires_at).getTime() <= Date.now()) return "expired"
  if (c.max_uses != null && c.current_uses >= c.max_uses) return "used_up"
  return "active"
}

export function inviteLink(code: string) {
  return `${window.location.origin}/?invite=${encodeURIComponent(code)}`
}

function formatDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "never"
}

export function InviteCodesPanel() {
  const { toast } = useToast()
  const codesQuery = useInviteCodesQuery()
  const createMutation = useCreateInviteCodes()
  const activeMutation = useSetInviteCodeActive()
  const bulkMutation = useBulkUpdateInviteCodes()

  const [count, setCount] = useState("1")
  const [maxUses, setMaxUses] = useState("1")
  const [expiresInDays, setExpiresInDays] = useState("30")
  const [label, setLabel] = useState("")
  const [customCode, setCustomCode] = useState("")
  const [showLegacy, setShowLegacy] = useState(false)
  const [justCreated, setJustCreated] = useState<InviteCode[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Anchor row for shift-click range selection.
  const anchorIndex = useRef<number | null>(null)

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: `Copied ${what}` })
    } catch {
      toast({ title: "Copy failed", description: text, variant: "destructive" })
    }
  }

  const onCreate = (e: React.FormEvent) => {
    e.preventDefault()
    createMutation.mutate(
      {
        count: Number(count) || 1,
        maxUses: Number(maxUses) || 1,
        expiresInDays: expiresInDays.trim() === "" ? null : Number(expiresInDays),
        label: label.trim() || undefined,
        customCode: customCode.trim() || undefined,
      },
      {
        onSuccess: (codes) => {
          setJustCreated(codes)
          setCustomCode("")
          toast({ title: codes.length === 1 ? `Created ${codes[0].code}` : `Created ${codes.length} codes` })
        },
        onError: (err) => toast({ title: "Create failed", description: err.message, variant: "destructive" }),
      },
    )
  }

  // Codes minted by the old per-email waitlist flow are noise here; hide them unless asked.
  const rows = useMemo(
    () => (codesQuery.data ?? []).filter((c) => showLegacy || c.type !== "waitlist_invite"),
    [codesQuery.data, showLegacy],
  )
  const legacyCount = (codesQuery.data ?? []).length - (codesQuery.data ?? []).filter((c) => c.type !== "waitlist_invite").length

  // Drop selections that are no longer in view (filter change, refetch).
  useEffect(() => {
    const visible = new Set(rows.map((c) => c.id))
    setSelected((prev) => (Array.from(prev).every((id) => visible.has(id)) ? prev : new Set(Array.from(prev).filter((id) => visible.has(id)))))
  }, [rows])

  const toggleRow = (index: number, shiftKey: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (shiftKey && anchorIndex.current !== null) {
        const [from, to] = [anchorIndex.current, index].sort((a, b) => a - b)
        for (let i = from; i <= to; i++) next.add(rows[i].id)
      } else {
        const id = rows[index].id
        if (next.has(id)) next.delete(id); else next.add(id)
      }
      return next
    })
    if (!shiftKey) anchorIndex.current = index
  }
  const allSelected = rows.length > 0 && rows.every((c) => selected.has(c.id))
  const selectedRows = rows.filter((c) => selected.has(c.id))

  const runBulk = (op: InviteCodeBulkOp) =>
    bulkMutation.mutate({ ids: selectedRows.map((c) => c.id), op }, {
      onSuccess: () => toast({ title: `${selectedRows.length} code${selectedRows.length === 1 ? "" : "s"} updated` }),
      onError: (err) => toast({ title: "Bulk update failed", description: err.message, variant: "destructive" }),
    })

  return (
    <>
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Create invite codes</CardTitle>
          <CardDescription>Share the code or the link. Anyone who redeems it signs in with Google and gets access.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onCreate} className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="space-y-1">
              <Label htmlFor="ic-count" className="text-xs">Count</Label>
              <Input id="ic-count" type="number" min={1} max={200} value={count} onChange={(e) => setCount(e.target.value)} disabled={!!customCode.trim()} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ic-max" className="text-xs">Max uses each</Label>
              <Input id="ic-max" type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ic-exp" className="text-xs">Expires in days</Label>
              <Input id="ic-exp" type="number" min={1} placeholder="never" value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ic-label" className="text-xs">Label</Label>
              <Input id="ic-label" placeholder="beta batch 1" value={label} onChange={(e) => setLabel(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ic-custom" className="text-xs">Custom code (optional)</Label>
              <Input id="ic-custom" placeholder="FRIENDS50" value={customCode} onChange={(e) => setCustomCode(e.target.value.toUpperCase())} className="h-9 font-mono" />
            </div>
            <div className="col-span-2 flex justify-end sm:col-span-5">
              <Button type="submit" size="sm" className="h-9" disabled={createMutation.isPending}>
                {createMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
                Create
              </Button>
            </div>
          </form>

          {justCreated.length > 0 && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-emerald-800 dark:text-emerald-200">Just created</span>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => copy(justCreated.map((c) => c.code).join("\n"), "all codes")}>
                  <Copy className="mr-1 h-3 w-3" /> Copy all
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {justCreated.map((c) => (
                  <button key={c.id} type="button" onClick={() => copy(c.code, c.code)} className="rounded-md border border-border bg-background px-2 py-1 font-mono text-xs hover:bg-muted">
                    {c.code}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <input
                type="checkbox" aria-label="Select all"
                checked={allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((c) => c.id)))}
              />
              Invite codes {rows.length > 0 && <span className="font-normal text-muted-foreground">· {rows.length}</span>}
            </CardTitle>
            <div className="flex items-center gap-2">
              {legacyCount > 0 && (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="checkbox" checked={showLegacy} onChange={(e) => setShowLegacy(e.target.checked)} />
                  Show {legacyCount} legacy waitlist codes
                </label>
              )}
              <Button variant="outline" size="sm" onClick={() => codesQuery.refetch()} disabled={codesQuery.isFetching}>
                <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", codesQuery.isFetching && "animate-spin")} /> Refresh
              </Button>
            </div>
          </div>
          {selectedRows.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2">
              <span className="mr-1 text-xs font-medium">{selectedRows.length} selected</span>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => copy(selectedRows.map((c) => c.code).join("\n"), "codes")}>
                <Copy className="mr-1 h-3 w-3" /> Copy codes
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => copy(selectedRows.map((c) => inviteLink(c.code)).join("\n"), "links")}>
                <Link2 className="mr-1 h-3 w-3" /> Copy links
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={bulkMutation.isPending} onClick={() => runBulk("mark_shared")}>
                <Send className="mr-1 h-3 w-3" /> Mark shared
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={bulkMutation.isPending} onClick={() => runBulk("unmark_shared")}>
                Unmark shared
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={bulkMutation.isPending} onClick={() => runBulk("deactivate")}>
                Deactivate
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={bulkMutation.isPending} onClick={() => runBulk("activate")}>
                Reactivate
              </Button>
              <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
              {bulkMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {codesQuery.isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : codesQuery.isError ? (
            <p className="py-8 text-center text-sm text-destructive">Couldn’t load invite codes. {(codesQuery.error as Error)?.message}</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No invite codes yet.</p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {rows.map((c, index) => {
                const state = codeState(c)
                const badge = STATE_BADGE[state]
                const busy = activeMutation.isPending && activeMutation.variables?.id === c.id
                const isSelected = selected.has(c.id)
                return (
                  <div
                    key={c.id}
                    className={cn("flex cursor-pointer select-none items-center gap-3 py-2.5 -mx-2 px-2 rounded-md", isSelected && "bg-muted/60")}
                    onClick={(e) => toggleRow(index, e.shiftKey)}
                  >
                    <input type="checkbox" checked={isSelected} readOnly tabIndex={-1} className="pointer-events-none shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-mono text-sm font-medium text-foreground">{c.code}</span>
                        <Badge variant="outline" className={cn("shrink-0 text-[10px]", badge.cls)}>{badge.label}</Badge>
                        {c.metadata?.shared_at && (
                          <Badge variant="outline" className="shrink-0 text-[10px]" title={`Shared ${formatDate(c.metadata.shared_at)}`}>Shared</Badge>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {c.metadata?.label || "—"} · {c.current_uses}/{c.max_uses ?? "∞"} used · expires {formatDate(c.expires_at)} · created {formatDate(c.created_at)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <Button size="icon" variant="outline" className="h-8 w-8" title="Copy code" onClick={() => copy(c.code, "code")}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="outline" className="h-8 w-8" title="Copy invite link" onClick={() => copy(inviteLink(c.code), "link")}>
                        <Link2 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm" variant="outline" className="h-8 w-24 text-xs"
                        disabled={busy}
                        onClick={() => activeMutation.mutate({ id: c.id, isActive: !c.is_active }, {
                          onError: (err) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
                        })}
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : c.is_active ? "Deactivate" : "Reactivate"}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
