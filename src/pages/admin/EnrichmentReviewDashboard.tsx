import { useState } from "react"
import { Link } from "react-router-dom"
import { CheckCircle, XCircle, Loader2, Sparkles, Pencil, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ArrowRightLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { AppShellLayout } from "@/layouts/AppShellLayout"
import { useEnrichmentDrafts } from "@/features/outfit-enrichment/hooks/useEnrichmentDrafts"
import { useApproveEnrichment } from "@/features/outfit-enrichment/hooks/useApproveEnrichment"
import { useRejectEnrichment } from "@/features/outfit-enrichment/hooks/useRejectEnrichment"
import { useTriggerEnrichment } from "@/features/outfit-enrichment/hooks/useTriggerEnrichment"
import { useBatchEnrichment } from "@/features/outfit-enrichment/hooks/useBatchEnrichment"
import { useOutfitsForEnrichment } from "@/features/outfit-enrichment/hooks/useOutfitsForEnrichment"
import { EditDraftModal } from "@/features/outfit-enrichment/components/EditDraftModal"
import { useApplyEnrichedValues } from "@/features/outfit-enrichment/hooks/useApplyEnrichedValues"
import type { EnrichmentDraft } from "@/services/outfit-enrichment/enrichmentDraftsService"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type TabValue = "all" | "pending" | "approved" | "rejected"
type ApprovalStatus = "pending" | "approved" | "rejected"

function truncate(text: string | null, maxLength: number = 80): string {
  if (!text) return "—"
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function ChipList({ items, variant = "secondary" }: { items: string[] | null; variant?: "default" | "secondary" | "outline" }) {
  if (!items || items.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item, i) => (
        <Badge key={`${item}-${i}`} variant={variant} className="text-xs">
          {item}
        </Badge>
      ))}
    </div>
  )
}

function DraftRow({
  draft,
  showActions,
  showApplyButton,
  onApprove,
  onReject,
  onEdit,
  onApplyEnrichedValues,
  isApproving,
  isRejecting,
  isApplying,
}: {
  draft: EnrichmentDraft
  showActions: boolean
  showApplyButton: boolean
  onApprove: (draftId: string) => void
  onReject: (draftId: string) => void
  onEdit: (draft: EnrichmentDraft) => void
  onApplyEnrichedValues: (outfitId: string) => void
  isApproving: boolean
  isRejecting: boolean
  isApplying: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const hasLongContent = 
    (draft.enriched_word_association && draft.enriched_word_association.length > 10) ||
    (draft.enriched_description && draft.enriched_description.length > 10) ||
    (draft.search_summary && draft.search_summary.length > 20)

  return (
    <>
      <TableRow 
        className={hasLongContent ? "cursor-pointer hover:bg-muted/50" : ""}
        onClick={() => hasLongContent && setIsExpanded(!isExpanded)}
      >
        {/* Expand indicator */}
        <TableCell className="w-8" onClick={(e) => e.stopPropagation()}>
          {hasLongContent && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          )}
        </TableCell>

        {/* Outfit thumbnail */}
        <TableCell onClick={(e) => e.stopPropagation()}>
          {draft.outfit?.outfit_images ? (
            <Link
              to={`/admin/studio?outfitId=${draft.outfit_id}&from=enrichment`}
              className="block cursor-pointer transition-opacity hover:opacity-80"
            >
              <img
                src={draft.outfit.outfit_images}
                alt={draft.outfit.name || "Outfit"}
                className="h-20 w-20 rounded-md object-contain bg-muted"
              />
            </Link>
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
              No image
            </div>
          )}
        </TableCell>

        {/* Suggested Name */}
        <TableCell className="max-w-[120px]">
          <span className="text-sm font-medium">{draft.suggested_name || "—"}</span>
        </TableCell>

        {/* Suggested Category */}
        <TableCell>
          {draft.suggested_category ? (
            <Badge variant="secondary" className="text-xs">{draft.suggested_category}</Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>

        {/* Suggested Occasion */}
        <TableCell>
          {draft.suggested_occasion ? (
            <Badge variant="secondary" className="text-xs">{draft.suggested_occasion}</Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>

        {/* Fit */}
        <TableCell>
          <ChipList items={draft.enriched_fit} />
        </TableCell>

        {/* Feel */}
        <TableCell>
          <ChipList items={draft.enriched_feel} />
        </TableCell>

        {/* Occasions */}
        <TableCell>
          {draft.analyzed_occasions && draft.analyzed_occasions.length > 0 ? (
            <ChipList items={draft.analyzed_occasions} variant="outline" />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>

        {/* Components */}
        <TableCell>
          {draft.components_list && draft.components_list.length > 0 ? (
            <ChipList items={draft.components_list} variant="outline" />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>

        {/* Word Association (truncated) */}
        <TableCell className="max-w-[150px]">
          <span className="text-sm">{truncate(draft.enriched_word_association, 40)}</span>
        </TableCell>

        {/* Description (truncated) */}
        <TableCell className="max-w-[200px]">
          <span className="text-sm">{truncate(draft.enriched_description, 60)}</span>
        </TableCell>

        {/* Vibes */}
        <TableCell>
          <ChipList items={draft.enriched_vibes} />
        </TableCell>

        {/* Metadata */}
        <TableCell>
          <div className="flex flex-col gap-1">
            <Badge variant="outline" className="text-xs">
              {draft.model_name}
            </Badge>
            <Badge variant="outline" className="text-xs">
              v{draft.prompt_version}
            </Badge>
          </div>
        </TableCell>

        {/* Actions */}
        {showActions && (
          <TableCell onClick={(e) => e.stopPropagation()}>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onEdit(draft)}
              >
                <Pencil className="mr-1 h-4 w-4" />
                Edit
              </Button>
              <Button
                size="sm"
                onClick={() => onApprove(draft.id)}
                disabled={isApproving || isRejecting}
                className="bg-green-600 text-white hover:bg-green-700"
              >
                {isApproving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <CheckCircle className="mr-1 h-4 w-4" />
                    Approve
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => onReject(draft.id)}
                disabled={isApproving || isRejecting}
              >
                {isRejecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <XCircle className="mr-1 h-4 w-4" />
                    Reject
                  </>
                )}
              </Button>
            </div>
          </TableCell>
        )}
        {/* Apply Enriched Values button for approved drafts */}
        {showApplyButton && (
          <TableCell>
            <Badge variant="outline">{draft.outfit?.author_role || "not available"}</Badge>
          </TableCell>
        )}
        {showApplyButton && (
          <TableCell onClick={(e) => e.stopPropagation()}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onApplyEnrichedValues(draft.outfit_id)}
              disabled={isApplying || !!draft.applied_at}
            >
              {isApplying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <ArrowRightLeft className="mr-1 h-4 w-4" />
                  Apply to Outfit
                </>
              )}
            </Button>
            {draft.applied_at && (
              <div className="flex items-center text-xs text-green-600 mt-1">
                <CheckCircle className="mr-1 h-3 w-3" />
                Applied
              </div>
            )}
          </TableCell>
        )}
      </TableRow>

      {/* Expanded detail row */}
      {isExpanded && (
        <TableRow className="bg-muted/30">
          <TableCell colSpan={showActions ? 9 : 8} className="py-4">
            <div className="space-y-3 pl-8">
              {draft.enriched_word_association && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                    Word Association
                  </h4>
                  <p className="text-sm">{draft.enriched_word_association}</p>
                </div>
              )}
              {draft.enriched_description && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                    Description
                  </h4>
                  <p className="text-sm whitespace-pre-wrap">{draft.enriched_description}</p>
                </div>
              )}
              {draft.search_summary && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                    Search Summary
                  </h4>
                  <p className="text-sm whitespace-pre-wrap">{draft.search_summary}</p>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}


function DraftsTable({ status }: { status: ApprovalStatus }) {
  const [page, setPage] = useState(1)
  const LIMIT = 50
  
  const { data: drafts, isLoading, error, isPlaceholderData } = useEnrichmentDrafts(status, page, LIMIT)
  const approveMutation = useApproveEnrichment()
  const rejectMutation = useRejectEnrichment()
  const applyMutation = useApplyEnrichedValues()
  
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [rejectingDraftId, setRejectingDraftId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [editingDraft, setEditingDraft] = useState<EnrichmentDraft | null>(null)

  const handleApprove = (draftId: string) => {
    approveMutation.mutate(draftId)
  }

  const handleRejectClick = (draftId: string) => {
    setRejectingDraftId(draftId)
    setRejectReason("")
    setRejectDialogOpen(true)
  }

  const handleRejectConfirm = () => {
    if (!rejectingDraftId) return
    rejectMutation.mutate(
      { draftId: rejectingDraftId, reason: rejectReason || "No reason provided" },
      {
        onSuccess: () => {
          setRejectDialogOpen(false)
          setRejectingDraftId(null)
          setRejectReason("")
        },
      }
    )
  }

  const handleEditClick = (draft: EnrichmentDraft) => {
    setEditingDraft(draft)
  }

  const handleApplyEnrichedValues = (outfitId: string) => {
    applyMutation.mutate(outfitId)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner />
      </div>
    )
  }

  if (error) {
    return (
      <div className="py-12 text-center text-destructive">
        Failed to load drafts: {error.message}
      </div>
    )
  }

  if (!drafts || (drafts.length === 0 && page === 1)) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        No {status} enrichments
      </div>
    )
  }

  const showActions = status === "pending"
  const showApplyButton = status === "approved"
  const hasMore = drafts?.length === LIMIT

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead className="w-[100px]">Outfit</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Occasion</TableHead>
              <TableHead>Fit</TableHead>
              <TableHead>Feel</TableHead>
              <TableHead className="w-[150px]">Analyzed Occasions</TableHead>
              <TableHead className="w-[150px]">Components</TableHead>
              <TableHead>Words</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Vibes</TableHead>
              <TableHead>Model</TableHead>
              {showActions && <TableHead>Actions</TableHead>}
              {showApplyButton && <TableHead>User Role</TableHead>}
              {showApplyButton && <TableHead>Apply</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {drafts?.map((draft) => (
              <DraftRow
                key={draft.id}
                draft={draft}
                showActions={showActions}
                showApplyButton={showApplyButton}
                onApprove={handleApprove}
                onReject={handleRejectClick}
                onEdit={handleEditClick}
                onApplyEnrichedValues={handleApplyEnrichedValues}
                isApproving={approveMutation.isPending}
                isRejecting={rejectMutation.isPending}
                isApplying={applyMutation.isPending}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination Controls */}
      <div className="flex items-center justify-between px-2">
        <div className="text-sm text-muted-foreground">
          Page {page}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || isLoading}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore || isLoading || isPlaceholderData}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>

      {/* Reject AlertDialog */}
      <AlertDialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Enrichment</AlertDialogTitle>
            <AlertDialogDescription>
              This will reject the AI-generated enrichment. Provide a reason for the rejection.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reject-reason">Reason</Label>
              <Textarea
                id="reject-reason"
                placeholder="e.g., Incorrect fit classification, description inaccurate..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRejectConfirm}
              disabled={rejectMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {rejectMutation.isPending ? "Rejecting..." : "Reject"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Modal */}
      {editingDraft && (
        <EditDraftModal
          draftId={editingDraft.id}
          initialValues={{
            enriched_fit: editingDraft.enriched_fit,
            enriched_feel: editingDraft.enriched_feel,
            enriched_word_association: editingDraft.enriched_word_association,
            enriched_description: editingDraft.enriched_description,
            enriched_vibes: editingDraft.enriched_vibes,
            suggested_name: editingDraft.suggested_name,
            suggested_category: editingDraft.suggested_category,
            suggested_occasion: editingDraft.suggested_occasion,
            analyzed_occasions: editingDraft.analyzed_occasions,
            components_list: editingDraft.components_list,
            search_summary: editingDraft.search_summary,
          }}
          open={!!editingDraft}
          onClose={() => setEditingDraft(null)}
        />
      )}
    </div>
  )
}

import { useUnenrichedCount } from "@/features/outfit-enrichment/hooks/useUnenrichedCount"

function AllOutfitsTable() {
  const [page, setPage] = useState(1)
  const LIMIT = 50
  
  const { data: outfits, isLoading, error, isPlaceholderData } = useOutfitsForEnrichment(page, LIMIT)
  const { data: globalUnenrichedCount } = useUnenrichedCount()
  const triggerMutation = useTriggerEnrichment()
  const { startBatch, isStarting, isCheckingExisting, jobStatus, isRunning } = useBatchEnrichment()

  const unenrichedCount = globalUnenrichedCount ?? 0

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner />
      </div>
    )
  }

  if (error) {
    return (
      <div className="py-12 text-center text-destructive">
        Failed to load outfits: {error.message}
      </div>
    )
  }

  if (!outfits || (outfits.length === 0 && page === 1)) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        No outfits found
      </div>
    )
  }

  const hasMore = outfits?.length === LIMIT

  return (
    <div>
      {/* Batch Enrich Header */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {unenrichedCount} outfits need enrichment
        </p>
        <Button
          onClick={() => startBatch()}
          disabled={isStarting || isRunning || isCheckingExisting || unenrichedCount === 0}
        >
          {isCheckingExisting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Checking...
            </>
          ) : isRunning ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {jobStatus?.status === "running"
                ? "Processing..."
                : "Pending..."}
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              Batch Enrich All ({unenrichedCount})
            </>
          )}
        </Button>
      </div>

      <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[100px]">Image</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Enrichment Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {outfits.map((outfit) => {
            const { enrichmentStatus } = outfit
            const canEnrich = enrichmentStatus === "not_generated"

            return (
              <TableRow key={outfit.id}>
                <TableCell>
                  {outfit.outfit_images ? (
                    <Link
                      to={`/admin/studio?outfitId=${outfit.id}&from=enrichment`}
                      className="block cursor-pointer transition-opacity hover:opacity-80"
                    >
                      <img
                        src={outfit.outfit_images}
                        alt={outfit.name}
                        className="h-16 w-16 rounded-md object-contain bg-muted"
                      />
                    </Link>
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
                      No image
                    </div>
                  )}
                </TableCell>
                <TableCell className="font-medium">{outfit.name}</TableCell>
                <TableCell>
                  {enrichmentStatus === "enriched" && (
                    <Badge variant="default" className="bg-green-600">
                      <Sparkles className="mr-1 h-3 w-3" />
                      Enriched
                    </Badge>
                  )}
                  {enrichmentStatus === "pending" && (
                    <Badge variant="default" className="bg-yellow-500 text-black">
                      <Loader2 className="mr-1 h-3 w-3" />
                      Pending Review
                    </Badge>
                  )}
                  {enrichmentStatus === "not_generated" && (
                    <Badge variant="outline">Not Generated</Badge>
                  )}
                  {enrichmentStatus === "no_image" && (
                    <Badge variant="secondary">No Image</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {canEnrich && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => triggerMutation.mutate(outfit.id)}
                            disabled={triggerMutation.isPending}
                          >
                            {triggerMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Sparkles className="mr-1 h-4 w-4" />
                                Enrich with AI
                              </>
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          Generate AI enrichment for review
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {enrichmentStatus === "enriched" && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => triggerMutation.mutate(outfit.id)}
                            disabled={triggerMutation.isPending}
                          >
                            {triggerMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Sparkles className="mr-1 h-4 w-4" />
                                Re-enrich
                              </>
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          Generate new AI enrichment (replaces existing)
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {enrichmentStatus === "pending" && (
                    <span className="text-sm text-muted-foreground">Awaiting review</span>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      </div>
      <div className="flex items-center justify-between px-2 mt-4">
        <div className="text-sm text-muted-foreground">
          Page {page}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || isLoading}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore || isLoading || isPlaceholderData}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function EnrichmentReviewDashboard() {
  const [activeTab, setActiveTab] = useState<TabValue>("all")

  return (
    <AppShellLayout>
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">AI Enrichment Review</h1>
          <p className="text-sm text-muted-foreground">
            Trigger AI enrichment for outfits and review generated data before approval.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Enrichment Management</CardTitle>
            <CardDescription>
              Trigger enrichment, review drafts, and approve AI-generated content.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
              <TabsList className="grid w-full grid-cols-4 md:w-auto md:grid-cols-none md:flex">
                <TabsTrigger value="all">All Outfits</TabsTrigger>
                <TabsTrigger value="pending">Pending</TabsTrigger>
                <TabsTrigger value="approved">Approved</TabsTrigger>
                <TabsTrigger value="rejected">Rejected</TabsTrigger>
              </TabsList>
              <TabsContent value="all" className="mt-6">
                <AllOutfitsTable />
              </TabsContent>
              <TabsContent value="pending" className="mt-6">
                <DraftsTable status="pending" />
              </TabsContent>
              <TabsContent value="approved" className="mt-6">
                <DraftsTable status="approved" />
              </TabsContent>
              <TabsContent value="rejected" className="mt-6">
                <DraftsTable status="rejected" />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </AppShellLayout>
  )
}
