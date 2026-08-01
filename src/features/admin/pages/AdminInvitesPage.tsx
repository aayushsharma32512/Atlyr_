import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Check, X, RefreshCw, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { AppShellLayout } from "@/layouts/AppShellLayout"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import {
  listWaitlist,
  setWaitlistApproval,
  type WaitlistEntry,
  type WaitlistStatus,
} from "@/services/admin/inviteAdminService"

const STATUS_BADGE: Record<WaitlistStatus, { label: string; cls: string }> = {
  pending:   { label: "Pending",   cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900" },
  invited:   { label: "Approved",  cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900" },
  converted: { label: "Joined",    cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900" },
  rejected:  { label: "Rejected",  cls: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900" },
}

function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function AdminInvitesPage() {
  const { toast } = useToast()
  const [busyEmail, setBusyEmail] = useState<string | null>(null)
  const [quickEmail, setQuickEmail] = useState("")
  const [tab, setTab] = useState<"pending" | "approved">("pending")

  const waitlistQuery = useQuery({
    queryKey: ["admin-waitlist"],
    queryFn: () => listWaitlist(300),
    staleTime: 30_000,
  })

  const actionMutation = useMutation({
    mutationFn: ({ email, action }: { email: string; action: "approve" | "reject" }) => setWaitlistApproval(email, action),
    onMutate: ({ email }) => setBusyEmail(email),
    onSuccess: (status, { email }) => {
      toast({ title: status === "invited" ? `Approved ${email}` : `Rejected ${email}` })
      waitlistQuery.refetch()
    },
    onError: (e) => toast({ title: "Action failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" }),
    onSettled: () => setBusyEmail(null),
  })

  const act = (email: string, action: "approve" | "reject") => actionMutation.mutate({ email, action })

  const rows = waitlistQuery.data ?? []
  // "Approved" = accepted into the app (invited) or already signed up (converted/Joined).
  // "Pending" = everything not yet approved, so rejected rows stay visible & re-approvable.
  const isApproved = (r: WaitlistEntry) => r.status === "invited" || r.status === "converted"
  const approvedRows = rows.filter(isApproved)
  const pendingRows = rows.filter((r) => !isApproved(r))
  const visibleRows = tab === "approved" ? approvedRows : pendingRows

  return (
    <AppShellLayout>
      <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Waitlist approvals</h1>
            <p className="text-sm text-muted-foreground">
              Newest applicants first. Approve → they can log in directly with Google (no code).
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => waitlistQuery.refetch()} disabled={waitlistQuery.isFetching}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", waitlistQuery.isFetching && "animate-spin")} /> Refresh
          </Button>
        </div>

        {/* Quick approve an email that isn't on the list yet */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Approve an email directly</CardTitle>
            <CardDescription>Adds it as approved even if they never joined the waitlist.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                const em = quickEmail.trim().toLowerCase()
                if (!em) return
                act(em, "approve")
                setQuickEmail("")
              }}
            >
              <Input type="email" placeholder="someone@example.com" value={quickEmail} onChange={(e) => setQuickEmail(e.target.value)} className="h-9" />
              <Button type="submit" size="sm" className="h-9 shrink-0" disabled={!quickEmail.trim() || !!busyEmail}>
                <Check className="mr-1 h-3.5 w-3.5" /> Approve
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Waitlist list */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-sm">Waitlist {rows.length > 0 && <span className="text-muted-foreground font-normal">· {rows.length} total</span>}</CardTitle>
              {/* Approved / Pending segmented toggle */}
              <div className="inline-flex rounded-lg bg-muted p-0.5">
                {([
                  { key: "pending", label: "Pending", count: pendingRows.length },
                  { key: "approved", label: "Approved", count: approvedRows.length },
                ] as const).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      tab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t.label}
                    <span className={cn("ml-1.5 rounded px-1.5 py-0.5 text-[10px]", tab === t.key ? "bg-muted text-muted-foreground" : "bg-background/60 text-muted-foreground")}>
                      {t.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {waitlistQuery.isLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : waitlistQuery.isError ? (
              <p className="py-8 text-center text-sm text-destructive">Couldn’t load the waitlist. Are you an admin? {(waitlistQuery.error as Error)?.message}</p>
            ) : visibleRows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {rows.length === 0
                  ? "No one on the waitlist yet."
                  : tab === "pending"
                    ? "Nothing pending — all caught up."
                    : "No approved applicants yet."}
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {visibleRows.map((entry: WaitlistEntry) => {
                  const badge = STATUS_BADGE[entry.status] ?? STATUS_BADGE.pending
                  const isBusy = busyEmail === entry.email
                  const approved = entry.status === "invited" || entry.status === "converted"
                  return (
                    <div key={entry.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">{entry.email}</span>
                          <Badge variant="outline" className={cn("shrink-0 text-[10px]", badge.cls)}>{badge.label}</Badge>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {entry.name || "—"}{entry.phone_number ? ` · ${entry.phone_number}` : ""} · applied {timeAgo(entry.created_at)}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          size="icon" variant="outline"
                          className={cn("h-8 w-8 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/40", approved && "opacity-40")}
                          title="Approve" disabled={isBusy || approved}
                          onClick={() => act(entry.email, "approve")}
                        >
                          {isBusy && actionMutation.variables?.action === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        </Button>
                        <Button
                          size="icon" variant="outline"
                          className={cn("h-8 w-8 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40", entry.status === "rejected" && "opacity-40")}
                          title="Reject" disabled={isBusy || entry.status === "rejected"}
                          onClick={() => act(entry.email, "reject")}
                        >
                          {isBusy && actionMutation.variables?.action === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShellLayout>
  )
}
