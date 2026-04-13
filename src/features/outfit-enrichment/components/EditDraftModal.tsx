import { useState, useEffect } from "react"
import { Loader2 } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useEditDraft } from "../hooks/useEditDraft"

const CATEGORY_OPTIONS = [
  { value: "old-money", label: "Old Money" },
  { value: "date-ready", label: "Date Ready" },
  { value: "casual-outing", label: "Casual Outing" },
  { value: "ceo-core", label: "CEO Core" },
  { value: "streetwear", label: "Streetwear" },
  { value: "others", label: "Others" },
]

const OCCASION_OPTIONS = [
  { value: "brunch", label: "Brunch" },
  { value: "business-casual", label: "Business Casual" },
  { value: "casual", label: "Casual" },
  { value: "date", label: "Date" },
  { value: "party", label: "Party" },
  { value: "travel", label: "Travel" },
  { value: "important-event", label: "Important Event" },
  { value: "office-wear", label: "Office Wear" },
  { value: "others", label: "Others" },
]

interface EditDraftModalProps {
  draftId: string
  initialValues: {
    enriched_fit: string[] | null
    enriched_feel: string[] | null
    enriched_word_association: string | null
    enriched_description: string | null
    enriched_vibes: string[] | null
    suggested_name: string | null
    suggested_category: string | null
    suggested_occasion: string | null
    analyzed_occasions: string[] | null
    components_list: string[] | null
    search_summary: string | null
  }
  open: boolean
  onClose: () => void
}

export function EditDraftModal({
  draftId,
  initialValues,
  open,
  onClose,
}: EditDraftModalProps) {
  const editMutation = useEditDraft()

  // Form state
  const [fit, setFit] = useState<string>(initialValues.enriched_fit?.join(", ") || "")
  const [feel, setFeel] = useState<string>(initialValues.enriched_feel?.join(", ") || "")
  const [wordAssociation, setWordAssociation] = useState(
    initialValues.enriched_word_association || ""
  )
  const [description, setDescription] = useState(
    initialValues.enriched_description || ""
  )
  const [vibes, setVibes] = useState<string>(initialValues.enriched_vibes?.join(", ") || "")
  const [suggestedName, setSuggestedName] = useState(
    initialValues.suggested_name || ""
  )
  const [suggestedCategory, setSuggestedCategory] = useState(
    initialValues.suggested_category || ""
  )
  const [suggestedOccasion, setSuggestedOccasion] = useState(
    initialValues.suggested_occasion || ""
  )
  const [analyzedOccasions, setAnalyzedOccasions] = useState<string>(
    initialValues.analyzed_occasions?.join(", ") || ""
  )
  const [componentsList, setComponentsList] = useState<string>(
    initialValues.components_list?.join(", ") || ""
  )
  const [searchSummary, setSearchSummary] = useState(
    initialValues.search_summary || ""
  )

  // Reset form when modal opens with new values
  useEffect(() => {
    if (open) {
      setFit(initialValues.enriched_fit?.join(", ") || "")
      setFeel(initialValues.enriched_feel?.join(", ") || "")
      setWordAssociation(initialValues.enriched_word_association || "")
      setDescription(initialValues.enriched_description || "")
      setVibes(initialValues.enriched_vibes?.join(", ") || "")
      setSuggestedName(initialValues.suggested_name || "")
      setSuggestedCategory(initialValues.suggested_category || "")
      setSuggestedOccasion(initialValues.suggested_occasion || "")
      setAnalyzedOccasions(initialValues.analyzed_occasions?.join(", ") || "")
      setComponentsList(initialValues.components_list?.join(", ") || "")
      setSearchSummary(initialValues.search_summary || "")
    }
  }, [open, initialValues])

  const handleSave = () => {
    editMutation.mutate(
      {
        draftId,
        updates: {
          enriched_fit: fit ? fit.split(",").map(v => v.trim()).filter(Boolean) : null,
          enriched_feel: feel ? feel.split(",").map(v => v.trim()).filter(Boolean) : null,
          enriched_word_association: wordAssociation || null,
          enriched_description: description || null,
          enriched_vibes: vibes ? vibes.split(",").map(v => v.trim()).filter(Boolean) : null,
          suggested_name: suggestedName || null,
          suggested_category: suggestedCategory || null,
          suggested_occasion: suggestedOccasion || null,
          analyzed_occasions: analyzedOccasions ? analyzedOccasions.split(",").map(v => v.trim()).filter(Boolean) : null,
          components_list: componentsList ? componentsList.split(",").map(v => v.trim()).filter(Boolean) : null,
          search_summary: searchSummary || null,
        },
      },
      {
        onSuccess: () => {
          onClose()
        },
      }
    )
  }

  // Helper to normalize values for comparison (null and empty string are treated as equivalent)
  const normalizeForCompare = (val: string | null | undefined): string => val ?? ""
  const normalizeArrayForCompare = (val: string): string[] => 
    val ? val.split(",").map(v => v.trim()).filter(Boolean) : []

  const hasChanges =
    JSON.stringify(normalizeArrayForCompare(fit)) !== JSON.stringify(initialValues.enriched_fit || []) ||
    JSON.stringify(normalizeArrayForCompare(feel)) !== JSON.stringify(initialValues.enriched_feel || []) ||
    wordAssociation !== normalizeForCompare(initialValues.enriched_word_association) ||
    description !== normalizeForCompare(initialValues.enriched_description) ||
    JSON.stringify(normalizeArrayForCompare(vibes)) !== JSON.stringify(initialValues.enriched_vibes || []) ||
    suggestedName !== normalizeForCompare(initialValues.suggested_name) ||
    suggestedCategory !== normalizeForCompare(initialValues.suggested_category) ||
    suggestedOccasion !== normalizeForCompare(initialValues.suggested_occasion) ||
    JSON.stringify(normalizeArrayForCompare(analyzedOccasions)) !== JSON.stringify(initialValues.analyzed_occasions || []) ||
    JSON.stringify(normalizeArrayForCompare(componentsList)) !== JSON.stringify(initialValues.components_list || []) ||
    searchSummary !== normalizeForCompare(initialValues.search_summary)

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Enrichment Draft</DialogTitle>
          <DialogDescription>
            Modify the AI-generated enrichment fields before approval.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Suggested Name */}
          <div className="space-y-2">
            <Label htmlFor="edit-suggested-name">Suggested Name</Label>
            <Input
              id="edit-suggested-name"
              value={suggestedName}
              onChange={(e) => setSuggestedName(e.target.value)}
              placeholder="e.g., Weekend Casual"
            />
          </div>

          {/* Suggested Category */}
          <div className="space-y-2">
            <Label htmlFor="edit-suggested-category">Suggested Category</Label>
            <Select value={suggestedCategory} onValueChange={setSuggestedCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent position="popper" sideOffset={5} className="z-[200]">
                {CATEGORY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Suggested Occasion */}
          <div className="space-y-2">
            <Label htmlFor="edit-suggested-occasion">Suggested Occasion</Label>
            <Select value={suggestedOccasion} onValueChange={setSuggestedOccasion}>
              <SelectTrigger>
                <SelectValue placeholder="Select occasion" />
              </SelectTrigger>
              <SelectContent position="popper" sideOffset={5} className="z-[200]">
                {OCCASION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Fit */}
          <div className="space-y-2">
            <Label htmlFor="edit-fit">Fit (comma-separated)</Label>
            <Input
              id="edit-fit"
              value={fit}
              onChange={(e) => setFit(e.target.value)}
              placeholder="e.g., relaxed, fitted, oversized"
            />
          </div>

          {/* Feel */}
          <div className="space-y-2">
            <Label htmlFor="edit-feel">Feel (comma-separated)</Label>
            <Input
              id="edit-feel"
              value={feel}
              onChange={(e) => setFeel(e.target.value)}
              placeholder="e.g., casual, formal, sporty"
            />
          </div>

          {/* Word Association */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-word-association">Word Association</Label>
            </div>
            <Input
              id="edit-word-association"
              value={wordAssociation}
              onChange={(e) => setWordAssociation(e.target.value)}
              placeholder="urban chic, effortless elegance"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-description">Description</Label>
            </div>
            <Textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="2-3 sentence outfit description..."
              rows={3}
            />
          </div>

          {/* Vibes */}
          <div className="space-y-2">
            <Label htmlFor="edit-vibes">Vibes (comma-separated)</Label>
            <Input
              id="edit-vibes"
              value={vibes}
              onChange={(e) => setVibes(e.target.value)}
              placeholder="e.g., minimalist, boho, streetwear"
            />
          </div>

          {/* Analyzed Occasions */}
          <div className="space-y-2">
            <Label htmlFor="edit-analyzed-occasions">Analyzed Occasions (comma-separated)</Label>
            <Input
              id="edit-analyzed-occasions"
              value={analyzedOccasions}
              onChange={(e) => setAnalyzedOccasions(e.target.value)}
              placeholder="e.g., weekend, date night"
            />
          </div>

          {/* Components List */}
          <div className="space-y-2">
            <Label htmlFor="edit-components-list">Components List (comma-separated)</Label>
            <Input
              id="edit-components-list"
              value={componentsList}
              onChange={(e) => setComponentsList(e.target.value)}
              placeholder="e.g., white tee, blue jeans"
            />
          </div>

          {/* Search Summary */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-search-summary">Search Summary</Label>
            </div>
            <Textarea
              id="edit-search-summary"
              value={searchSummary}
              onChange={(e) => setSearchSummary(e.target.value)}
              placeholder="Summary of search results used for enrichment..."
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={editMutation.isPending || !hasChanges}
          >
            {editMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
