import { useMemo, useState } from "react"
import { Copy, ExternalLink, Send } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import type { InviteCode } from "@/services/admin/inviteAdminService"
import { inviteLink } from "./InviteCodesPanel"

const TEMPLATE_KEY = "atlyr_admin_invite_template_v1"
const DEFAULT_TEMPLATE =
  "Hi {name}! You're invited to Atlyr's beta.\n\nYour invite code: {code}\nTap to join: {link}\n\nSign in with Google and you're in."

function loadTemplate() {
  try {
    return localStorage.getItem(TEMPLATE_KEY) || DEFAULT_TEMPLATE
  } catch {
    return DEFAULT_TEMPLATE
  }
}

function render(template: string, name: string, code: string) {
  return template
    .split("{name}").join(name || "there")
    .split("{code}").join(code)
    .split("{link}").join(inviteLink(code))
}

type Props = {
  codes: InviteCode[]
  /** Where the codes came from, for the hint line. */
  source: "selected" | "created" | "none"
  onMarkShared: (ids: string[]) => void
  markingShared: boolean
}

// One WhatsApp message per code, names paired to codes by line order.
export function InviteMessageComposer({ codes, source, onMarkShared, markingShared }: Props) {
  const { toast } = useToast()
  const [template, setTemplate] = useState(loadTemplate)
  const [namesRaw, setNamesRaw] = useState("")

  const names = useMemo(() => namesRaw.split("\n").map((n) => n.trim()).filter(Boolean), [namesRaw])
  const messages = useMemo(
    () => codes.map((c, i) => ({ id: c.id, code: c.code, name: names[i] ?? "", text: render(template, names[i] ?? "", c.code) })),
    [codes, names, template],
  )

  const saveTemplate = (next: string) => {
    setTemplate(next)
    try { localStorage.setItem(TEMPLATE_KEY, next) } catch { /* per-browser convenience only */ }
  }

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: `Copied ${what}` })
    } catch {
      toast({ title: "Copy failed", variant: "destructive" })
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">WhatsApp messages</CardTitle>
        <CardDescription>
          {source === "none"
            ? "Select codes in the list below, or create new ones, to compose messages."
            : `${codes.length} ${source === "selected" ? "selected" : "just created"} code${codes.length === 1 ? "" : "s"}. Names pair with codes in order; missing names become “there”.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="im-template" className="text-xs">Template · {"{name}"} {"{code}"} {"{link}"}</Label>
            <Textarea id="im-template" rows={6} value={template} onChange={(e) => saveTemplate(e.target.value)} className="text-sm" />
            {template !== DEFAULT_TEMPLATE && (
              <button type="button" className="text-xs text-muted-foreground underline" onClick={() => saveTemplate(DEFAULT_TEMPLATE)}>
                Reset to default
              </button>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="im-names" className="text-xs">Names, one per line</Label>
            <Textarea id="im-names" rows={6} placeholder={"Riya\nArjun\nMeera"} value={namesRaw} onChange={(e) => setNamesRaw(e.target.value)} className="text-sm" />
            {names.length > codes.length && (
              <p className="text-xs text-amber-700">{names.length - codes.length} more name{names.length - codes.length === 1 ? "" : "s"} than codes; extras are ignored.</p>
            )}
          </div>
        </div>

        {messages.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => copy(messages.map((m) => m.text).join("\n\n---\n\n"), "all messages")}>
                <Copy className="mr-1 h-3 w-3" /> Copy all
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={markingShared} onClick={() => onMarkShared(messages.map((m) => m.id))}>
                <Send className="mr-1 h-3 w-3" /> Mark these shared
              </Button>
            </div>
            <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {messages.map((m) => (
                <div key={m.id} className="flex items-start gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{m.name || "—"}</span> · <span className="font-mono">{m.code}</span>
                    </div>
                    <pre className="whitespace-pre-wrap font-sans text-sm text-foreground">{m.text}</pre>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => copy(m.text, m.name ? `message for ${m.name}` : "message")}>
                      <Copy className="mr-1 h-3 w-3" /> Copy
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
                      <a href={`https://wa.me/?text=${encodeURIComponent(m.text)}`} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="mr-1 h-3 w-3" /> WhatsApp
                      </a>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
