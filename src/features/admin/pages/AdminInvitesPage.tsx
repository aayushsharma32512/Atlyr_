import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { AppShellLayout } from "@/layouts/AppShellLayout"
import { useAuth } from "@/contexts/AuthContext"
import { useToast } from "@/hooks/use-toast"
import { useIssueWaitlistInvites } from "@/features/admin/hooks/useIssueWaitlistInvites"
import type { InviteIssueItem, InviteIssueMode } from "@/services/admin/inviteAdminService"

const DEFAULT_COUNT = "50"
const DEFAULT_EXPIRY_DAYS = "7"

function parseEmails(raw: string) {
  return raw
    .split(/[\n,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

function buildInviteLink(code: string) {
  const base = typeof window !== "undefined" ? window.location.origin : ""
  return `${base}/auth/signup?invite=${encodeURIComponent(code)}&next=%2Fapp`
}

function formatStatus(status: string) {
  return status.replace(/_/g, " ")
}

type StatusVariant = "default" | "secondary" | "destructive" | "outline"

function statusVariant(status: string): StatusVariant {
  if (status === "invited") return "default"
  if (status === "already_invited") return "secondary"
  if (status === "not_pending" || status === "not_found") return "outline"
  if (status.includes("failed") || status.includes("error")) return "destructive"
  return "secondary"
}

export default function AdminInvitesPage() {
  const { loading } = useAuth()
  const { toast } = useToast()
  const issueInvitesMutation = useIssueWaitlistInvites()

  const [mode, setMode] = useState<InviteIssueMode>("count")
  const [count, setCount] = useState(DEFAULT_COUNT)
  const [emailsInput, setEmailsInput] = useState("")
  const [expiresInDays, setExpiresInDays] = useState(DEFAULT_EXPIRY_DAYS)
  const [results, setResults] = useState<InviteIssueItem[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const summary = useMemo(() => {
    const counts = results.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1
      return acc
    }, {})
    return counts
  }, [results])

  const handleIssueInvites = async () => {
    setErrorMessage(null)
    const expiry = Number(expiresInDays)

    if (!Number.isFinite(expiry) || expiry <= 0) {
      setErrorMessage("Expiry must be a positive number of days.")
      return
    }

    if (mode === "count") {
      const parsedCount = Number(count)
      if (!Number.isFinite(parsedCount) || parsedCount <= 0) {
        setErrorMessage("Enter a valid count.")
        return
      }

      try {
        const response = await issueInvitesMutation.mutateAsync({
          mode,
          count: parsedCount,
          expiresInDays: expiry,
        })
        setResults(response.issued ?? [])
        toast({ title: "Invites issued", description: `Processed ${response.issued.length} waitlist entries.` })
      } catch (error) {
        const status = typeof (error as { status?: number }).status === "number" ? (error as { status?: number }).status : null
        if (status === 401 || status === 403) {
          setErrorMessage("Not authorized to issue invites.")
        } else {
          const message = error instanceof Error ? error.message : "Unable to issue invites"
          setErrorMessage(message)
        }
      }
      return
    }

    const parsedEmails = parseEmails(emailsInput)
    if (parsedEmails.length === 0) {
      setErrorMessage("Enter at least one email.")
      return
    }

    try {
      const response = await issueInvitesMutation.mutateAsync({
        mode,
        emails: parsedEmails,
        expiresInDays: expiry,
      })
      setResults(response.issued ?? [])
      toast({ title: "Invites issued", description: `Processed ${response.issued.length} emails.` })
    } catch (error) {
      const status = typeof (error as { status?: number }).status === "number" ? (error as { status?: number }).status : null
      if (status === 401 || status === 403) {
        setErrorMessage("Not authorized to issue invites.")
      } else {
        const message = error instanceof Error ? error.message : "Unable to issue invites"
        setErrorMessage(message)
      }
    }
  }

  const handleCopyCodes = async () => {
    const lines = results
      .filter((item) => item.invite)
      .map((item) => `${item.email}\t${item.invite}`)
      .join("\n")

    if (!lines) {
      toast({ title: "Nothing to copy", description: "No invite codes available yet." })
      return
    }

    try {
      await navigator.clipboard.writeText(lines)
      toast({ title: "Copied codes", description: "Invite codes copied to clipboard." })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Clipboard write failed"
      toast({ title: "Copy failed", description: message, variant: "destructive" })
    }
  }

  const handleCopyLinks = async () => {
    const lines = results
      .filter((item) => item.invite)
      .map((item) => `${item.email}\t${buildInviteLink(item.invite ?? "")}`)
      .join("\n")

    if (!lines) {
      toast({ title: "Nothing to copy", description: "No invite links available yet." })
      return
    }

    try {
      await navigator.clipboard.writeText(lines)
      toast({ title: "Copied links", description: "Invite links copied to clipboard." })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Clipboard write failed"
      toast({ title: "Copy failed", description: message, variant: "destructive" })
    }
  }

  if (loading) {
    return (
      <AppShellLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <LoadingSpinner />
        </div>
      </AppShellLayout>
    )
  }

  return (
    <AppShellLayout>
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Admin - Issue invites</h1>
          <p className="text-sm text-muted-foreground">
            Generate invite codes for waitlist users and share links with them.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Issue invites</CardTitle>
            <CardDescription>Choose the issuance mode and set expiry.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Tabs value={mode} onValueChange={(value) => setMode(value as InviteIssueMode)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="count">Oldest N</TabsTrigger>
                <TabsTrigger value="emails">Specific emails</TabsTrigger>
              </TabsList>
              <TabsContent value="count" className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="invite-count">Oldest waitlist users</Label>
                  <Input
                    id="invite-count"
                    type="number"
                    min={1}
                    value={count}
                    onChange={(event) => setCount(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Invites the earliest pending waitlist entries.
                  </p>
                </div>
              </TabsContent>
              <TabsContent value="emails" className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="invite-emails">Emails</Label>
                  <Textarea
                    id="invite-emails"
                    rows={6}
                    placeholder="name@domain.com, other@domain.com"
                    value={emailsInput}
                    onChange={(event) => setEmailsInput(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter one email per line or comma-separated.
                  </p>
                </div>
              </TabsContent>
            </Tabs>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="invite-expiry">Expiry (days)</Label>
                <Input
                  id="invite-expiry"
                  type="number"
                  min={1}
                  value={expiresInDays}
                  onChange={(event) => setExpiresInDays(event.target.value)}
                />
              </div>
            </div>

            {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

            <Button
              onClick={handleIssueInvites}
              disabled={issueInvitesMutation.isPending}
              className="w-full md:w-auto"
            >
              {issueInvitesMutation.isPending ? "Issuing..." : "Issue invites"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Results</CardTitle>
            <CardDescription>Review and copy invite codes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {results.length === 0 ? (
              <p className="text-sm text-muted-foreground">No results yet.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(summary).map(([status, count]) => (
                    <Badge key={status} variant={statusVariant(status)}>
                      {formatStatus(status)}: {count}
                    </Badge>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={handleCopyCodes}>
                    Copy codes
                  </Button>
                  <Button variant="secondary" onClick={handleCopyLinks}>
                    Copy invite links
                  </Button>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Invite code</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((item) => (
                      <TableRow key={`${item.email}-${item.status}`}>
                        <TableCell className="text-xs md:text-sm">{item.email}</TableCell>
                        <TableCell className="text-xs md:text-sm">{item.invite ?? "-"}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(item.status)}>
                            {formatStatus(item.status)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShellLayout>
  )
}
