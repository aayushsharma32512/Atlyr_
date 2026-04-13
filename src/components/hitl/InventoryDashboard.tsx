import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertCircle, ChevronDown, ChevronUp, Download, ExternalLink, Loader2, RefreshCcw, Trash2, UploadCloud, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { useBatchSubmit, useHitlJob, useHitlPhase1, useHitlPhase2 } from '@/hooks'
import { PipelineState, deletePhase1Image, uploadPhase1Image, uploadPhase2Ghost, fetchJobDetails, type CatalogJob } from '@/utils/ingestionApi'
import { supabase } from '@/integrations/supabase/client'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { AvatarRenderer } from '@/features/studio/components/AvatarRenderer'
import { useMannequinConfig } from '@/features/studio/hooks/useMannequinConfig'
import { mapLegacyOutfitItemsToStudioItems } from '@/features/studio/mappers/renderedItemMapper'
import type { MannequinSegmentName, StudioRenderedItem } from '@/features/studio/types'
import { MANNEQUIN_SEGMENT_NAMES } from '@/features/studio/constants'
import type { ItemType, OutfitItem } from '@/types'
import { useCategories } from '@/hooks/useCategories'
import { resolvePreviewGender, type PreviewGender } from '@/components/hitl/utils/previewGender'
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerClose,
} from '@/components/ui/drawer'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { JobListSidebar } from './JobListSidebar'

const STORAGE_BUCKET = ((import.meta.env as { VITE_STORAGE_BUCKET?: string }).VITE_STORAGE_BUCKET ?? 'ingested_inventory')

const TYPE_OPTIONS: Array<{ label: string; value: ItemType }> = [
  { label: 'Top', value: 'top' },
  { label: 'Bottom', value: 'bottom' },
  { label: 'Shoes', value: 'shoes' },
  { label: 'Accessory', value: 'accessory' },
  { label: 'Occasion', value: 'occasion' },
]

const CATEGORY_GHOST_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'Topwear', value: 'topwear' },
  { label: 'Bottomwear', value: 'bottomwear' },
  { label: 'Footwear', value: 'footwear' },
  { label: 'Dresses', value: 'dresses' },
]

const DEFAULT_ITEM_PREFIX = 'defaultitems'
const DEFAULT_PREVIEW_SLOT_FOLDERS: Record<'top' | 'bottom' | 'shoes', string> = {
  top: 'topwear',
  bottom: 'bottomwear',
  shoes: 'footwear',
}
type DefaultPreviewItemsMap = Record<PreviewGender, Partial<Record<'top' | 'bottom' | 'shoes', OutfitItem>>>
const IMAGE_LENGTH_DEFAULTS: Record<'top' | 'bottom' | 'shoes', number> = {
  top: 72,
  bottom: 100,
  shoes: 24,
}
const IMAGE_LENGTH_RANGES: Record<'top' | 'bottom' | 'shoes', { min: number; max: number }> = {
  top: { min: 0, max: 200 },
  bottom: { min: 0, max: 200 },
  shoes: { min: 0, max: 200 },
}

const STATIC_DEFAULT_ITEM_URLS: DefaultPreviewItemsMap = {
  male: {
    top: {
      id: 'default-male-top',
      type: 'top',
      brand: 'Baseline',
      product_name: null,
      size: '',
      price: 0,
      currency: 'INR',
      imageUrl:
        'https://hhqnvjxnsbwhmrldohbz.supabase.co/storage/v1/object/public/ingested_inventory/defaultitems/male/topwear/BASIC_HEAVYWEIGHT_T-SHIRT_5.png',
      description: 'male top baseline',
      color: '',
      color_group: null,
      gender: 'male',
      placement_y: null,
      placement_x: 0,
      image_length: null,
      fit: null,
      feel: null,
      category_id: null,
      type_category: null,
    },
    bottom: {
      id: 'default-male-bottom',
      type: 'bottom',
      brand: 'Baseline',
      product_name: null,
      size: '',
      price: 0,
      currency: 'INR',
      imageUrl:
        'https://hhqnvjxnsbwhmrldohbz.supabase.co/storage/v1/object/public/ingested_inventory/defaultitems/male/bottomwear/100__LINEN_BERMUDA_SHORTS_6.png',
      description: 'male bottom baseline',
      color: '',
      color_group: null,
      gender: 'male',
      placement_y: null,
      placement_x: 0,
      image_length: null,
      fit: null,
      feel: null,
      category_id: null,
      type_category: null,
    },
    shoes: {
      id: 'default-male-shoes',
      type: 'shoes',
      brand: 'Baseline',
      product_name: null,
      size: '',
      price: 0,
      currency: 'INR',
      imageUrl:
        'https://hhqnvjxnsbwhmrldohbz.supabase.co/storage/v1/object/public/ingested_inventory/defaultitems/male/footwear/CHUNKY_TRAINERS_5.png',
      description: 'male footwear baseline',
      color: '',
      color_group: null,
      gender: 'male',
      placement_y: null,
      placement_x: 0,
      image_length: null,
      fit: null,
      feel: null,
      category_id: null,
      type_category: null,
    },
  },
  female: {
    top: {
      id: 'default-female-top',
      type: 'top',
      brand: 'Baseline',
      product_name: null,
      size: '',
      price: 0,
      currency: 'INR',
      imageUrl:
        'https://hhqnvjxnsbwhmrldohbz.supabase.co/storage/v1/object/public/ingested_inventory/defaultitems/female/topwear/BASIC_HEAVYWEIGHT_T-SHIRT_5.png',
      description: 'female top baseline',
      color: '',
      color_group: null,
      gender: 'female',
      placement_y: null,
      placement_x: 0,
      image_length: null,
      fit: null,
      feel: null,
      category_id: null,
      type_category: null,
    },
    bottom: {
      id: 'default-female-bottom',
      type: 'bottom',
      brand: 'Baseline',
      product_name: null,
      size: '',
      price: 0,
      currency: 'INR',
      imageUrl:
        'https://hhqnvjxnsbwhmrldohbz.supabase.co/storage/v1/object/public/ingested_inventory/defaultitems/female/bottomwear/BERMUDA_SHORTS_WITH_BELT_IN_A_LINEN_BLEND_4.png',
      description: 'female bottom baseline',
      color: '',
      color_group: null,
      gender: 'female',
      placement_y: null,
      placement_x: 0,
      image_length: null,
      fit: null,
      feel: null,
      category_id: null,
      type_category: null,
    },
    shoes: {
      id: 'default-female-shoes',
      type: 'shoes',
      brand: 'Baseline',
      product_name: null,
      size: '',
      price: 0,
      currency: 'INR',
      imageUrl:
        'https://hhqnvjxnsbwhmrldohbz.supabase.co/storage/v1/object/public/ingested_inventory/defaultitems/female/footwear/CHUNKY_TRAINERS_5.png',
      description: 'female footwear baseline',
      color: '',
      color_group: null,
      gender: 'female',
      placement_y: null,
      placement_x: 0,
      image_length: null,
      fit: null,
      feel: null,
      category_id: null,
      type_category: null,
    },
  },
}

const CATALOG_STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  ingesting: 'Ingesting',
  awaiting_phase1: 'Awaiting Phase 1',
  phase1_complete: 'Phase 1 Complete',
  awaiting_phase2: 'Awaiting Phase 2',
  promoting: 'Promoting',
  completed: 'Completed',
  cancelled: 'Cancelled',
  errored: 'Errored',
}

const CATALOG_STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  queued: 'outline',
  ingesting: 'secondary',
  awaiting_phase1: 'default',
  phase1_complete: 'default',
  awaiting_phase2: 'default',
  promoting: 'secondary',
  completed: 'outline',
  cancelled: 'outline',
  errored: 'destructive',
}

type DraftProduct = {
  id?: string | null
  type?: ItemType | null
  category_ghost?: string | null
  brand?: string | null
  product_name?: string | null
  price?: number | null
  price_minor?: number | null
  currency?: string | null
  fit?: string | null
  feel?: string | null
  material?: string | null
  material_type?: string | null
  gender?: string | null
  description?: string | null
  size?: string | null
  color?: string | null
  category_id?: string | null
  size_chart?: Record<string, unknown> | null
  care?: string | null
  occasion?: string | null
  garment_summary?: Record<string, unknown> | null
  garment_summary_front?: Record<string, unknown> | null
  garment_summary_back?: Record<string, unknown> | null
  garment_summary_version?: string | null
  description_text?: string | null
  type_category?: string | null
  color_group?: string | null
  product_specifications?: Record<string, unknown> | null
  vibes?: string[] | null
  vibes_raw?: string | null
  product_url?: string | null
  image_url?: string | null
  placement_x?: number | null
  placement_y?: number | null
  image_length?: number | null
  product_length?: number | null
  body_parts_visible?: string[] | null
  similar_items?: string | null
  vector_embedding?: unknown
}

type DraftImage = {
  url: string
  sort_order: number
  is_primary: boolean
  product_view: 'front' | 'back' | 'side' | 'detail' | 'other' | null
  ghost_eligible: boolean
  summary_eligible: boolean
  vto_eligible: boolean
  kind?: string | null
  product_id?: string | null
  gender?: string | null
  storage_path?: string | null
  placement_x?: number | null
  placement_y?: number | null
}

type ValidationMessage = {
  code: string
  message: string
  severity: 'error' | 'warning'
}

type RawImageRecord = Record<string, unknown> & {
  originalUrl?: string
  storagePath?: string | null
  productView?: string | null
  ghostEligible?: boolean
  summaryEligible?: boolean
}

type DraftImageUpdate = {
  url: string
  product_view?: DraftImage['product_view']
  ghost_eligible?: boolean
  summary_eligible?: boolean
  vto_eligible?: boolean
  is_primary?: boolean
  sort_order?: number
  storage_path?: string | null
  gender?: string | null
  kind?: string | null
  product_id?: string | null
  placement_x?: number | null
  placement_y?: number | null
}

function isItemType(value: unknown): value is ItemType {
  return value === 'top' || value === 'bottom' || value === 'shoes' || value === 'accessory' || value === 'occasion'
}

const PRODUCT_FIELDS: Array<keyof DraftProduct> = [
  'type',
  'category_ghost',
  'brand',
  'product_name',
  'price_minor',
  'currency',
  'fit',
  'feel',
  'material',
  'material_type',
  'gender',
  'description',
  'care',
  'occasion',
  'category_id',
  'image_url',
  'body_parts_visible',
]

const IMAGE_FIELDS = [
  'product_view',
  'storage_path',
  'ghost_eligible',
  'summary_eligible',
  'vto_eligible',
  'is_primary',
  'sort_order',
  'gender',
  'kind',
] as const satisfies readonly (keyof DraftImageUpdate)[]

const PRODUCT_IMAGE_COLUMNS_ORDER = [
  'product_id',
  'url',
  'kind',
  'sort_order',
  'is_primary',
  'product_view',
  'ghost_eligible',
  'summary_eligible',
  'vto_eligible',
  'gender',
] as const

function getRawImages(state?: PipelineState): RawImageRecord[] {
  const artifacts = state?.artifacts as Record<string, unknown> | undefined
  const raw = artifacts?.rawImages
  if (!Array.isArray(raw)) return []
  return raw as RawImageRecord[]
}

function extractStoragePath(state: PipelineState | undefined, url: string): string | null {
  const rawImages = getRawImages(state)
  const match = rawImages.find((raw) => raw.originalUrl === url)
  const storagePath = match?.storagePath ?? (match as Record<string, unknown> | undefined)?.storage_path
  return typeof storagePath === 'string' ? storagePath : null
}

function extractRawTag<T extends 'productView' | 'ghostEligible' | 'summaryEligible'>(state: PipelineState | undefined, url: string, key: T, fallback: unknown) {
  const rawImages = getRawImages(state)
  const match = rawImages.find((raw) => raw.originalUrl === url)
  if (!match) return fallback
  const value = match[key]
  if (key === 'productView') {
    return typeof value === 'string' ? (value as DraftImage['product_view']) : fallback
  }
  return typeof value === 'boolean' ? value : fallback
}

function toDraftProduct(state?: PipelineState): DraftProduct {
  const product = (state?.draft as Record<string, unknown> | undefined)?.product as DraftProduct | undefined
  const rawVibes = product?.vibes as unknown
  const normalizedVibes = Array.isArray(rawVibes)
    ? rawVibes.filter((entry): entry is string => typeof entry === 'string')
    : typeof rawVibes === 'string'
      ? rawVibes
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : []
  const vibesRaw = typeof rawVibes === 'string' ? rawVibes : Array.isArray(rawVibes) ? rawVibes.join(', ') : null
  const type = isItemType(product?.type) ? product.type : null
  const size = typeof product?.size === 'string' ? product.size : null
  const priceMinor = typeof (product as Record<string, unknown> | undefined)?.price_minor === 'number'
    ? (product as Record<string, unknown>).price_minor as number
    : typeof product?.price === 'number'
      ? product.price
      : typeof product?.price === 'string'
        ? Number(product.price)
        : null
  const normalizedPrice = priceMinor !== null && priceMinor !== undefined
    ? priceMinor
    : null
  const placementX = typeof product?.placement_x === 'number' ? product.placement_x : null
  const placementY = typeof product?.placement_y === 'number' ? product.placement_y : null
  const imageLength = typeof product?.image_length === 'number' ? product.image_length : null
  const productLength = typeof product?.product_length === 'number' ? product.product_length : null
  const bodyPartsVisible = Array.isArray(product?.body_parts_visible)
    ? product.body_parts_visible.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : null
  const categoryGhost = typeof (product as Record<string, unknown> | undefined)?.category_ghost === 'string'
    ? ((product as Record<string, unknown>).category_ghost as string)
    : null
  const categoryId = typeof product?.category_id === 'string' ? product.category_id : null
  const typeCategory = typeof product?.type_category === 'string' ? product.type_category : null
  const colorGroup = typeof product?.color_group === 'string' ? product.color_group : null
  const occasion = typeof (product as Record<string, unknown> | undefined)?.occasion === 'string'
    ? ((product as Record<string, unknown>).occasion as string)
    : null
  const materialType = typeof (product as Record<string, unknown> | undefined)?.material_type === 'string'
    ? ((product as Record<string, unknown>).material_type as string)
    : null
  const similarItems = typeof product?.similar_items === 'string' ? product.similar_items : null
  const garmentSummary = product?.garment_summary && typeof product.garment_summary === 'object' ? product.garment_summary : null
  const vectorEmbedding = (product as Record<string, unknown> | undefined)?.vector_embedding ?? null
  return {
    id: typeof product?.id === 'string' ? product.id : (state && (state as Record<string, unknown>).productId && typeof (state as Record<string, unknown>).productId === 'string' ? ((state as Record<string, unknown>).productId as string) : ''),
    type,
    category_ghost: categoryGhost,
    brand: product?.brand ?? '',
    product_name: product?.product_name ?? '',
    price: normalizedPrice,
    price_minor: priceMinor,
    currency: product?.currency ?? 'INR',
    fit: product?.fit ?? '',
    feel: product?.feel ?? '',
    material: product?.material ?? '',
    material_type: materialType,
    gender: product?.gender ?? '',
    description: product?.description ?? '',
    size: size ?? '',
    color: product?.color ?? '',
    category_id: categoryId,
    size_chart: product?.size_chart ?? null,
    care: product?.care ?? '',
    occasion: occasion,
    garment_summary: garmentSummary,
    garment_summary_front: product?.garment_summary_front ?? null,
    garment_summary_back: product?.garment_summary_back ?? null,
    garment_summary_version: product?.garment_summary_version ?? '',
    description_text: typeof product?.description_text === 'string' ? product.description_text : null,
    type_category: typeCategory,
    color_group: colorGroup,
    product_specifications:
      product?.product_specifications && typeof product.product_specifications === 'object'
        ? product.product_specifications
        : null,
    vibes: normalizedVibes,
    vibes_raw: vibesRaw,
    product_url: typeof product?.product_url === 'string' ? product.product_url : null,
    image_url: typeof product?.image_url === 'string' ? product.image_url : null,
    placement_x: placementX,
    placement_y: placementY,
    image_length: imageLength,
    product_length: productLength,
    body_parts_visible: bodyPartsVisible,
    similar_items: similarItems,
    vector_embedding: vectorEmbedding,
  }
}

function toDraftImages(state?: PipelineState): DraftImage[] {
  const imagesRaw = (state?.draft as Record<string, unknown> | undefined)?.images as DraftImage[] | undefined
  if (!Array.isArray(imagesRaw)) return []
  return imagesRaw.map((img, index) => {
    const url = img?.url ?? `image-${index}`
    const storagePath = extractStoragePath(state, url)
    const fallbackView = extractRawTag(state, url, 'productView', null) as DraftImage['product_view']
    const fallbackGhost = extractRawTag(state, url, 'ghostEligible', false) as boolean
    const fallbackSummary = extractRawTag(state, url, 'summaryEligible', false) as boolean
    const kind = typeof img?.kind === 'string' ? img.kind : null
    const productId = typeof img?.product_id === 'string' ? img.product_id : (state && typeof (state as Record<string, unknown>).productId === 'string' ? ((state as Record<string, unknown>).productId as string) : null)
    const placementX = typeof img?.placement_x === 'number' ? img.placement_x : null
    const placementY = typeof img?.placement_y === 'number' ? img.placement_y : null
    return {
      url,
      sort_order: typeof img?.sort_order === 'number' ? img.sort_order : index,
      is_primary: Boolean(img?.is_primary),
      product_view: (img?.product_view as DraftImage['product_view']) ?? fallbackView ?? null,
      ghost_eligible: typeof img?.ghost_eligible === 'boolean' ? img.ghost_eligible : fallbackGhost,
      summary_eligible: typeof img?.summary_eligible === 'boolean' ? img.summary_eligible : fallbackSummary,
      vto_eligible: Boolean(img?.vto_eligible),
      kind,
      product_id: productId,
      gender: img?.gender ?? null,
      storage_path: storagePath,
      placement_x: placementX,
      placement_y: placementY,
    }
  })
}

function stringifySizeChart(chart: DraftProduct['size_chart']): string {
  if (!chart) return ''
  try {
    return JSON.stringify(chart, null, 2)
  } catch {
    return ''
  }
}

function parseSizeChart(text: string): DraftProduct['size_chart'] {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

type GhostViewInfo = {
  view: 'front' | 'back'
  stagingPath?: string
  stagingUrl?: string | null
  stagingCreatedAt?: string
  processedPath?: string
  processedUrl?: string | null
}

const GHOST_VIEW_LABELS: Record<'front' | 'back', string> = {
  front: 'Front View',
  back: 'Back View',
}

const GHOST_VIEW_ORDER = ['front', 'back'] as const

const getPublicUrl = (path?: string | null): string | null => {
  if (!path) return null
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path)
  return data?.publicUrl ?? null
}

const formatColumnValue = (value: unknown): string => {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isFinite(value) ? value.toString() : '—'
  if (typeof value === 'string') return value.trim() ? value : '—'
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function buildGhostViews(state?: PipelineState): Record<'front' | 'back', GhostViewInfo> {
  const base: Record<'front' | 'back', GhostViewInfo> = {
    front: { view: 'front' },
    back: { view: 'back' },
  }

  const artifacts = (state?.artifacts as Record<string, unknown> | undefined) ?? undefined
  const ghostImages = artifacts && Array.isArray((artifacts as Record<string, unknown>).ghostImages)
    ? ((artifacts as Record<string, unknown>).ghostImages as Array<Record<string, unknown>>)
    : []
  ghostImages.forEach((entry) => {
    const view = entry.view
    if (view !== 'front' && view !== 'back') return
    const storagePath = typeof entry.storagePath === 'string' ? entry.storagePath : undefined
    base[view] = {
      ...base[view],
      stagingPath: storagePath,
      stagingUrl: getPublicUrl(storagePath),
      stagingCreatedAt: typeof entry.createdAt === 'string' ? entry.createdAt : undefined,
    }
  })

  const processedRoot = (state?.processed as Record<string, unknown> | undefined)?.productImages
  if (processedRoot && typeof processedRoot === 'object') {
    const entries = Object.entries(processedRoot as Record<string, unknown>)
    entries.forEach(([key, value]) => {
      if (key !== 'front' && key !== 'back') return
      let storagePath: string | undefined
      if (typeof value === 'string') {
        storagePath = value
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        const record = value as Record<string, unknown>
        if (typeof record.storagePath === 'string') {
          storagePath = record.storagePath
        }
      }
      if (storagePath) {
        base[key] = {
          ...base[key],
          processedPath: storagePath,
          processedUrl: getPublicUrl(storagePath),
        }
      }
    })
  }

  return base
}

function extractSummaryCount(images: DraftImage[]): number {
  return images.filter((img) => img.summary_eligible).length
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function formatJson(value: unknown): string {
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

function parseJson(text: string): { value: unknown; error?: string } {
  const trimmed = text.trim()
  if (!trimmed) return { value: null }
  try {
    return { value: JSON.parse(trimmed) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid JSON'
    return { value: null, error: message }
  }
}

function shouldIncludeProductField(key: keyof DraftProduct, value: DraftProduct[typeof key]): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'number') return !Number.isNaN(value)
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'object') return true
  return false
}

function buildProductPatch(current: DraftProduct, initial: DraftProduct, parsedSizeChart: DraftProduct['size_chart']): Partial<DraftProduct> {
  const patch: Partial<Record<keyof DraftProduct, DraftProduct[keyof DraftProduct]>> = {}

  for (const key of PRODUCT_FIELDS) {
    const currentValue = current[key]
    const initialValue = initial[key]

    if (valuesEqual(currentValue, initialValue)) continue
    if (!shouldIncludeProductField(key, currentValue)) continue

    patch[key] = currentValue as DraftProduct[typeof key]
  }

  if ('price_minor' in patch) {
    patch.price = patch.price_minor as DraftProduct['price']
  }

  if (parsedSizeChart && !valuesEqual(parsedSizeChart, initial.size_chart)) {
    patch.size_chart = parsedSizeChart
  }

  return patch as Partial<DraftProduct>
}

function shouldIncludeImageField(key: keyof DraftImageUpdate, value: DraftImageUpdate[typeof key]): boolean {
  if (value === undefined) return false
  if (key === 'product_view') return true
  if (typeof value === 'boolean') return true
  if (typeof value === 'number') return true
  if (typeof value === 'string') return value.trim().length > 0
  if (value === null) return false
  return false
}

function buildImagePatches(images: DraftImage[], initialImages: DraftImage[]): DraftImageUpdate[] {
  const initialMap = new Map(initialImages.map((img) => [img.url, img]))
  const patches: DraftImageUpdate[] = []

  for (const image of images) {
    const initial = initialMap.get(image.url)
    const patch: Partial<Record<keyof DraftImageUpdate, DraftImageUpdate[keyof DraftImageUpdate]>> & Pick<DraftImageUpdate, 'url'> = { url: image.url }
    let changed = false

    for (const key of IMAGE_FIELDS) {
      const currentValue = image[key]
      const initialValue = initial?.[key]
      if (valuesEqual(currentValue, initialValue)) continue
      if (!shouldIncludeImageField(key, currentValue)) continue
      patch[key] = currentValue as DraftImageUpdate[typeof key]
      changed = true
    }

    if (!initial && !changed) {
      continue
    }

    if (!initial && !('product_view' in patch)) {
      if (image.product_view) {
        patch.product_view = image.product_view
        changed = true
      }
    }

    if (changed) {
      patches.push(patch as DraftImageUpdate)
    }
  }

  return patches
}

function buildValidations(product: DraftProduct, images: DraftImage[]): ValidationMessage[] {
  const messages: ValidationMessage[] = []
  if (!product.category_ghost) {
    messages.push({ code: 'category_missing', message: 'Select a category (topwear/bottomwear/dresses/footwear)', severity: 'error' })
  }
  const effectivePrice = typeof product.price_minor === 'number'
    ? product.price_minor
    : typeof product.price === 'number'
      ? product.price
      : null
  if (!effectivePrice || effectivePrice <= 0) {
    messages.push({ code: 'price_missing', message: 'Price must be provided and greater than zero', severity: 'error' })
  }
  if (!product.currency) {
    messages.push({ code: 'currency_missing', message: 'Currency is required', severity: 'error' })
  }
  if (!product.product_url) {
    messages.push({ code: 'product_url_missing', message: 'Product URL is required', severity: 'error' })
  }
  const primaryCount = images.filter((img) => img.is_primary).length
  if (primaryCount === 0) {
    messages.push({ code: 'primary_missing', message: 'Select a primary image', severity: 'error' })
  } else if (primaryCount > 1) {
    messages.push({ code: 'primary_multiple', message: 'Only one primary image is allowed', severity: 'error' })
  }
  if (extractSummaryCount(images) === 0) {
    messages.push({ code: 'summary_missing', message: 'Mark at least one summary eligible image', severity: 'warning' })
  }
  const summaryFront = images.filter((img) => img.summary_eligible && img.product_view === 'front')
  if (summaryFront.length === 0) {
    messages.push({ code: 'summary_front_missing', message: 'Add a front summary-eligible image (flatlay or model)', severity: 'warning' })
  }
  const ghostFront = images.filter((img) => img.ghost_eligible && img.product_view === 'front')
  if (ghostFront.length === 0) {
    messages.push({ code: 'ghost_front_missing', message: 'Add a front ghost-eligible image (model recommended)', severity: 'error' })
  }
  const ghostIssues = images
    .filter((img) => img.ghost_eligible && !(img.product_view === 'front' || img.product_view === 'back'))
  if (ghostIssues.length > 0) {
    messages.push({ code: 'ghost_view', message: 'Ghost eligible images must be tagged as front or back', severity: 'error' })
  }
  const missingKinds = images.filter((img) => !img.kind || `${img.kind}`.trim().length === 0)
  if (missingKinds.length > 0) {
    messages.push({ code: 'kind_missing', message: 'Set image kind (flatlay/model/detail) for all images', severity: 'warning' })
  }
  return messages
}

function isDirty<T>(current: T, initial: T) {
  return JSON.stringify(current) !== JSON.stringify(initial)
}

const viewOptions: Array<{ value: NonNullable<DraftImage['product_view']>; label: string }> = [
  { value: 'front', label: 'Front' },
  { value: 'back', label: 'Back' },
  { value: 'side', label: 'Side' },
  { value: 'detail', label: 'Detail' },
  { value: 'other', label: 'Other' },
]

const imageKindOptions: Array<{ value: string; label: string }> = [
  { value: 'flatlay', label: 'Flatlay' },
  { value: 'model', label: 'Model' },
  { value: 'detail', label: 'Detail' },
]

function resolveJobId(state?: PipelineState): string | null {
  if (!state) return null
  if (typeof state.jobId === 'string' && state.jobId.trim()) return state.jobId
  const record = state as Record<string, unknown>
  const fromSnake = record['job_id']
  if (typeof fromSnake === 'string' && fromSnake.trim()) return fromSnake
  return null
}

function readStringField(source: Record<string, unknown> | null | undefined, key: string): string | undefined {
  if (!source) return undefined
  const value = source[key]
  return typeof value === 'string' ? value : undefined
}

function readBooleanField(source: Record<string, unknown> | null | undefined, key: string): boolean | undefined {
  if (!source) return undefined
  const value = source[key]
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true
    if (value.toLowerCase() === 'false') return false
  }
  return undefined
}

function readRecordField(source: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> | undefined {
  if (!source) return undefined
  const value = source[key]
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return undefined
}

type EnrichFieldKey =
  | 'product_name_suggestion'
  | 'fit'
  | 'feel'
  | 'vibes'
  | 'description_text'
  | 'type_category'
  | 'color_group'
  | 'occasion'
  | 'material_type'
  | 'product_specifications'
  | 'care'

type DismissedSuggestionsState = Partial<Record<EnrichFieldKey, boolean>>
type SuggestionDraftState = Partial<Record<EnrichFieldKey, string>>

type PipelineErrorEntry = {
  step?: string
  message?: string
}

const ENRICH_FIELD_META: Array<{ key: EnrichFieldKey; label: string; helper?: string }> = [
  { key: 'fit', label: 'Fit' },
  { key: 'feel', label: 'Feel' },
  { key: 'vibes', label: 'Vibes', helper: 'Comma-separated tags' },
  { key: 'description_text', label: 'Description (short copy)' },
  { key: 'type_category', label: 'Type Category' },
  { key: 'color_group', label: 'Color Group' },
  { key: 'occasion', label: 'Occasion' },
  { key: 'material_type', label: 'Material Type' },
  { key: 'product_specifications', label: 'Specifications' },
  { key: 'care', label: 'Care' },
  { key: 'product_name_suggestion', label: 'Product Name (Suggested)' },
]

function formatSuggestionValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry)))
      .join(', ')
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function normalizeEnrichSuggestionValue(key: EnrichFieldKey, value: unknown): string | string[] | Record<string, unknown> | null {
  if (value === undefined || value === null) {
    return null
  }
  if (key === 'vibes') {
    if (Array.isArray(value)) {
      const list = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      return list.length ? list : null
    }
    if (typeof value === 'string' && value.trim()) {
      const tokens = value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
      return tokens.length ? tokens : null
    }
    return null
  }
  if (key === 'product_specifications') {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length ? trimmed : null
  }
  return null
}

function serializeSuggestionForEdit(key: EnrichFieldKey, value: unknown): string {
  if (value === undefined || value === null) return ''
  if (key === 'product_specifications') {
    if (typeof value === 'object' && value !== null) {
      try {
        return JSON.stringify(value, null, 2)
      } catch {
        return ''
      }
    }
    if (typeof value === 'string') {
      return value
    }
    return ''
  }
  if (key === 'vibes') {
    if (Array.isArray(value)) {
      return value.map((entry) => (typeof entry === 'string' ? entry : String(entry))).join(', ')
    }
    if (typeof value === 'string') return value
    return ''
  }
  if (typeof value === 'string') return value
  return ''
}

function parseEditedSuggestionValue(key: EnrichFieldKey, text: string): { value: unknown; error?: string } {
  const trimmed = text.trim()
  if (!trimmed) {
    return { value: null }
  }
  if (key === 'product_specifications') {
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { value: null, error: 'Provide a JSON object' }
      }
      return { value: parsed }
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : 'Invalid JSON' }
    }
  }
  if (key === 'vibes') {
    const tokens = trimmed
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    return { value: tokens.length ? tokens : null }
  }
  return { value: trimmed }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const parts = result.split(',')
      resolve(parts.length > 1 ? parts[1] : parts[0])
    }
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read file'))
    reader.readAsDataURL(file)
  })
}

function formatTimestamp(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function getImageSrc(image: DraftImage): string {
  return getPublicUrl(image.storage_path) ?? image.url
}

function getProcessedGhost(state?: PipelineState) {
  const processedRoot = (state?.processed as Record<string, unknown> | undefined)?.productImages
  if (!processedRoot || typeof processedRoot !== 'object') return {}
  return processedRoot as Record<string, unknown>
}

function resolveProcessedPath(processed: Record<string, unknown>, key: string): string | undefined {
  const entry = processed[key]
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const maybePath = (entry as Record<string, unknown>).storagePath
    return typeof maybePath === 'string' ? maybePath : undefined
  }
  return undefined
}

function detectImageIssues(image: DraftImage): string | null {
  if (!image.storage_path) return 'Missing Supabase asset'
  if (!image.product_view) return 'Missing product view'
  return null
}

function formatBadgeStatus(status: string, isWarning?: boolean) {
  return <Badge variant={isWarning ? 'destructive' : 'outline'} className="text-xs">{status}</Badge>
}

const FLOAT_INPUT_STEP = 0.01
const FLOAT_INPUT_DECIMALS = 2

function roundToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function formatFloat(value: number): string {
  const rounded = roundToDecimals(value, FLOAT_INPUT_DECIMALS)
  return rounded
    .toFixed(FLOAT_INPUT_DECIMALS)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1')
}

function parseFiniteNumber(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeFloatInput(value: number, min: number, max: number): number {
  const clamped = clampNumber(value, min, max)
  return roundToDecimals(clamped, FLOAT_INPUT_DECIMALS)
}

const Field = ({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) => (
  <div className={cn('grid gap-2 text-sm', className)}>
    <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
    {children}
  </div>
)

export function InventoryDashboard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const jobIdParam = searchParams.get('jobId') ?? ''
  const { toast } = useToast()
  const { job, loading, status, phase, pause, flags, refetch, startPolling, stopPolling } = useHitlJob(jobIdParam || null)
  const phase1 = useHitlPhase1()
  const phase2 = useHitlPhase2()
  const { categories, loading: loadingCategories } = useCategories()
  const [batchDrawerOpen, setBatchDrawerOpen] = useState(false)
  const [batchUrlsInput, setBatchUrlsInput] = useState('')
  const [batchLabel, setBatchLabel] = useState('')
  const { submit: submitBatch, status: batchStatus, result: batchResult, error: batchError, reset: resetBatch } = useBatchSubmit()
  const jobRecord = job && typeof job === 'object' ? (job as Record<string, unknown>) : undefined
  const [catalogJob, setCatalogJob] = useState<CatalogJob | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [dismissedSuggestions, setDismissedSuggestions] = useState<DismissedSuggestionsState>({})
  const [suggestionDrafts, setSuggestionDrafts] = useState<SuggestionDraftState>({})
  const [pendingSuggestion, setPendingSuggestion] = useState<EnrichFieldKey | null>(null)
  const [acceptAllSuggestionsPending, setAcceptAllSuggestionsPending] = useState(false)
  const [regeneratingView, setRegeneratingView] = useState<'front' | 'back' | null>(null)
  const [uploadingView, setUploadingView] = useState<'front' | 'back' | null>(null)
  const [phase1Uploading, setPhase1Uploading] = useState(false)
  const [phase1Deleting, setPhase1Deleting] = useState(false)
  const [phase1DeleteTarget, setPhase1DeleteTarget] = useState<DraftImage | null>(null)
  const [phase1CompletePreviewOpen, setPhase1CompletePreviewOpen] = useState(false)
  const [phase1ImagePreviewTarget, setPhase1ImagePreviewTarget] = useState<{ image: DraftImage; index: number } | null>(null)
  const [uploadErrors, setUploadErrors] = useState<Partial<Record<'front' | 'back', string>>>({})
  const uploadInputRefs = useRef<Record<'front' | 'back', HTMLInputElement | null>>({
    front: null,
    back: null,
  })
  const phase1UploadRef = useRef<HTMLInputElement | null>(null)
  const [hasSeenPhase2, setHasSeenPhase2] = useState(false)

  const [defaultPreviewItems, setDefaultPreviewItems] = useState<DefaultPreviewItemsMap>(() => ({
    male: { ...STATIC_DEFAULT_ITEM_URLS.male },
    female: { ...STATIC_DEFAULT_ITEM_URLS.female },
  }))

  const [activeTab, setActiveTab] = useState<'phase1' | 'phase2'>('phase1')
  const [productForm, setProductForm] = useState<DraftProduct>(() => toDraftProduct(job))
  const [initialProduct, setInitialProduct] = useState<DraftProduct>(() => toDraftProduct(job))
  const [sizeChartText, setSizeChartText] = useState(stringifySizeChart(productForm.size_chart))
  const [imagesForm, setImagesForm] = useState<DraftImage[]>(() => toDraftImages(job))
  const [initialImages, setInitialImages] = useState<DraftImage[]>(() => toDraftImages(job))
  const [imagePayloadSaving, setImagePayloadSaving] = useState(false)
  const [productPayloadSaving, setProductPayloadSaving] = useState(false)
  const [summaryFrontText, setSummaryFrontText] = useState('')
  const [summaryBackText, setSummaryBackText] = useState('')
  const [summaryVersion, setSummaryVersion] = useState('')
  const [initialSummaryFront, setInitialSummaryFront] = useState('')
  const [initialSummaryBack, setInitialSummaryBack] = useState('')
  const [initialSummaryVersion, setInitialSummaryVersion] = useState('')

  useEffect(() => {
    if (phase === 'phase2') {
      setHasSeenPhase2(true)
      setActiveTab('phase2')
      return
    }
    if (!hasSeenPhase2) {
      setActiveTab('phase1')
    }
  }, [phase, hasSeenPhase2])

  useEffect(() => {
    setDismissedSuggestions({})
    setSuggestionDrafts({})
    setPendingSuggestion(null)
    setRegeneratingView(null)
    setUploadingView(null)
    setPhase1Uploading(false)
    setPhase1Deleting(false)
    setPhase1DeleteTarget(null)
    setPhase1CompletePreviewOpen(false)
    setPhase1ImagePreviewTarget(null)
    setUploadErrors({})
    setHasSeenPhase2(false)
  }, [jobIdParam])

  useEffect(() => {
    let cancelled = false
    if (!jobIdParam) {
      setCatalogJob(null)
      setCatalogError(null)
      setCatalogLoading(false)
      return
    }
    setCatalogLoading(true)
    setCatalogError(null)
    fetchJobDetails(jobIdParam)
      .then((response) => {
        if (cancelled) return
        setCatalogJob(response.job ?? null)
        setCatalogLoading(false)
      })
      .catch((error) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : 'Failed to load job metadata'
        setCatalogError(message)
        setCatalogLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [jobIdParam])

  useEffect(() => {
    if (!job) return
    const nextProduct = toDraftProduct(job)
    setProductForm(nextProduct)
    setInitialProduct(nextProduct)
    setSizeChartText(stringifySizeChart(nextProduct.size_chart))
    const nextImages = toDraftImages(job)
    setImagesForm(nextImages)
    setInitialImages(nextImages)
    const rawProduct = (job?.draft as Record<string, unknown> | undefined)?.product as Record<string, unknown> | undefined
    const front = rawProduct?.garment_summary_front ?? null
    const back = rawProduct?.garment_summary_back ?? null
    const version = typeof rawProduct?.garment_summary_version === 'string' ? rawProduct.garment_summary_version : ''
    const frontText = formatJson(front)
    const backText = formatJson(back)
    setSummaryFrontText(frontText)
    setSummaryBackText(backText)
    setSummaryVersion(version)
    setInitialSummaryFront(frontText)
    setInitialSummaryBack(backText)
    setInitialSummaryVersion(version)
  }, [job])

  useEffect(() => {
    setDismissedSuggestions({})
    setSuggestionDrafts({})
    setPendingSuggestion(null)
    setRegeneratingView(null)
    setUploadingView(null)
    setPhase1Uploading(false)
    setPhase1Deleting(false)
    setPhase1DeleteTarget(null)
    setPhase1CompletePreviewOpen(false)
    setPhase1ImagePreviewTarget(null)
    setUploadErrors({})
  }, [job])

  useEffect(() => {
    let cancelled = false
    const loadDefaults = async () => {
      const base: DefaultPreviewItemsMap = {
        male: { ...STATIC_DEFAULT_ITEM_URLS.male },
        female: { ...STATIC_DEFAULT_ITEM_URLS.female },
      }
      const genders: PreviewGender[] = ['male', 'female']
      const slots: Array<'top' | 'bottom' | 'shoes'> = ['top', 'bottom', 'shoes']
      try {
        await Promise.all(
          genders.map(async (gender) => {
            await Promise.all(
              slots.map(async (slot) => {
                const folder = DEFAULT_PREVIEW_SLOT_FOLDERS[slot]
                const listPath = `${DEFAULT_ITEM_PREFIX}/${gender}/${folder}`
                const { data, error } = await supabase.storage
                  .from(STORAGE_BUCKET)
                  .list(listPath, { sortBy: { column: 'name', order: 'asc' } })
                if (error) {
                  console.error('[HITL] Failed to list default preview items', listPath, error)
                  return
                }
                const fileEntries = (data ?? []).filter(
                  (entry) => entry.name && /\.(png|jpe?g|webp|avif)$/i.test(entry.name)
                )
                const firstFile = fileEntries[0]
                if (!firstFile?.name) {
                  return
                }
                const filePath = `${listPath}/${firstFile.name}`
                const { data: publicData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath)
                const publicUrl = publicData?.publicUrl
                if (!publicUrl) return
                base[gender][slot] = {
                  id: `default-${gender}-${slot}`,
                  type: slot,
                  brand: 'Baseline',
                  product_name: null,
                  size: '',
                  price: 0,
                  currency: 'INR',
                  imageUrl: publicUrl,
                  description: `${gender} ${slot}`,
                  color: '',
                  color_group: null,
                  gender,
                  placement_y: null,
                  placement_x: 0,
                  image_length: null,
                  fit: null,
                  feel: null,
                  category_id: null,
                  type_category: null,
                }
              })
            )
          })
        )
        if (!cancelled) {
          setDefaultPreviewItems(base)
        }
      } catch (error) {
        if (!cancelled) {
          console.error('[HITL] Failed to load default preview items', error)
          setDefaultPreviewItems(base)
        }
      }
    }
    loadDefaults()
    return () => {
      cancelled = true
    }
  }, [])

  const validations = useMemo(() => buildValidations(productForm, imagesForm), [productForm, imagesForm])
  const hasBlockingErrors = validations.some((v) => v.severity === 'error')

  const productDirty = useMemo(() => isDirty(productForm, initialProduct) || stringifySizeChart(productForm.size_chart) !== stringifySizeChart(initialProduct.size_chart), [productForm, initialProduct])
  const imagesDirty = useMemo(() => isDirty(imagesForm, initialImages), [imagesForm, initialImages])
  const summariesDirty = useMemo(() => summaryFrontText !== initialSummaryFront || summaryBackText !== initialSummaryBack || summaryVersion !== initialSummaryVersion, [summaryFrontText, initialSummaryFront, summaryBackText, initialSummaryBack, summaryVersion, initialSummaryVersion])

  const enrichSuggestions = useMemo(() => {
    const suggestionsRoot = ((job?.draft as Record<string, unknown> | undefined)?.productSuggestions as Record<string, unknown> | undefined) ?? {}
    const enrich = suggestionsRoot.enrich
    if (!enrich || typeof enrich !== 'object') {
      return {} as Record<EnrichFieldKey, unknown>
    }
    const result: Partial<Record<EnrichFieldKey, unknown>> = {}
    ENRICH_FIELD_META.forEach(({ key }) => {
      const value = (enrich as Record<string, unknown>)[key]
      if (value !== undefined) {
        result[key] = value
      }
    })
    return result as Record<EnrichFieldKey, unknown>
  }, [job])

  const resolvedJobIdMemo = useMemo(() => resolveJobId(job), [job])
  const ghostViews = useMemo(() => buildGhostViews(job), [job])
  const ghostBackEnabled = useMemo(() => {
    const artifacts = (job?.artifacts as Record<string, unknown> | undefined) ?? undefined
    const capabilities = artifacts && typeof artifacts === 'object'
      ? ((artifacts as Record<string, unknown>).capabilities as Record<string, unknown> | undefined)
      : undefined
    return Boolean(capabilities && typeof capabilities.ghostBackEnabled === 'boolean' ? capabilities.ghostBackEnabled : false)
  }, [job])
  const ghostBackWarningVisible = useMemo(() => {
    if (ghostBackEnabled) return false
    return imagesForm.some((img) => img.product_view === 'back' && img.ghost_eligible)
  }, [ghostBackEnabled, imagesForm])
  const ghostViewOrder = useMemo(
    () => (ghostBackEnabled ? GHOST_VIEW_ORDER : (['front'] as const)),
    [ghostBackEnabled]
  )
  const imageByUrl = useMemo(() => new Map(imagesForm.map((image) => [image.url, image])), [imagesForm])
  const rawByUrl = useMemo(() => {
    const rawImages = getRawImages(job)
    return new Map(rawImages.map((raw) => [raw.originalUrl ?? (raw as Record<string, unknown>).url ?? '', raw]))
  }, [job])
  const primaryImage = useMemo(() => {
    const primary = imagesForm.find((img) => img.is_primary)
    if (primary) return primary
    return imagesForm[0]
  }, [imagesForm])

  const processedGhostMap = useMemo(() => getProcessedGhost(job), [job])
  const processedFront = useMemo(() => resolveProcessedPath(processedGhostMap, 'front'), [processedGhostMap])
  const processedBack = useMemo(() => resolveProcessedPath(processedGhostMap, 'back'), [processedGhostMap])

  const primaryProcessedPath = useMemo(() => {
    if (!primaryImage?.product_view) {
      return processedFront ?? processedBack ?? null
    }
    return resolveProcessedPath(processedGhostMap, primaryImage.product_view) ?? processedFront ?? processedBack ?? null
  }, [primaryImage?.product_view, processedGhostMap, processedFront, processedBack])

  const processedPreviewUrl = useMemo(() => {
    if (!primaryProcessedPath) return null
    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(primaryProcessedPath)
    return data?.publicUrl ?? null
  }, [primaryProcessedPath])

  const fallbackPreviewUrl = useMemo(() => {
    if (primaryImage?.storage_path) {
      const publicUrl = getPublicUrl(primaryImage.storage_path)
      if (publicUrl) return publicUrl
    }
    if (primaryImage?.url) {
      return primaryImage.url
    }
    if (productForm.image_url && productForm.image_url.trim().length > 0) {
      return productForm.image_url
    }
    return null
  }, [primaryImage, productForm.image_url])

  const autoPreviewGender = useMemo<PreviewGender>(() => resolvePreviewGender(productForm.gender), [productForm.gender])
  type MannequinGenderMode = 'auto' | PreviewGender
  const [mannequinGenderMode, setMannequinGenderMode] = useState<MannequinGenderMode>('auto')
  useEffect(() => {
    setMannequinGenderMode('auto')
  }, [resolvedJobIdMemo])
  const effectivePreviewGender = useMemo<PreviewGender>(
    () => (mannequinGenderMode === 'auto' ? autoPreviewGender : mannequinGenderMode),
    [autoPreviewGender, mannequinGenderMode],
  )
  const mannequinQuery = useMannequinConfig({ gender: effectivePreviewGender })
  const resolvedProductType = useMemo<OutfitItem['type']>(
    () => (productForm.type as OutfitItem['type'] | undefined) ?? 'top',
    [productForm.type]
  )

  const [placementX, setPlacementX] = useState<number | null>(productForm.placement_x ?? null)
  const [placementY, setPlacementY] = useState<number | null>(productForm.placement_y ?? null)
  const [initialPlacementX, setInitialPlacementX] = useState<number | null>(productForm.placement_x ?? null)
  const [initialPlacementY, setInitialPlacementY] = useState<number | null>(productForm.placement_y ?? null)
  const [placementDirty, setPlacementDirty] = useState(false)
  const [placementPending, setPlacementPending] = useState(false)
  const [imageLength, setImageLength] = useState<number | null>(productForm.image_length ?? null)
  const [initialImageLength, setInitialImageLength] = useState<number | null>(productForm.image_length ?? null)
  const [imageLengthDirty, setImageLengthDirty] = useState(false)
  const [previewOpacity, setPreviewOpacity] = useState<number>(100)
  const [placementXText, setPlacementXText] = useState(() => formatFloat(productForm.placement_x ?? 0))
  const [placementYText, setPlacementYText] = useState(() => formatFloat(productForm.placement_y ?? 0))
  const [imageLengthText, setImageLengthText] = useState(() =>
    typeof productForm.image_length === 'number' ? formatFloat(productForm.image_length) : '',
  )
  const skipPlacementXBlurCommit = useRef(false)
  const skipPlacementYBlurCommit = useRef(false)
  const skipImageLengthBlurCommit = useRef(false)

  const resolvePreviewVisibleSegments = (value: unknown): MannequinSegmentName[] => {
    if (Array.isArray(value)) {
      const filtered = value.filter(
        (entry): entry is MannequinSegmentName => typeof entry === 'string' && entry.trim().length > 0,
      ) as MannequinSegmentName[]
      if (filtered.length > 0) return filtered
    }
    return MANNEQUIN_SEGMENT_NAMES
  }

  const [bodyPartsVisible, setBodyPartsVisible] = useState<MannequinSegmentName[] | null>(
    resolvePreviewVisibleSegments(productForm.body_parts_visible),
  )
  const [initialBodyPartsVisible, setInitialBodyPartsVisible] = useState<MannequinSegmentName[] | null>(
    resolvePreviewVisibleSegments(productForm.body_parts_visible),
  )
  const [bodyPartsDirty, setBodyPartsDirty] = useState(false)
  const hasPreviewChanges = placementDirty || imageLengthDirty || bodyPartsDirty

  useEffect(() => {
    const nextPlacementX =
      typeof productForm.placement_x === 'number' ? normalizeFloatInput(productForm.placement_x, -100, 100) : null
    const nextPlacementY =
      typeof productForm.placement_y === 'number' ? normalizeFloatInput(productForm.placement_y, -100, 100) : null
    const nextImageLength =
      typeof productForm.image_length === 'number' ? normalizeFloatInput(productForm.image_length, 0, 200) : null

    setPlacementX(nextPlacementX)
    setPlacementY(nextPlacementY)
    setInitialPlacementX(nextPlacementX)
    setInitialPlacementY(nextPlacementY)
    setPlacementDirty(false)
    setImageLength(nextImageLength)
    setInitialImageLength(nextImageLength)
    setImageLengthDirty(false)
    const nextSegments = resolvePreviewVisibleSegments(productForm.body_parts_visible)
    setBodyPartsVisible(nextSegments)
    setInitialBodyPartsVisible(nextSegments)
    setBodyPartsDirty(false)
  }, [productForm.placement_x, productForm.placement_y, productForm.image_length, productForm.body_parts_visible])

  useEffect(() => {
    setPlacementXText(formatFloat(placementX ?? 0))
  }, [placementX])

  useEffect(() => {
    setPlacementYText(formatFloat(placementY ?? 0))
  }, [placementY])

  useEffect(() => {
    setImageLengthText(imageLength === null ? '' : formatFloat(imageLength))
  }, [imageLength])

  useEffect(() => {
    const changed =
      placementX !== initialPlacementX ||
      placementY !== initialPlacementY
    setPlacementDirty(changed)
  }, [placementX, placementY, initialPlacementX, initialPlacementY])

  useEffect(() => {
    const changed = (imageLength ?? null) !== (initialImageLength ?? null)
    setImageLengthDirty(changed)
  }, [imageLength, initialImageLength])

  useEffect(() => {
    const current = (bodyPartsVisible ?? []).join('|')
    const initial = (initialBodyPartsVisible ?? []).join('|')
    setBodyPartsDirty(current !== initial)
  }, [bodyPartsVisible, initialBodyPartsVisible])

  useEffect(() => {
    const resolvedGender = productForm.gender ?? null
    setImagesForm((prev) => {
      let changed = false
      const next = prev.map((img) => {
        const current = img.gender ?? null
        if (current !== resolvedGender) {
          changed = true
          return { ...img, gender: resolvedGender }
        }
        return img
      })
      return changed ? next : prev
    })
  }, [productForm.gender])

  const scalingSupported = resolvedProductType === 'top' || resolvedProductType === 'bottom' || resolvedProductType === 'shoes'
  const sliderSlotKey: 'top' | 'bottom' | 'shoes' = scalingSupported ? resolvedProductType : 'top'
  const sliderDefaults = IMAGE_LENGTH_DEFAULTS[sliderSlotKey]
  const sliderRange = IMAGE_LENGTH_RANGES[sliderSlotKey]
  const sliderCurrentValue = imageLength !== null ? imageLength : sliderDefaults
  const sliderLabel = imageLength !== null ? `${formatFloat(sliderCurrentValue)} cm` : 'Auto (head-based)'

  const { rows: imageFieldRows, missingColumns: imageMissingColumns } = useMemo(() => {
    const processed = getProcessedGhost(job)
    const missingCols = new Set<string>()
    const rows = imagesForm.map((image, index) => {
      const processedPath = image.product_view ? resolveProcessedPath(processed, image.product_view) ?? null : null
      const issue = detectImageIssues(image)
      const publicUrl = getPublicUrl(image.storage_path) ?? image.url ?? null
      const thumbnailUrl = publicUrl
      const resolvedKind = image.kind ?? 'model'
      const kindSource: ImageFieldRow['kindSource'] = image.kind ? 'explicit' : 'fallback'
      const resolvedGender = image.gender ?? productForm.gender ?? null
      const genderSource: ImageFieldRow['genderSource'] = image.gender
        ? 'image'
        : productForm.gender
          ? 'product'
          : 'none'
      return {
        id: image.url || `image-${index}`,
        label: `Image ${index + 1}`,
        url: image.url,
        thumbnailUrl,
        productId: image.product_id ?? null,
        isPrimary: Boolean(image.is_primary),
        product_view: image.product_view,
        ghost_eligible: Boolean(image.ghost_eligible),
        summary_eligible: Boolean(image.summary_eligible),
        vto_eligible: Boolean(image.vto_eligible),
        kind: image.kind ?? null,
        sort_order: image.sort_order ?? index,
        gender: image.gender ?? null,
        publicUrl,
        storage_path: image.storage_path,
        processed_path: processedPath,
        placement_x: image.placement_x ?? null,
        placement_y: image.placement_y ?? null,
        columns: {
          product_id: image.product_id ?? '',
          url: publicUrl ?? '',
          kind: resolvedKind,
          sort_order: image.sort_order ?? index,
          is_primary: image.is_primary,
          product_view: image.product_view,
          ghost_eligible: image.ghost_eligible,
          summary_eligible: image.summary_eligible,
          vto_eligible: image.vto_eligible,
          gender: resolvedGender ?? '',
        },
        resolvedKind,
        kindSource,
        resolvedGender,
        genderSource,
        isValid: !issue,
        statusLabel: issue ?? 'Ready',
      }
    })

    return {
      rows,
      missingColumns: Array.from(missingCols).sort(),
    }
  }, [imagesForm, job, productForm.gender])

  const primaryPublicImageUrl = useMemo(() => {
    const processed = getProcessedGhost(job)
    const primaryImage = imagesForm.find((image) => image.is_primary)
    if (!primaryImage) return null
    if (primaryImage.product_view) {
      const processedPath = resolveProcessedPath(processed, primaryImage.product_view)
      if (processedPath) {
        const processedUrl = getPublicUrl(processedPath)
        if (processedUrl) return processedUrl
      }
    }
    return getPublicUrl(primaryImage.storage_path) ?? primaryImage.url ?? null
  }, [imagesForm, job])

  const commitPlacementXText = useCallback(() => {
    const parsed = parseFiniteNumber(placementXText)
    if (parsed === null) {
      setPlacementXText(formatFloat(placementX ?? 0))
      return
    }
    const normalized = normalizeFloatInput(parsed, -100, 100)
    setPlacementX(normalized)
    setPlacementXText(formatFloat(normalized))
  }, [placementX, placementXText])

  const commitPlacementYText = useCallback(() => {
    const parsed = parseFiniteNumber(placementYText)
    if (parsed === null) {
      setPlacementYText(formatFloat(placementY ?? 0))
      return
    }
    const normalized = normalizeFloatInput(parsed, -100, 100)
    setPlacementY(normalized)
    setPlacementYText(formatFloat(normalized))
  }, [placementY, placementYText])

  const commitImageLengthText = useCallback(() => {
    const parsed = parseFiniteNumber(imageLengthText)
    if (parsed === null) {
      setImageLengthText(imageLength === null ? '' : formatFloat(imageLength))
      return
    }
    const normalized = normalizeFloatInput(parsed, 0, 200)
    setImageLength(normalized)
    setImageLengthText(formatFloat(normalized))
  }, [imageLength, imageLengthText])

  const nudgePlacementX = useCallback((delta: number) => {
    const base = parseFiniteNumber(placementXText) ?? placementX ?? 0
    const next = normalizeFloatInput(base + delta, -100, 100)
    setPlacementX(next)
    setPlacementXText(formatFloat(next))
  }, [placementX, placementXText])

  const nudgePlacementY = useCallback((delta: number) => {
    const base = parseFiniteNumber(placementYText) ?? placementY ?? 0
    const next = normalizeFloatInput(base + delta, -100, 100)
    setPlacementY(next)
    setPlacementYText(formatFloat(next))
  }, [placementY, placementYText])

  const nudgeImageLength = useCallback((delta: number) => {
    const base = parseFiniteNumber(imageLengthText) ?? (imageLength !== null ? imageLength : sliderCurrentValue)
    const next = normalizeFloatInput(base + delta, sliderRange.min, sliderRange.max)
    setImageLength(next)
    setImageLengthText(formatFloat(next))
  }, [imageLength, imageLengthText, sliderCurrentValue, sliderRange.max, sliderRange.min])

  const handlePlacementChange = useCallback((axis: 'x' | 'y', value: number[]) => {
    const next = normalizeFloatInput(value[0] ?? 0, -100, 100)
    if (axis === 'x') {
      setPlacementX(next)
    } else {
      setPlacementY(next)
    }
  }, [])

  const handleImageLengthChange = useCallback((value: number[]) => {
    const next = normalizeFloatInput(value[0] ?? 0, 0, 200)
    setImageLength(next)
  }, [])

  const handleImageLengthAuto = useCallback(() => {
    setImageLength(null)
  }, [])

  const handlePlacementReset = useCallback(() => {
    setPlacementX(initialPlacementX ?? 0)
    setPlacementY(initialPlacementY ?? 0)
    setImageLength(initialImageLength ?? null)
    setBodyPartsVisible(initialBodyPartsVisible ?? null)
  }, [initialPlacementX, initialPlacementY, initialImageLength, initialBodyPartsVisible])

  const handlePlacementSave = useCallback(async () => {
    const resolvedJobId = resolveJobId(job)
    if (!resolvedJobId) return
    const payload: Record<string, unknown> = {}
    const placementXChanged = placementX !== initialPlacementX
    const placementYChanged = placementY !== initialPlacementY
    const storedBodyPartsVisible = Array.isArray(productForm.body_parts_visible)
      ? (productForm.body_parts_visible.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0))
      : []
    const bodyPartsChanged = bodyPartsDirty || (storedBodyPartsVisible.length === 0 && (bodyPartsVisible?.length ?? 0) > 0)
    if (placementXChanged) {
      payload.placement_x = placementX ?? 0
    }
    if (placementYChanged) {
      payload.placement_y = placementY ?? 0
    }
    if (imageLengthDirty) {
      payload.image_length = imageLength ?? null
    }
    if (bodyPartsChanged) {
      payload.body_parts_visible = bodyPartsVisible ?? null
    }
    if (
      Object.keys(payload).length === 0 &&
      (initialPlacementX === null || initialPlacementY === null || initialImageLength === null)
    ) {
      payload.placement_x = placementX ?? 0
      payload.placement_y = placementY ?? 0
      payload.image_length = imageLength ?? sliderCurrentValue
      if (bodyPartsVisible !== null) {
        payload.body_parts_visible = bodyPartsVisible
      }
    }
    if (Object.keys(payload).length === 0) {
      toast({ title: 'Placement unchanged' })
      return
    }
    setPlacementPending(true)
    try {
      await phase2.saveChanges(resolvedJobId, { draft: { product: payload } })
      setInitialPlacementX(placementX ?? null)
      setInitialPlacementY(placementY ?? null)
      setInitialImageLength(imageLength ?? null)
      setInitialBodyPartsVisible(bodyPartsVisible ?? null)
      setPlacementDirty(false)
      setImageLengthDirty(false)
      setBodyPartsDirty(false)
      refetch()
    } catch (error) {
      console.error('Phase 2 placement save failed', error)
    } finally {
      setPlacementPending(false)
    }
  }, [
    job,
    productForm.body_parts_visible,
    phase2,
    placementX,
    placementY,
    imageLength,
    initialPlacementX,
    initialPlacementY,
    imageLengthDirty,
    refetch,
    toast,
    bodyPartsDirty,
    bodyPartsVisible,
  ])

  const previewRenderedItems = useMemo<StudioRenderedItem[]>(() => {
    const assetUrl = processedPreviewUrl ?? fallbackPreviewUrl ?? undefined
    if (!assetUrl) return []

    const priceMinor = typeof productForm.price_minor === 'number'
      ? productForm.price_minor
      : typeof productForm.price === 'number'
        ? productForm.price
        : 0
    const priceMajor = priceMinor

    const resolvedPlacementX = placementX ?? productForm.placement_x ?? 0
    const resolvedPlacementY = placementY ?? productForm.placement_y ?? 0
    const resolvedType = resolvedProductType
    const resolvedId = typeof productForm.id === 'string' && productForm.id.trim().length > 0
      ? productForm.id
      : resolvedJobIdMemo ?? 'preview-top'

    const resolvedImageLength = imageLength ?? 0
    const zone: StudioRenderedItem['zone'] = resolvedType === 'bottom' ? 'bottom' : resolvedType === 'shoes' ? 'shoes' : 'top'

    const actualItem: StudioRenderedItem = {
      id: resolvedId,
      zone,
      imageUrl: assetUrl,
      placementX: resolvedPlacementX ?? 0,
      placementY: resolvedPlacementY ?? 0,
      imageLengthCm: resolvedImageLength ?? 0,
      brand: productForm.brand ?? null,
      productName: productForm.product_name ?? null,
      price: priceMajor,
      currency: productForm.currency ?? 'INR',
      size: typeof productForm.size === 'string' ? productForm.size : null,
      color: productForm.color ?? null,
      colorGroup: productForm.color_group ?? null,
      gender: effectivePreviewGender,
      productUrl: productForm.product_url ?? null,
      description: productForm.description ?? null,
      bodyPartsVisible: bodyPartsVisible ?? null,
      extras: null,
    }

    const defaults = defaultPreviewItems[effectivePreviewGender] ?? {}
    const defaultRendered = mapLegacyOutfitItemsToStudioItems([
      defaults.top,
      defaults.bottom,
      defaults.shoes,
    ].filter(Boolean) as OutfitItem[])

    const merged = defaultRendered.reduce<Record<string, StudioRenderedItem>>((acc, item) => {
      acc[item.zone] = item
      return acc
    }, {})

    merged[zone] = actualItem

    const ordered: StudioRenderedItem[] = []
    ;(['top', 'bottom', 'shoes'] as Array<StudioRenderedItem['zone']>).forEach((slot) => {
      const entry = merged[slot]
      if (entry) {
        ordered.push(entry)
      }
    })

    if (!merged[zone]) {
      ordered.push(actualItem)
    }

    return ordered
  }, [
    processedPreviewUrl,
    fallbackPreviewUrl,
    placementX,
    placementY,
    productForm,
    resolvedJobIdMemo,
    imageLength,
    defaultPreviewItems,
    effectivePreviewGender,
    resolvedProductType,
    bodyPartsVisible,
  ])

  const previewStatusText = processedPreviewUrl
    ? 'Using processed ghost mannequin asset.'
    : fallbackPreviewUrl
      ? 'Fallback to Phase 1 primary image; upload a processed ghost to replace.'
      : 'No preview imagery resolved yet — regenerate or upload a processed ghost.'

  const hasAnySuggestions = useMemo(
    () => ENRICH_FIELD_META.some(({ key }) => enrichSuggestions[key] !== undefined),
    [enrichSuggestions]
  )
  const hasVisibleSuggestions = useMemo(
    () => ENRICH_FIELD_META.some(({ key }) => enrichSuggestions[key] !== undefined && !dismissedSuggestions[key]),
    [dismissedSuggestions, enrichSuggestions]
  )
  const resolvedFlags = useMemo<Record<string, unknown> | undefined>(() => {
    if (flags && typeof flags === 'object' && !Array.isArray(flags)) {
      return flags as Record<string, unknown>
    }
    return readRecordField(jobRecord, 'flags')
  }, [flags, jobRecord])
  const timestampsRecord = useMemo(() => readRecordField(jobRecord, 'timestamps'), [jobRecord])
  const stageCompleted = readBooleanField(resolvedFlags, 'stageCompleted') === true
  const promoteCompleted = readBooleanField(resolvedFlags, 'promoteCompleted') === true
  const hitlPhase2Completed =
    Boolean((flags as { hitlPhase2Completed?: boolean } | undefined)?.hitlPhase2Completed) ||
    readBooleanField(resolvedFlags, 'hitlPhase2Completed') === true
  const stageCompletedAt = readStringField(timestampsRecord, 'stage_completed')
  const promoteCompletedAt = readStringField(timestampsRecord, 'promote_completed')
  const jobErrors = useMemo<PipelineErrorEntry[]>(() => {
    const raw = jobRecord?.errors as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .map((entry) => (entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => ({
        step: typeof entry.step === 'string' ? entry.step : undefined,
        message: typeof entry.message === 'string' ? entry.message : undefined,
      }))
  }, [jobRecord])
  const stageErrors = useMemo(() => jobErrors.filter((error) => error.step === 'stage' && error.message), [jobErrors])
  const promoteErrors = useMemo(
    () => jobErrors.filter((error) => error.step === 'promote' && error.message),
    [jobErrors]
  )
  const approvalInFlight = phase2.status === 'approving'
  const approvalDisabled = approvalInFlight || phase2.status === 'saving' || !resolvedJobIdMemo
  const stageBadgeVariant: 'default' | 'secondary' | 'outline' | 'destructive' =
    stageErrors.length > 0 ? 'destructive' : stageCompleted ? 'default' : approvalInFlight ? 'secondary' : 'outline'
  const promoteBadgeVariant: 'default' | 'secondary' | 'outline' | 'destructive' =
    promoteErrors.length > 0
      ? 'destructive'
      : promoteCompleted
        ? 'default'
        : approvalInFlight
          ? 'secondary'
          : 'outline'
  const stageStatusLabel = stageCompleted ? 'Completed' : approvalInFlight ? 'Processing…' : 'Pending'
  const promoteStatusLabel = promoteCompleted ? 'Completed' : approvalInFlight ? 'Processing…' : 'Pending'
  const stageStatusDescription = stageCompleted
    ? `Completed ${formatTimestamp(stageCompletedAt)}`
    : approvalInFlight
      ? 'Running staging pipeline…'
      : 'Waiting for approval.'
  const promoteStatusDescription = promoteCompleted
    ? `Completed ${formatTimestamp(promoteCompletedAt)}`
    : approvalInFlight
      ? (stageCompleted ? 'Promoting staged payload…' : 'Waiting for staging to finish…')
      : 'Not started yet.'
  const phase2BadgeVariant: 'default' | 'secondary' | 'outline' =
    hitlPhase2Completed ? 'default' : approvalInFlight ? 'secondary' : 'outline'
  const phase2StatusLabel = hitlPhase2Completed ? 'Closed' : approvalInFlight ? 'In progress' : 'Pending'
  const phase2StatusDescription = hitlPhase2Completed
    ? 'Phase 2 is complete.'
    : 'Approve to trigger staging and promotion.'

  const downloadAsset = useCallback(async (url: string, filename: string) => {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Download failed (${response.status})`)
      }
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = filename
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
    } catch (error) {
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.click()
    }
  }, [])

  const handleGhostRegenerate = useCallback(async (view: 'front' | 'back') => {
    if (!resolvedJobIdMemo) {
      toast({ title: 'Job ID missing', description: 'Attach a job before requesting regeneration.', variant: 'destructive' })
      return
    }
    setRegeneratingView(view)
    try {
      await phase2.regenerate(resolvedJobIdMemo, 'ghost', { view })
      setUploadErrors((prev) => {
        const next = { ...prev }
        delete next[view]
        return next
      })
      refetch()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Regeneration failed'
      toast({ title: 'Regeneration failed', description: message, variant: 'destructive' })
    } finally {
      setRegeneratingView(null)
    }
  }, [phase2, refetch, resolvedJobIdMemo, toast, productForm.image_url, initialProduct.image_url])

  const handleGhostUpload = useCallback(async (view: 'front' | 'back', file: File) => {
    if (!resolvedJobIdMemo) {
      toast({ title: 'Job ID missing', description: 'Attach a job before uploading.', variant: 'destructive' })
      return
    }
    setUploadErrors((prev) => {
      const next = { ...prev }
      delete next[view]
      return next
    })
    setUploadingView(view)
    try {
      const base64 = await fileToBase64(file)
      const { storagePath } = await uploadPhase2Ghost(resolvedJobIdMemo, {
        view,
        filename: file.name || `${view}.png`,
        contentType: file.type || 'application/octet-stream',
        data: base64,
      })
      const publicUrl = getPublicUrl(storagePath)
      const shouldSetPrimary = view === 'front' || (!productForm.image_url && !initialProduct.image_url)
      const draftPatch =
        publicUrl && shouldSetPrimary
          ? { product: { image_url: publicUrl } }
          : undefined
      await phase2.saveChanges(resolvedJobIdMemo, {
        draft: draftPatch,
        artifacts: {
          processedUploads: {
            [view]: { storagePath },
          },
        },
      })
      if (publicUrl) {
        setProductForm((prev) => {
          if (!shouldSetPrimary && prev.image_url) return prev
          if (prev.image_url === publicUrl) return prev
          return { ...prev, image_url: publicUrl }
        })
        setInitialProduct((prev) => {
          if (!shouldSetPrimary && prev.image_url) return prev
          if (prev.image_url === publicUrl) return prev
          return { ...prev, image_url: publicUrl }
        })
      }
      toast({ title: `Processed ${view} image uploaded` })
      refetch()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed'
      setUploadErrors((prev) => ({ ...prev, [view]: message }))
      toast({ title: 'Upload failed', description: message, variant: 'destructive' })
    } finally {
      setUploadingView(null)
    }
  }, [phase2, refetch, resolvedJobIdMemo, toast])

  const handleGhostFileChange = useCallback(
    (view: 'front' | 'back') => (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (file) {
        void handleGhostUpload(view, file)
      }
      event.target.value = ''
    },
    [handleGhostUpload],
  )

  const handlePhase1Upload = useCallback(async (file: File) => {
    if (!resolvedJobIdMemo) {
      toast({ title: 'Job ID missing', description: 'Attach a job before uploading.', variant: 'destructive' })
      return
    }
    setPhase1Uploading(true)
    try {
      const base64 = await fileToBase64(file)
      await uploadPhase1Image(resolvedJobIdMemo, {
        filename: file.name || 'upload.jpg',
        contentType: file.type || 'application/octet-stream',
        data: base64,
      })
      toast({ title: 'Image uploaded' })
      refetch()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed'
      toast({ title: 'Upload failed', description: message, variant: 'destructive' })
    } finally {
      setPhase1Uploading(false)
    }
  }, [refetch, resolvedJobIdMemo, toast])

  const handlePhase1FileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      void handlePhase1Upload(file)
    }
    event.target.value = ''
  }, [handlePhase1Upload])

  const triggerPhase1UploadDialog = useCallback(() => {
    phase1UploadRef.current?.click()
  }, [])

  const handlePhase1DeleteConfirm = useCallback(async () => {
    if (!resolvedJobIdMemo || !phase1DeleteTarget) return
    setPhase1Deleting(true)
    try {
      await deletePhase1Image(resolvedJobIdMemo, { url: phase1DeleteTarget.url })
      toast({ title: 'Image deleted' })
      setPhase1DeleteTarget(null)
      refetch()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Delete failed'
      toast({ title: 'Delete failed', description: message, variant: 'destructive' })
    } finally {
      setPhase1Deleting(false)
    }
  }, [phase1DeleteTarget, refetch, resolvedJobIdMemo, toast])

  const triggerGhostUploadDialog = useCallback((view: 'front' | 'back') => {
    uploadInputRefs.current[view]?.click()
  }, [])

  const handleApprovePhase2 = useCallback(async () => {
    if (!resolvedJobIdMemo) {
      toast({ title: 'Job ID missing', description: 'Attach a job before approving.', variant: 'destructive' })
      return
    }
    const parsedSizeChart = parseSizeChart(sizeChartText)
    const approveProductPatch = {
      ...buildProductPatch(productForm, initialProduct, parsedSizeChart),
      placement_x: placementX ?? productForm.placement_x ?? 0,
      placement_y: placementY ?? productForm.placement_y ?? 0,
      image_length: imageLength ?? productForm.image_length ?? null,
      body_parts_visible: bodyPartsVisible ?? productForm.body_parts_visible ?? null,
    }
    const approveImagePatches = buildImagePatches(imagesForm, initialImages)
    const approvePatch: { draft?: { product?: Partial<DraftProduct>; images?: DraftImageUpdate[] } } = {}
    if (Object.keys(approveProductPatch).length > 0) {
      approvePatch.draft = { ...(approvePatch.draft ?? {}), product: approveProductPatch }
    }
    if (approveImagePatches.length > 0) {
      approvePatch.draft = { ...(approvePatch.draft ?? {}), images: approveImagePatches }
    }
    try {
      if (approvePatch.draft) {
        await phase2.saveChanges(resolvedJobIdMemo, approvePatch.draft ? approvePatch : undefined)
        if (approvePatch.draft.product) {
          const nextInitial = { ...initialProduct, ...approvePatch.draft.product }
          setInitialProduct(nextInitial)
          setProductForm((prev) => ({ ...prev, ...approvePatch.draft?.product }))
        }
        if (approvePatch.draft.images) {
          setInitialImages(imagesForm.map((img) => ({ ...img })))
        }
      }
      await phase2.approve(resolvedJobIdMemo)
      refetch()
    } catch (error) {
      console.error('Phase 2 approval failed', error)
    }
  }, [phase2, refetch, resolvedJobIdMemo, toast, placementX, placementY, imageLength, bodyPartsVisible, productForm, initialProduct, sizeChartText, imagesForm, initialImages])

  const handleApplySuggestion = async (field: EnrichFieldKey) => {
    if (!resolvedJobIdMemo) {
      toast({ title: 'Job ID missing', description: 'Attach a job before applying suggestions.', variant: 'destructive' })
      return
    }
    const rawSuggestion = enrichSuggestions[field]
    const editText = suggestionDrafts[field] ?? serializeSuggestionForEdit(field, rawSuggestion)
    const parsed = parseEditedSuggestionValue(field, editText)
    if (parsed.error) {
      toast({ title: 'Unable to apply', description: parsed.error, variant: 'destructive' })
      return
    }
    const normalized = normalizeEnrichSuggestionValue(field, parsed.value)
    const payloadValue =
      field === 'vibes' && Array.isArray(normalized)
        ? normalized.join(', ')
        : field === 'product_specifications' && normalized && typeof normalized === 'object'
          ? JSON.parse(JSON.stringify(normalized))
          : normalized
    const stateValue =
      field === 'product_specifications' && normalized && typeof normalized === 'object'
        ? JSON.parse(JSON.stringify(normalized))
        : Array.isArray(normalized)
          ? [...normalized]
          : normalized
    const productPatchKey = field === 'product_name_suggestion' ? 'product_name' : field
    setPendingSuggestion(field)
    try {
      await phase2.saveChanges(resolvedJobIdMemo, { draft: { product: { [productPatchKey]: payloadValue } } })
      setProductForm((prev) => ({
        ...prev,
        [productPatchKey]: stateValue,
      } as DraftProduct))
      setInitialProduct((prev) => ({
        ...prev,
        [productPatchKey]: stateValue,
      } as DraftProduct))
      setDismissedSuggestions((prev) => {
        const next = { ...prev }
        delete next[field]
        return next
      })
      setSuggestionDrafts((prev) => {
        const next = { ...prev }
        delete next[field]
        return next
      })
      refetch()
    } catch (error) {
      console.error('Failed to apply suggestion', error)
    } finally {
      setPendingSuggestion(null)
    }
  }

  const hasAcceptAllEligibleSuggestions = useMemo(() => {
    return ENRICH_FIELD_META.some(({ key }) => {
      const suggestionRaw = enrichSuggestions[key]
      if (suggestionRaw === undefined) return false
      if (dismissedSuggestions[key]) return false

      const editValue = suggestionDrafts[key] ?? serializeSuggestionForEdit(key, suggestionRaw)
      const parsed = parseEditedSuggestionValue(key, editValue)
      if (parsed.error) return false

      const normalizedSuggestion = normalizeEnrichSuggestionValue(key, parsed.value)
      const currentValue =
        key === 'product_name_suggestion'
          ? productForm.product_name
          : (productForm as Record<string, unknown>)[key]
      const applied = valuesEqual(currentValue ?? null, normalizedSuggestion ?? null)
      return !applied
    })
  }, [dismissedSuggestions, enrichSuggestions, productForm, suggestionDrafts])

  const handleApplyAllSuggestions = async () => {
    if (!resolvedJobIdMemo) {
      toast({ title: 'Job ID missing', description: 'Attach a job before applying suggestions.', variant: 'destructive' })
      return
    }

    const productPatchPayload: Record<string, unknown> = {}
    const productPatchState: Record<string, unknown> = {}
    const appliedKeys: EnrichFieldKey[] = []
    let skippedInvalid = 0

    ENRICH_FIELD_META.forEach(({ key }) => {
      const suggestionRaw = enrichSuggestions[key]
      if (suggestionRaw === undefined) return
      if (dismissedSuggestions[key]) return

      const editText = suggestionDrafts[key] ?? serializeSuggestionForEdit(key, suggestionRaw)
      const parsed = parseEditedSuggestionValue(key, editText)
      if (parsed.error) {
        skippedInvalid += 1
        return
      }

      const normalized = normalizeEnrichSuggestionValue(key, parsed.value)
      const productPatchKey = key === 'product_name_suggestion' ? 'product_name' : key
      const currentValue =
        key === 'product_name_suggestion'
          ? productForm.product_name
          : (productForm as Record<string, unknown>)[key]
      const applied = valuesEqual(currentValue ?? null, normalized ?? null)
      if (applied) return

      const payloadValue =
        key === 'vibes' && Array.isArray(normalized)
          ? normalized.join(', ')
          : key === 'product_specifications' && normalized && typeof normalized === 'object'
            ? JSON.parse(JSON.stringify(normalized))
            : normalized
      const stateValue =
        key === 'product_specifications' && normalized && typeof normalized === 'object'
          ? JSON.parse(JSON.stringify(normalized))
          : Array.isArray(normalized)
            ? [...normalized]
            : normalized

      productPatchPayload[productPatchKey] = payloadValue
      productPatchState[productPatchKey] = stateValue
      appliedKeys.push(key)
    })

    if (Object.keys(productPatchPayload).length === 0) {
      toast({ title: 'Nothing to accept', description: skippedInvalid ? 'Some suggestions had invalid edits.' : undefined })
      return
    }

    setAcceptAllSuggestionsPending(true)
    try {
      await phase2.saveChanges(resolvedJobIdMemo, { draft: { product: productPatchPayload } })
      setProductForm((prev) => ({ ...prev, ...productPatchState } as DraftProduct))
      setInitialProduct((prev) => ({ ...prev, ...productPatchState } as DraftProduct))
      if (appliedKeys.length > 0) {
        setSuggestionDrafts((prev) => {
          const next = { ...prev }
          appliedKeys.forEach((key) => {
            delete next[key]
          })
          return next
        })
      }
      refetch()
      if (skippedInvalid > 0) {
        toast({ title: `Accepted ${appliedKeys.length} suggestions`, description: `Skipped ${skippedInvalid} due to invalid edits.` })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to apply suggestions'
      toast({ title: 'Accept all failed', description: message, variant: 'destructive' })
    } finally {
      setAcceptAllSuggestionsPending(false)
    }
  }

  const handleDismissSuggestion = (field: EnrichFieldKey) => {
    setDismissedSuggestions((prev) => ({
      ...prev,
      [field]: true,
    }))
    setSuggestionDrafts((prev) => {
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  const handleRestoreSuggestion = (field: EnrichFieldKey) => {
    setDismissedSuggestions((prev) => {
      const next = { ...prev }
      delete next[field]
      return next
    })
    setSuggestionDrafts((prev) => ({
      ...prev,
      [field]: serializeSuggestionForEdit(field, enrichSuggestions[field]),
    }))
  }

  const handleRefresh = () => {
    refetch()
    toast({ title: 'Refreshing job state' })
  }

  const handleSelectJob = useCallback((nextJobId: string | null) => {
    if (!nextJobId) {
      setSearchParams({})
      return
    }
    setSearchParams({ jobId: nextJobId })
  }, [setSearchParams])

  const handleBatchDrawerOpenChange = useCallback((open: boolean) => {
    setBatchDrawerOpen(open)
    if (!open) {
      resetBatch()
      setBatchUrlsInput('')
      setBatchLabel('')
    }
  }, [resetBatch])

  const handleBatchSubmit = useCallback(async () => {
    const urls = batchUrlsInput
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
    if (!urls.length) {
      toast({ title: 'Add at least one URL', variant: 'destructive' })
      return
    }
    await submitBatch({
      urls,
      label: batchLabel.trim() ? batchLabel.trim() : undefined,
    })
  }, [batchLabel, batchUrlsInput, submitBatch, toast])

  const isBatchSubmitting = batchStatus === 'submitting'
  const catalogStatusLabel = catalogJob ? CATALOG_STATUS_LABELS[catalogJob.status] ?? catalogJob.status : null
  const catalogStatusVariant = catalogJob ? CATALOG_STATUS_VARIANTS[catalogJob.status] ?? 'outline' : 'outline'
  const automationStatuses = useMemo(() => {
    const artifacts = (job?.artifacts as Record<string, unknown> | undefined) ?? {}
    const flagsRecord = (job?.flags as Record<string, unknown> | undefined) ?? {}

    const getLastTimestamp = (collection: unknown, field: string): string | null => {
      if (!Array.isArray(collection)) return null
      const latest = collection
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null
          const createdAt = (entry as Record<string, unknown>)[field]
          return typeof createdAt === 'string' ? createdAt : null
        })
        .filter((value): value is string => Boolean(value))
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
      return latest[0] ?? null
    }

    const garmentSummaryReady = Boolean(flagsRecord.garmentSummaryReady)
    const enrichReady = Boolean(flagsRecord.enrichReady)
    const ghostReady = Boolean(flagsRecord.ghostReady)

    const garmentRuns = getLastTimestamp((artifacts as Record<string, unknown>).garmentSummaryRuns, 'createdAt')
    const enrichRuns = getLastTimestamp((artifacts as Record<string, unknown>).enrichRuns, 'createdAt')
    const ghostRuns = getLastTimestamp((artifacts as Record<string, unknown>).ghostImages, 'createdAt')

    return [
      {
        key: 'garment',
        label: 'Garment Summary',
        ready: garmentSummaryReady,
        lastRun: garmentRuns,
        stateLabel: garmentSummaryReady ? 'Ready' : garmentRuns ? 'Running' : 'Not run',
      },
      {
        key: 'enrich',
        label: 'Enrichment',
        ready: enrichReady,
        lastRun: enrichRuns,
        stateLabel: enrichReady ? 'Ready' : enrichRuns ? 'Running' : 'Not run',
      },
      {
        key: 'ghost',
        label: 'Ghost Renders',
        ready: ghostReady,
        lastRun: ghostRuns,
        stateLabel: ghostReady ? 'Ready' : ghostRuns ? (regeneratingView ? 'Regenerating' : 'Running') : 'Not run',
      },
    ]
  }, [job])

  const outstandingIssues = useMemo(() => {
    const list: Array<{ level: 'error' | 'warning'; message: string }> = []
    validations.forEach((validation) => {
      list.push({
        level: validation.severity === 'error' ? 'error' : 'warning',
        message: validation.message,
      })
    })
    stageErrors.forEach((error) => list.push({ level: 'error', message: `Stage: ${error.message}` }))
    promoteErrors.forEach((error) => list.push({ level: 'error', message: `Promote: ${error.message}` }))
    automationStatuses.forEach((item) => {
      if (!item.ready) {
        list.push({
          level: 'warning',
          message: `${item.label} ${item.lastRun ? 'awaiting completion' : 'not run'}`
        })
      }
    })
    const missingProcessed = Object.values(ghostViews).filter((info) => !info.processedUrl)
    missingProcessed.forEach((info) => {
      list.push({
        level: 'warning',
        message: `Processed ghost asset missing for ${info.view} view`
      })
    })
    return list
  }, [automationStatuses, ghostViews, promoteErrors, stageErrors, validations])

  const phase2Checklist = useMemo(() => {
    const missingProcessed = Object.values(ghostViews).filter((info) => !info.processedUrl)
    return [
      { label: 'Product payload saved', done: !productDirty },
      { label: 'Image payload saved', done: !imagesDirty },
      { label: 'Summaries saved', done: !summariesDirty },
      { label: 'Processed ghost uploads present', done: missingProcessed.length === 0 },
    ]
  }, [ghostViews, imagesDirty, productDirty, summariesDirty])

  const handleSaveProduct = async () => {
    const resolvedJobId = resolveJobId(job)
    if (!resolvedJobId) return
    const parsedSizeChart = parseSizeChart(sizeChartText)
    const patchProduct = buildProductPatch(productForm, initialProduct, parsedSizeChart)
    if (Object.keys(patchProduct).length === 0) return
    try {
      await phase1.saveChanges(resolvedJobId, { draft: { product: patchProduct } })
      const nextInitial = {
        ...initialProduct,
        ...patchProduct,
        size_chart: 'size_chart' in patchProduct ? patchProduct.size_chart ?? null : initialProduct.size_chart ?? null,
      }
      setInitialProduct(nextInitial)
      setProductForm((prev) => ({
        ...prev,
        ...patchProduct,
        size_chart: nextInitial.size_chart ?? null,
      }))
      setSizeChartText(stringifySizeChart(nextInitial.size_chart))
    } catch (error) {
      console.error('Phase 1 product save failed', error)
    }
  }

  const handleSaveImages = async () => {
    const resolvedJobId = resolveJobId(job)
    if (!resolvedJobId) return
    try {
      const imagePatches = buildImagePatches(imagesForm, initialImages)
      const artifacts = (job?.artifacts as Record<string, unknown> | undefined) ?? {}
      const rawImages = Array.isArray(artifacts.rawImages) ? (artifacts.rawImages as RawImageRecord[]) : []
      const patchMap = new Map(imagePatches.map((patch) => [patch.url, patch]))
      let rawImagesChanged = false
      const updatedRawImages = rawImages.map((raw) => {
        const resolvedUrl =
          typeof raw.originalUrl === 'string'
            ? raw.originalUrl
            : typeof (raw as { url?: unknown }).url === 'string'
            ? ((raw as { url: string }).url)
            : undefined
        const patch = resolvedUrl ? patchMap.get(resolvedUrl) : undefined
        if (!patch) return raw
        const nextRaw = { ...raw }
        let modified = false
        if ('product_view' in patch) {
          nextRaw.productView = patch.product_view ?? null
          modified = true
        }
        if ('ghost_eligible' in patch) {
          nextRaw.ghostEligible = patch.ghost_eligible
          modified = true
        }
        if ('summary_eligible' in patch) {
          nextRaw.summaryEligible = patch.summary_eligible
          modified = true
        }
        if ('kind' in patch) {
          nextRaw.kind = patch.kind
          modified = true
        }
        if (modified) rawImagesChanged = true
        return nextRaw
      })

      const payload: {
        draft?: { images: DraftImageUpdate[] }
        artifacts?: { rawImages: RawImageRecord[] }
      } = {}

      if (imagePatches.length > 0) {
        payload.draft = { images: imagePatches }
      }
      if (rawImagesChanged) {
        payload.artifacts = { rawImages: updatedRawImages }
      }

      if (!payload.draft && !payload.artifacts) return

      await phase1.saveChanges(resolvedJobId, payload)
      setInitialImages(imagesForm.map((img) => ({ ...img })))
    } catch (error) {
      console.error('Phase 1 image save failed', error)
    }
  }

  const handleSavePhase1All = async () => {
    const resolvedJobId = resolveJobId(job)
    if (!resolvedJobId) return
    const parsedSizeChart = parseSizeChart(sizeChartText)
    const patchProduct = buildProductPatch(productForm, initialProduct, parsedSizeChart)
    const imagePatches = buildImagePatches(imagesForm, initialImages)

    const payload: {
      draft?: { product?: Partial<DraftProduct>; images?: DraftImageUpdate[] }
      artifacts?: { rawImages: RawImageRecord[] }
    } = {}

    if (Object.keys(patchProduct).length > 0) {
      payload.draft = { ...(payload.draft ?? {}), product: patchProduct }
    }

    if (imagePatches.length > 0) {
      payload.draft = { ...(payload.draft ?? {}), images: imagePatches }
      const artifacts = (job?.artifacts as Record<string, unknown> | undefined) ?? {}
      const rawImages = Array.isArray(artifacts.rawImages) ? (artifacts.rawImages as RawImageRecord[]) : []
      const patchMap = new Map(imagePatches.map((patch) => [patch.url, patch]))
      const updatedRawImages = rawImages.map((raw) => {
        const resolvedUrl =
          typeof raw.originalUrl === 'string'
            ? raw.originalUrl
            : typeof (raw as { url?: unknown }).url === 'string'
            ? ((raw as { url: string }).url)
            : undefined
        const patch = resolvedUrl ? patchMap.get(resolvedUrl) : undefined
        if (!patch) return raw
        const nextRaw = { ...raw }
        if ('product_view' in patch) {
          nextRaw.productView = patch.product_view ?? null
        }
        if ('ghost_eligible' in patch) {
          nextRaw.ghostEligible = patch.ghost_eligible
        }
        if ('summary_eligible' in patch) {
          nextRaw.summaryEligible = patch.summary_eligible
        }
        return nextRaw
      })
      payload.artifacts = { rawImages: updatedRawImages }
    }

    if (!payload.draft && !payload.artifacts) {
      toast({ title: 'Nothing to save' })
      return
    }

    try {
      await phase1.saveChanges(resolvedJobId, payload)
      if (patchProduct) {
        const nextInitial = {
          ...initialProduct,
          ...patchProduct,
          size_chart: 'size_chart' in patchProduct ? patchProduct.size_chart ?? null : initialProduct.size_chart ?? null,
        }
        setInitialProduct(nextInitial)
        setProductForm((prev) => ({
          ...prev,
          ...patchProduct,
          size_chart: nextInitial.size_chart ?? null,
        }))
        setSizeChartText(stringifySizeChart(nextInitial.size_chart))
      }
      if (imagePatches) {
        setInitialImages(imagesForm.map((img) => ({ ...img })))
      }
      toast({ title: 'Phase 1 changes saved' })
    } catch (error) {
      console.error('Phase 1 save all failed', error)
      toast({ title: 'Failed to save', variant: 'destructive' })
    }
  }

  const handleSaveImagePayload = useCallback(async () => {
    const resolvedJobId = resolveJobId(job)
    if (!resolvedJobId) return
    const imagePatches = buildImagePatches(imagesForm, initialImages)
    if (imagePatches.length === 0) {
      setInitialImages(imagesForm.map((img) => ({ ...img })))
      toast({ title: 'Image payload unchanged', description: 'Marked as saved' })
      return
    }
    setImagePayloadSaving(true)
    try {
      const artifacts = (job?.artifacts as Record<string, unknown> | undefined) ?? {}
      const rawImages = Array.isArray(artifacts.rawImages) ? (artifacts.rawImages as RawImageRecord[]) : []
      const patchMap = new Map(imagePatches.map((patch) => [patch.url, patch]))
      let rawImagesChanged = false
      const updatedRawImages = rawImages.map((raw) => {
        const resolvedUrl =
          typeof raw.originalUrl === 'string'
            ? raw.originalUrl
            : typeof (raw as { url?: unknown }).url === 'string'
            ? ((raw as { url: string }).url)
            : undefined
        const patch = resolvedUrl ? patchMap.get(resolvedUrl) : undefined
        if (!patch) return raw
        const nextRaw = { ...raw }
        let modified = false
        if ('product_view' in patch) {
          nextRaw.productView = patch.product_view ?? null
          modified = true
        }
        if ('ghost_eligible' in patch) {
          nextRaw.ghostEligible = patch.ghost_eligible
          modified = true
        }
        if ('summary_eligible' in patch) {
          nextRaw.summaryEligible = patch.summary_eligible
          modified = true
        }
        if ('vto_eligible' in patch) {
          nextRaw.vtoEligibleHint = patch.vto_eligible
          modified = true
        }
        if ('kind' in patch) {
          nextRaw.kind = patch.kind
          modified = true
        }
        if (modified) rawImagesChanged = true
        return nextRaw
      })

      const payload: {
        draft?: { images: DraftImageUpdate[] }
        artifacts?: { rawImages: RawImageRecord[] }
      } = {}

      if (imagePatches.length > 0) {
        payload.draft = { images: imagePatches }
      }
      if (rawImagesChanged) {
        payload.artifacts = { rawImages: updatedRawImages }
      }

      if (!payload.draft && !payload.artifacts) {
        setInitialImages(imagesForm.map((img) => ({ ...img })))
        return
      }

      await phase2.saveChanges(resolvedJobId, payload)
      setInitialImages(imagesForm.map((img) => ({ ...img })))
      toast({ title: 'Image payload saved' })
    } catch (error) {
      console.error('Phase 2 image payload save failed', error)
      toast({ title: 'Failed to save image payload', variant: 'destructive' })
    } finally {
      setImagePayloadSaving(false)
    }
  }, [imagesForm, initialImages, job, phase2, toast])

  const handleSaveProductPayload = useCallback(async () => {
    const resolvedJobId = resolveJobId(job)
    if (!resolvedJobId) return
    const parsedSizeChart = parseSizeChart(sizeChartText)
    const patchProduct = buildProductPatch(productForm, initialProduct, parsedSizeChart)
    if (Object.keys(patchProduct).length === 0) {
      toast({ title: 'Product payload unchanged' })
      return
    }
    setProductPayloadSaving(true)
    try {
      await phase2.saveChanges(resolvedJobId, { draft: { product: patchProduct } })
      const nextInitial = {
        ...initialProduct,
        ...patchProduct,
        size_chart: 'size_chart' in patchProduct ? patchProduct.size_chart ?? null : initialProduct.size_chart ?? null,
      }
      setInitialProduct(nextInitial)
      setSizeChartText(stringifySizeChart(nextInitial.size_chart))
      toast({ title: 'Product payload saved' })
    } catch (error) {
      console.error('Phase 2 product payload save failed', error)
      toast({ title: 'Failed to save product payload', variant: 'destructive' })
    } finally {
      setProductPayloadSaving(false)
    }
  }, [job, productForm, initialProduct, phase2, sizeChartText, toast])

  const handleSaveSummaries = async () => {
    const resolvedJobId = resolveJobId(job)
    if (!resolvedJobId) return
    const frontParse = parseJson(summaryFrontText)
    const backParse = parseJson(summaryBackText)
    if (frontParse.error) {
      toast({ title: 'Invalid front summary JSON', description: frontParse.error, variant: 'destructive' })
      return
    }
    if (backParse.error) {
      toast({ title: 'Invalid back summary JSON', description: backParse.error, variant: 'destructive' })
      return
    }

    const patch: Record<string, unknown> = {}
    const frontValue = frontParse.value && typeof frontParse.value === 'object' && !Array.isArray(frontParse.value)
      ? (frontParse.value as Record<string, unknown>)
      : null
    const backValue = backParse.value && typeof backParse.value === 'object' && !Array.isArray(backParse.value)
      ? (backParse.value as Record<string, unknown>)
      : null

    if (summaryFrontText !== initialSummaryFront) {
      patch.garment_summary_front = frontValue
    }
    if (summaryBackText !== initialSummaryBack) {
      patch.garment_summary_back = backValue
    }
    if (summaryVersion !== initialSummaryVersion) {
      patch.garment_summary_version = summaryVersion || null
    }

    if (Object.keys(patch).length === 0) {
      toast({ title: 'No summary changes to save' })
      return
    }

    try {
      await phase2.saveChanges(resolvedJobId, { draft: { product: patch } })
      setInitialSummaryFront(summaryFrontText)
      setInitialSummaryBack(summaryBackText)
      setInitialSummaryVersion(summaryVersion)
      setProductForm((prev) => ({
        ...prev,
        garment_summary_front: (patch.garment_summary_front as Record<string, unknown> | null | undefined) ?? prev.garment_summary_front ?? null,
        garment_summary_back: (patch.garment_summary_back as Record<string, unknown> | null | undefined) ?? prev.garment_summary_back ?? null,
        garment_summary_version:
          typeof patch.garment_summary_version === 'string'
            ? patch.garment_summary_version
            : patch.garment_summary_version === null
            ? null
            : prev.garment_summary_version ?? null
      }))
    } catch (error) {
      console.error('Phase 2 summary save failed', error)
    }
  }

  const submitPhase1Completion = async () => {
    const resolvedJobId = resolveJobId(job)
    if (!resolvedJobId) return
    const vibesValue = Array.isArray(productForm.vibes)
      ? productForm.vibes.join(', ')
      : typeof productForm.vibes === 'string'
        ? productForm.vibes
        : null
    const payloadProduct: DraftProduct = {
      ...productForm,
      size_chart: parseSizeChart(sizeChartText),
      vibes: vibesValue ? vibesValue.split(',').map((entry) => entry.trim()).filter(Boolean) : null,
    }
    try {
      const productForBackend = {
        ...payloadProduct,
        vibes: vibesValue ?? null,
      }
      await phase1.completePhase(resolvedJobId, { draft: { product: productForBackend, images: imagesForm } })
      setInitialProduct(payloadProduct)
      setInitialImages(imagesForm)
      setPhase1CompletePreviewOpen(false)
    } catch (error) {
      console.error('Phase 1 completion failed', error)
    }
  }

  const handleCompletePhase1 = () => {
    const resolvedJobId = resolveJobId(job)
    if (!resolvedJobId) return
    if (hasBlockingErrors) {
      toast({ title: 'Resolve blocking issues before completing Phase 1', variant: 'destructive' })
      return
    }
    setPhase1CompletePreviewOpen(true)
  }

  const renderValidationStrip = () => (
    <div className="flex flex-wrap gap-2">
      {validations.map((validation) => (
        <Badge
          key={validation.code}
          variant={validation.severity === 'error' ? 'destructive' : 'secondary'}
          className="text-xs"
        >
          {validation.message}
        </Badge>
      ))}
      {validations.length === 0 && <Badge variant="outline">All checks passed</Badge>}
    </div>
  )

  const renderHeader = () => (
    <div className="flex flex-col gap-4 border-b pb-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Inventory Review Dashboard</h1>
          <p className="text-sm text-muted-foreground">Monitor and review ingestion jobs with human-in-the-loop controls.</p>
        </div>
        <div className="flex items-center gap-2">
          <Drawer open={batchDrawerOpen} onOpenChange={handleBatchDrawerOpenChange}>
            <DrawerTrigger asChild>
              <Button variant="outline">Submit URLs</Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Submit product URLs</DrawerTitle>
                <DrawerDescription>Paste comma or newline separated PDP links to enqueue ingestion jobs.</DrawerDescription>
              </DrawerHeader>
              <div className="space-y-4 px-4 pb-6">
                <div className="space-y-2">
                  <Label htmlFor="batch-label">Batch label (optional)</Label>
                  <Input
                    id="batch-label"
                    placeholder="Fall drop"
                    value={batchLabel}
                    onChange={(event) => setBatchLabel(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="batch-urls">Product URLs</Label>
                  <Textarea
                    id="batch-urls"
                    rows={6}
                    placeholder="https://brand.com/product/123"
                    value={batchUrlsInput}
                    onChange={(event) => setBatchUrlsInput(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Maximum 200 URLs per batch. Separate entries with commas or line breaks.</p>
                </div>
                {batchStatus === 'error' && batchError && (
                  <Alert variant="destructive">
                    <AlertTitle>Batch submit failed</AlertTitle>
                    <AlertDescription>{batchError}</AlertDescription>
                  </Alert>
                )}
                {batchResult && (
                  <div className="space-y-3 rounded-md border border-dashed p-4 text-sm">
                    <div className="flex flex-wrap gap-4 text-xs">
                      <span>Enqueued: {batchResult.summary.enqueued ?? 0}</span>
                      <span>Duplicates: {batchResult.summary.duplicate ?? 0}</span>
                      <span>Invalid: {batchResult.summary.invalid ?? 0}</span>
                      {batchResult.truncated > 0 && (
                        <span className="text-amber-600">Truncated by {batchResult.truncated}</span>
                      )}
                    </div>
                    <ScrollArea className="max-h-40 pr-2">
                      <div className="space-y-2">
                        {batchResult.items.map((item, index) => (
                          <div key={`${item.url}-${index}`} className="text-xs leading-relaxed">
                            <span
                              className={cn(
                                'font-medium uppercase',
                                item.status === 'enqueued' ? 'text-green-600' : item.status === 'duplicate' ? 'text-blue-600' : 'text-destructive'
                              )}
                            >
                              {item.status}
                            </span>{' '}
                            <span className="break-all text-muted-foreground">{item.url}</span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </div>
              <DrawerFooter>
                <Button onClick={handleBatchSubmit} disabled={isBatchSubmitting}>
                  {isBatchSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting…
                    </>
                  ) : (
                    'Submit URLs'
                  )}
                </Button>
                <DrawerClose asChild>
                  <Button variant="outline">Close</Button>
                </DrawerClose>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>
          <Button variant="outline" onClick={handleRefresh} disabled={!jobIdParam}>
            <RefreshCcw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>
      {jobIdParam ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge className="capitalize" variant={catalogStatusLabel ? catalogStatusVariant : 'default'}>
            {(catalogStatusLabel ?? status.replace(/_/g, ' '))}
          </Badge>
          {(() => {
            const pauseReason = readStringField(pause ?? undefined, 'reason')
            if (!pauseReason) return null
            return <Badge variant="outline">Paused: {pauseReason}</Badge>
          })()}
          {flags?.hitlPhase1Completed && <Badge variant="outline">Phase 1 completed</Badge>}
        </div>
      ) : (
        <Badge variant="outline" className="w-fit">No job selected</Badge>
      )}
      {catalogLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading job metadata…</span>
        </div>
      )}
      {catalogError && !catalogLoading && (
        <Alert variant="destructive">
          <AlertTitle>Unable to load job metadata</AlertTitle>
          <AlertDescription>{catalogError}</AlertDescription>
        </Alert>
      )}
      {catalogJob && !catalogLoading && (
        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Job ID:{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-foreground">
                {catalogJob.job_id}
              </code>
            </span>
            <span>Created {formatTimestamp(catalogJob.created_at)}</span>
            {catalogJob.started_at && <span>Started {formatTimestamp(catalogJob.started_at)}</span>}
            {catalogJob.updated_at && <span>Updated {formatTimestamp(catalogJob.updated_at)}</span>}
          </div>
          {catalogJob.last_error && (
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-3.5 w-3.5" />
              <span className="truncate">
                Last error: {catalogJob.last_error}
              </span>
            </div>
          )}
        </div>
      )}
      {jobIdParam && renderValidationStrip()}
    </div>
  )

  const liveProcessedFront = useMemo(
    () => resolveProcessedPath(processedGhostMap, 'front') ?? null,
    [processedGhostMap],
  )
  const frontProcessedUrl = useMemo(() => getPublicUrl(liveProcessedFront ?? undefined), [liveProcessedFront])

  const resolvedPrimaryImageUrl = useMemo(
    () => frontProcessedUrl ?? primaryPublicImageUrl ?? processedPreviewUrl ?? fallbackPreviewUrl ?? productForm.image_url ?? null,
    [frontProcessedUrl, primaryPublicImageUrl, processedPreviewUrl, fallbackPreviewUrl, productForm.image_url]
  )

  useEffect(() => {
    if (!resolvedPrimaryImageUrl) return
    setProductForm((prev) => {
      if (prev.image_url === resolvedPrimaryImageUrl) return prev
      return {
        ...prev,
        image_url: resolvedPrimaryImageUrl,
      }
    })
  }, [resolvedPrimaryImageUrl])

  const productFields = (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg">Product Details</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            onClick={handleSavePhase1All}
            disabled={phase1.status === 'saving' || (!productDirty && !imagesDirty)}
          >
            {phase1.status === 'saving' ? 'Saving…' : 'Save All'}
          </Button>
          <Button
            variant="outline"
            onClick={handleSaveProduct}
            disabled={!productDirty || phase1.status === 'saving'}
          >
            {phase1.status === 'saving' ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Type">
            <Select
              value={productForm.type ?? ''}
              onValueChange={(value) =>
                setProductForm((prev) => ({
                  ...prev,
                  type: value ? (value as ItemType) : null,
                }))
              }
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Category (Ghost)">
            <Select
              value={productForm.category_ghost ?? ''}
              onValueChange={(value) =>
                setProductForm((prev) => ({
                  ...prev,
                  category_ghost: value || null,
                }))
              }
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_GHOST_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Brand">
            <Input
              value={productForm.brand ?? ''}
              onChange={(event) => setProductForm((prev) => ({ ...prev, brand: event.target.value }))}
            />
          </Field>
          <Field label="Product Name">
            <Input
              value={productForm.product_name ?? ''}
              onChange={(event) => setProductForm((prev) => ({ ...prev, product_name: event.target.value }))}
            />
          </Field>
          <Field label="Price (minor units)">
            <Input
              type="number"
              value={productForm.price_minor ?? ''}
              onChange={(event) =>
                setProductForm((prev) => {
                  const nextValue = event.target.value ? Number(event.target.value) : null
                  return { ...prev, price_minor: nextValue, price: nextValue }
                })
              }
            />
          </Field>
          <Field label="Currency">
            <Input
              value={productForm.currency ?? ''}
              onChange={(event) => setProductForm((prev) => ({ ...prev, currency: event.target.value }))}
            />
          </Field>
          <Field label="Fit">
            <Input
              value={productForm.fit ?? ''}
              onChange={(event) => setProductForm((prev) => ({ ...prev, fit: event.target.value }))}
            />
          </Field>
          <Field label="Feel">
            <Input
              value={productForm.feel ?? ''}
              onChange={(event) => setProductForm((prev) => ({ ...prev, feel: event.target.value }))}
            />
          </Field>
          <Field label="Material">
            <Input
              value={productForm.material ?? ''}
              onChange={(event) => setProductForm((prev) => ({ ...prev, material: event.target.value }))}
            />
          </Field>
        <Field label="Gender">
          <Select
            value={productForm.gender ?? undefined}
            onValueChange={(value) =>
              setProductForm((prev) => ({
                ...prev,
                gender: value as DraftProduct['gender'],
              }))
            }
          >
            <SelectTrigger className="h-8">
              <SelectValue placeholder="Select gender" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="male">Male</SelectItem>
              <SelectItem value="female">Female</SelectItem>
              <SelectItem value="unisex">Unisex</SelectItem>
            </SelectContent>
          </Select>
        </Field>
          <Field label="Category">
            <Select
              value={productForm.category_id ?? ''}
              onValueChange={(value) =>
                setProductForm((prev) => ({
                  ...prev,
                  category_id: value || null,
                }))
              }
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder={loadingCategories ? 'Loading categories…' : 'Select category'} />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Primary Image URL (Live)">
            <Input value={resolvedPrimaryImageUrl ?? ''} disabled />
          </Field>
        </div>
        <Field label="Description">
          <Textarea
            rows={4}
            value={productForm.description ?? ''}
            onChange={(event) => setProductForm((prev) => ({ ...prev, description: event.target.value }))}
          />
        </Field>
        <Field label="Care Instructions">
          <Textarea
            rows={3}
            value={productForm.care ?? ''}
            onChange={(event) => setProductForm((prev) => ({ ...prev, care: event.target.value }))}
          />
        </Field>
        <Field label="Size Chart (JSON)">
          <Textarea
            rows={5}
            value={sizeChartText}
            onChange={(event) => {
              setSizeChartText(event.target.value)
              setProductForm((prev) => ({ ...prev, size_chart: parseSizeChart(event.target.value) }))
            }}
          />
        </Field>
      </CardContent>
    </Card>
  )

  const imageGrid = (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg">Image Tagging</CardTitle>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Images: {imagesForm.length}</span>
          <input
            ref={phase1UploadRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhase1FileChange}
          />
          <Button
            variant="outline"
            onClick={triggerPhase1UploadDialog}
            disabled={!resolvedJobIdMemo || phase1.status === 'saving' || phase1Uploading}
            size="sm"
            title="Upload an additional image to tag"
          >
            <UploadCloud className="mr-2 h-4 w-4" />
            {phase1Uploading ? 'Uploading…' : 'Upload image'}
          </Button>
          <Button
            variant="outline"
            onClick={handleSaveImages}
            disabled={!imagesDirty || phase1.status === 'saving'}
            size="sm"
          >
            {phase1.status === 'saving' ? 'Saving…' : 'Save Image Tags'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <AlertDialog
          open={Boolean(phase1DeleteTarget)}
          onOpenChange={(open) => {
            if (!open) setPhase1DeleteTarget(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this image?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the image from the job state and deletes the file from storage.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {phase1DeleteTarget && (
              <div className="space-y-2">
                <div className="relative aspect-square overflow-hidden rounded-md border bg-muted">
                  <img
                    src={getImageSrc(phase1DeleteTarget)}
                    alt="Delete preview"
                    className="h-full w-full object-contain"
                  />
                </div>
                <p className="break-all text-xs text-muted-foreground">{phase1DeleteTarget.url}</p>
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={phase1Deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault()
                  void handlePhase1DeleteConfirm()
                }}
                disabled={!resolvedJobIdMemo || !phase1DeleteTarget || phase1Deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {phase1Deleting ? 'Deleting…' : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Dialog
          open={Boolean(phase1ImagePreviewTarget)}
          onOpenChange={(open) => {
            if (!open) setPhase1ImagePreviewTarget(null)
          }}
        >
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Image preview</DialogTitle>
              <DialogDescription>Review the full image before tagging.</DialogDescription>
            </DialogHeader>
            {phase1ImagePreviewTarget && (
              <div className="space-y-3">
                <div className="relative max-h-[70vh] overflow-hidden rounded-md border bg-muted">
                  <img
                    src={getImageSrc(phase1ImagePreviewTarget.image)}
                    alt={`Preview image ${phase1ImagePreviewTarget.index + 1}`}
                    className="h-full w-full object-contain"
                  />
                </div>
                <p className="break-all text-xs text-muted-foreground">{phase1ImagePreviewTarget.image.url}</p>
              </div>
            )}
          </DialogContent>
        </Dialog>
        <ScrollArea className="h-[520px] pr-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {imagesForm.map((image, index) => (
              <div key={image.url} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">Image {index + 1}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={image.is_primary ? 'default' : 'outline'}>
                      {image.is_primary ? 'Primary' : 'Secondary'}
                    </Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={!resolvedJobIdMemo || phase1.status === 'saving' || phase1Uploading || phase1Deleting}
                      onClick={() => setPhase1DeleteTarget(image)}
                      title="Delete image"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="relative aspect-square overflow-hidden rounded-md border bg-muted">
                  <button
                    type="button"
                    className="h-full w-full"
                    onClick={() => setPhase1ImagePreviewTarget({ image, index })}
                    title="Click to enlarge"
                  >
                    <img
                      src={getImageSrc(image)}
                      alt={`Draft image ${index + 1}`}
                      className="h-full w-full object-contain"
                    />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <Field label="Kind">
                    <Select
                      value={image.kind ?? 'none'}
                      onValueChange={(value) =>
                        setImagesForm((prev) =>
                          prev.map((img) =>
                            img.url === image.url
                              ? { ...img, kind: value === 'none' ? null : value }
                              : img
                          )
                        )
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select kind" />
                      </SelectTrigger>
                      <SelectContent>
                        {imageKindOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                        <SelectItem value="none">Unassigned</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="View">
                    <Select
                      value={image.product_view ?? 'none'}
                      onValueChange={(value) =>
                        setImagesForm((prev) =>
                          prev.map((img) =>
                            img.url === image.url
                              ? {
                                  ...img,
                                  product_view: value === 'none' ? null : (value as NonNullable<DraftImage['product_view']>),
                                }
                              : img
                          )
                        )
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select view" />
                      </SelectTrigger>
                      <SelectContent>
                        {viewOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                        <SelectItem value="none">Unassigned</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Primary">
                    <Switch
                      checked={image.is_primary}
                      onCheckedChange={(checked) =>
                        setImagesForm((prev) =>
                          prev.map((img) =>
                            img.url === image.url
                              ? { ...img, is_primary: checked }
                              : checked
                                ? { ...img, is_primary: false }
                                : img
                          )
                        )
                      }
                    />
                  </Field>
                  <Field label="Ghost Eligible">
                    <Switch
                      checked={image.ghost_eligible}
                      onCheckedChange={(checked) =>
                        setImagesForm((prev) =>
                          prev.map((img) =>
                            img.url === image.url ? { ...img, ghost_eligible: checked } : img
                          )
                        )
                      }
                    />
                  </Field>
                  <Field label="Summary Eligible">
                    <Switch
                      checked={image.summary_eligible}
                      onCheckedChange={(checked) =>
                        setImagesForm((prev) =>
                          prev.map((img) =>
                            img.url === image.url ? { ...img, summary_eligible: checked } : img
                          )
                        )
                      }
                    />
                  </Field>
                  <Field label="VTO Eligible">
                    <Switch
                      checked={image.vto_eligible}
                      onCheckedChange={(checked) =>
                        setImagesForm((prev) =>
                          prev.map((img) =>
                            img.url === image.url ? { ...img, vto_eligible: checked } : img
                          )
                        )
                      }
                    />
                  </Field>
                </div>
              </div>
            ))}
            {imagesForm.length === 0 && <p className="text-sm text-muted-foreground">No draft images extracted for this job.</p>}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )

  type ProductFieldRow = {
    id: string
    label: string
    helpText?: string
    column: string
    isRequired?: boolean
    isValid: boolean
    statusLabel: string
    render: () => ReactNode
    renderEditable?: () => ReactNode
  }

  const { rows: productFieldRows, missingColumns: productMissingColumns } = useMemo(() => {
    const product = productForm
    const rows: ProductFieldRow[] = []
    const missing = new Set<string>()
    const placeholder = () => <span className="text-muted-foreground">—</span>
    const renderText = (value: string | null | undefined) => () => {
      if (typeof value === 'string' && value.trim().length > 0) return value.trim()
      return placeholder()
    }
    const renderInput = (value: string | number | null | undefined, onChange: (next: string) => void) => () => (
      <Input
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 text-xs"
      />
    )
    const renderTextarea = (value: string | null | undefined, onChange: (next: string) => void, rowsCount = 3) => () => (
      <Textarea
        rows={rowsCount}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className="text-xs"
      />
    )

    const renderEditableByKey: Partial<Record<keyof DraftProduct, () => React.ReactNode>> = {
      category_ghost: () => (
        <Select
          value={productForm.category_ghost ?? ''}
          onValueChange={(value) =>
            setProductForm((prev) => ({
              ...prev,
              category_ghost: value || null,
            }))
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORY_GHOST_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
      brand: renderInput(productForm.brand ?? '', (next) => setProductForm((prev) => ({ ...prev, brand: next }))),
      product_name: renderInput(productForm.product_name ?? '', (next) => setProductForm((prev) => ({ ...prev, product_name: next }))),
      currency: renderInput(productForm.currency ?? '', (next) => setProductForm((prev) => ({ ...prev, currency: next }))),
      fit: renderInput(productForm.fit ?? '', (next) => setProductForm((prev) => ({ ...prev, fit: next }))),
      feel: renderInput(productForm.feel ?? '', (next) => setProductForm((prev) => ({ ...prev, feel: next }))),
      material: renderInput(productForm.material ?? '', (next) => setProductForm((prev) => ({ ...prev, material: next }))),
      gender: () => (
        <Select
          value={productForm.gender ?? undefined}
          onValueChange={(value) =>
            setProductForm((prev) => ({
              ...prev,
              gender: value as DraftProduct['gender'],
            }))
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select gender" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="male">Male</SelectItem>
            <SelectItem value="female">Female</SelectItem>
            <SelectItem value="unisex">Unisex</SelectItem>
          </SelectContent>
        </Select>
      ),
      category_id: () => (
        <Select
          value={productForm.category_id ?? ''}
          onValueChange={(value) =>
            setProductForm((prev) => ({
              ...prev,
              category_id: value || null,
            }))
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder={loadingCategories ? 'Loading categories…' : 'Select category'} />
          </SelectTrigger>
          <SelectContent>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
      description: renderTextarea(productForm.description ?? '', (next) => setProductForm((prev) => ({ ...prev, description: next })), 4),
      care: renderTextarea(productForm.care ?? '', (next) => setProductForm((prev) => ({ ...prev, care: next })), 3),
    }

    const addMissing = (column: string) => {
      missing.add(column)
    }

    const pushRow = (config: {
      id: string
      label: string
      column?: string
      helpText?: string
      isRequired?: boolean
      hasValue: boolean
      render: () => React.ReactNode
      renderEditable?: () => React.ReactNode
    }) => {
      const { id, label, column, helpText, isRequired, hasValue, render, renderEditable } = config
      if (!column) {
        addMissing(`products.${id}`)
        return
      }
      rows.push({
        id,
        label,
        helpText,
        column,
        isRequired,
        isValid: isRequired ? hasValue : true,
        statusLabel: hasValue ? (isRequired ? 'Ready' : 'Provided') : isRequired ? 'Required' : 'Optional',
        render,
        renderEditable,
      })
    }

    pushRow({
      id: 'id',
      label: 'Product ID',
      column: 'products.id',
      isRequired: true,
      hasValue: typeof product.id === 'string' && product.id.trim().length > 0,
      render: renderText(typeof product.id === 'string' ? product.id : ''),
    })

    pushRow({
      id: 'type',
      label: 'Type',
      column: 'products.type',
      helpText: 'Enum: top, bottom, shoes, accessory, occasion',
      isRequired: true,
      hasValue: typeof product.type === 'string' && product.type.trim().length > 0,
      render: renderText(typeof product.type === 'string' ? product.type : ''),
      renderEditable: () => (
        <Select
          value={productForm.type ?? ''}
          onValueChange={(value) =>
            setProductForm((prev) => ({
              ...prev,
              type: value ? (value as ItemType) : null,
            }))
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    })

    const stringFields: Array<{ key: keyof DraftProduct; label: string; column?: string; required?: boolean; helpText?: string }> = [
      { key: 'category_ghost', label: 'Category (Ghost)', column: 'products.category_ghost', required: true, helpText: 'topwear/bottomwear/dresses/footwear' },
      { key: 'brand', label: 'Brand', column: 'products.brand', required: true, helpText: 'Brand shown on PDP' },
      { key: 'product_name', label: 'Product Name', column: 'products.product_name', helpText: 'Optional merchandising override' },
      { key: 'size', label: 'Size', column: 'products.size', required: true },
      { key: 'currency', label: 'Currency', column: 'products.currency', required: true, helpText: 'ISO-3 currency code' },
      { key: 'product_url', label: 'Product URL', column: 'products.product_url', helpText: 'Canonical PDP link' },
      { key: 'image_url', label: 'Primary Image URL', column: 'products.image_url', required: true },
      { key: 'description', label: 'Description', column: 'products.description', required: true, helpText: 'Long form copy stored in DB' },
      { key: 'description_text', label: 'Description (Short Copy)', column: 'products.description_text', helpText: 'Enriched short copy' },
      { key: 'color', label: 'Color', column: 'products.color', required: true },
      { key: 'color_group', label: 'Color Group', column: 'products.color_group' },
      { key: 'occasion', label: 'Occasion', column: 'products.occasion', helpText: 'Merchandising occasion tag (e.g., workwear)' },
      { key: 'gender', label: 'Gender', column: 'products.gender', helpText: 'Target gender (male/female/unisex)' },
      { key: 'category_id', label: 'Category ID', column: 'products.category_id', helpText: 'FK → categories.id' },
      { key: 'type_category', label: 'Type Category', column: 'products.type_category' },
      { key: 'fit', label: 'Fit', column: 'products.fit' },
      { key: 'feel', label: 'Feel', column: 'products.feel' },
      { key: 'material_type', label: 'Material Type', column: 'products.material_type', helpText: 'Merchandising material type (e.g., cotton)' },
    ]

    pushRow({
      id: 'body_parts_visible',
      label: 'Body parts visible',
      column: 'products.body_parts_visible',
      helpText: 'Segments to keep when rendering on mannequin',
      isRequired: true,
      hasValue: Array.isArray(product.body_parts_visible) && product.body_parts_visible.length > 0,
      render: () =>
        Array.isArray(product.body_parts_visible) && product.body_parts_visible.length > 0
          ? product.body_parts_visible.join(', ')
          : placeholder(),
    })

    stringFields.forEach(({ key, label, column, required, helpText }) => {
      const raw = product[key]
      const value = typeof raw === 'string' ? raw : ''
      pushRow({
        id: String(key),
        label,
        column,
        helpText,
        isRequired: required,
        hasValue: value.trim().length > 0,
        render: renderText(value),
        renderEditable: renderEditableByKey[key],
      })
    })

    const priceMinor = typeof product.price_minor === 'number'
      ? Math.round(product.price_minor)
      : typeof product.price === 'number'
        ? Math.round(product.price)
        : null
    const priceMajor = priceMinor !== null ? priceMinor : null
    pushRow({
      id: 'price',
      label: 'Price (minor units)',
      column: 'products.price',
      isRequired: true,
      hasValue: priceMinor !== null,
      render: () => {
        if (priceMinor === null) return placeholder()
        return (
          <div className="space-y-1 text-sm">
            <div className="font-medium">₹{(priceMajor ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className="text-xs text-muted-foreground">{priceMinor} (stored as integer)</div>
          </div>
        )
      },
      renderEditable: () => (
        <Input
          type="number"
          value={productForm.price_minor ?? ''}
          onChange={(event) =>
            setProductForm((prev) => {
              const nextValue = event.target.value ? Number(event.target.value) : null
              return { ...prev, price_minor: nextValue, price: nextValue }
            })
          }
          className="h-8 text-xs"
        />
      ),
    })

    const vibesText = typeof product.vibes_raw === 'string' ? product.vibes_raw : Array.isArray(product.vibes) ? product.vibes.join(', ') : ''
    pushRow({
      id: 'vibes',
      label: 'Vibes',
      column: 'products.vibes',
      helpText: 'Stored as comma-separated string',
      hasValue: vibesText.trim().length > 0,
      render: renderText(vibesText),
    })

    const placementX = typeof product.placement_x === 'number' ? product.placement_x : null
    const placementY = typeof product.placement_y === 'number' ? product.placement_y : null
    pushRow({
      id: 'placement_x',
      label: 'Placement X',
      column: 'products.placement_x',
      helpText: 'Horizontal mannequin offset (-100 to 100)',
      hasValue: placementX !== null,
      render: () => (placementX === null ? placeholder() : <span>{placementX}</span>),
    })
    pushRow({
      id: 'placement_y',
      label: 'Placement Y',
      column: 'products.placement_y',
      helpText: 'Vertical mannequin offset (-100 to 100)',
      hasValue: placementY !== null,
      render: () => (placementY === null ? placeholder() : <span>{placementY}</span>),
    })

    const imageLength = typeof product.image_length === 'number' ? product.image_length : null
    const productLength = typeof product.product_length === 'number' ? product.product_length : null
    pushRow({
      id: 'image_length',
      label: 'Image Length (cm)',
      column: 'products.image_length',
      hasValue: imageLength !== null,
      render: () => (imageLength === null ? placeholder() : <span>{imageLength}</span>),
    })
    pushRow({
      id: 'product_length',
      label: 'Garment Length (cm)',
      column: 'products.product_length',
      hasValue: productLength !== null,
      render: () => (productLength === null ? placeholder() : <span>{productLength}</span>),
    })

    const sizeChartJson = formatJson(product.size_chart)
    pushRow({
      id: 'size_chart',
      label: 'Size Chart',
      column: 'products.size_chart',
      helpText: 'JSONB structure',
      hasValue: Boolean(sizeChartJson),
      render: () => (sizeChartJson ? <pre className="whitespace-pre-wrap text-xs font-mono">{sizeChartJson}</pre> : placeholder()),
      renderEditable: () => (
        <Textarea
          rows={4}
          value={sizeChartText}
          onChange={(event) => {
            setSizeChartText(event.target.value)
            setProductForm((prev) => ({ ...prev, size_chart: parseSizeChart(event.target.value) }))
          }}
          className="text-xs"
        />
      ),
    })

    const garmentSummaryJson = formatJson(product.garment_summary)
    pushRow({
      id: 'garment_summary',
      label: 'Garment Summary (Combined)',
      column: 'products.garment_summary',
      hasValue: Boolean(garmentSummaryJson),
      render: () => (garmentSummaryJson ? <pre className="whitespace-pre-wrap text-xs font-mono">{garmentSummaryJson}</pre> : placeholder()),
    })

    const summaryFrontJson = formatJson(product.garment_summary_front)
    pushRow({
      id: 'garment_summary_front',
      label: 'Garment Summary · Front',
      column: 'products.garment_summary_front',
      hasValue: Boolean(summaryFrontJson),
      render: () => (summaryFrontJson ? <pre className="whitespace-pre-wrap text-xs font-mono">{summaryFrontJson}</pre> : placeholder()),
    })

    const summaryBackJson = formatJson(product.garment_summary_back)
    pushRow({
      id: 'garment_summary_back',
      label: 'Garment Summary · Back',
      column: 'products.garment_summary_back',
      hasValue: Boolean(summaryBackJson),
      render: () => (summaryBackJson ? <pre className="whitespace-pre-wrap text-xs font-mono">{summaryBackJson}</pre> : placeholder()),
    })

    const summaryVersionValue = typeof product.garment_summary_version === 'string' ? product.garment_summary_version : ''
    pushRow({
      id: 'garment_summary_version',
      label: 'Garment Summary Version',
      column: 'products.garment_summary_version',
      hasValue: summaryVersionValue.trim().length > 0,
      render: renderText(summaryVersionValue),
    })

    const similarItems = typeof product.similar_items === 'string' ? product.similar_items : ''
    pushRow({
      id: 'similar_items',
      label: 'Similar Items',
      column: 'products.similar_items',
      helpText: 'Comma-separated product IDs',
      hasValue: similarItems.trim().length > 0,
      render: renderText(similarItems),
    })

    pushRow({
      id: 'vector_embedding',
      label: 'Vector Embedding',
      column: 'products.vector_embedding',
      helpText: '1536-dim pgvector for semantic search',
      hasValue: Array.isArray(product.vector_embedding) ? product.vector_embedding.length > 0 : Boolean(product.vector_embedding),
      render: () =>
        Array.isArray(product.vector_embedding) && product.vector_embedding.length > 0
          ? <span>{product.vector_embedding.length} dimensions</span>
          : product.vector_embedding
            ? <span>Stored</span>
            : placeholder(),
    })

    if (job) {
      const jobId = resolveJobId(job)
      rows.push({
        id: 'job_id',
        label: 'Job Reference',
        column: 'pipeline.job_id',
        helpText: 'Internal ingestion job identifier',
        isValid: Boolean(jobId),
        statusLabel: jobId ? 'Reference linked' : 'Missing',
        render: () => (jobId ? <code className="text-xs font-mono">{jobId}</code> : placeholder()),
      })
    }

    return { rows, missingColumns: Array.from(missing).sort() }
  }, [job, productForm, categories, loadingCategories, sizeChartText])

type ImageFieldRow = {
  id: string
  label: string
  url?: string | null
  thumbnailUrl?: string | null
  productId?: string | null
  isPrimary: boolean
  product_view: DraftImage['product_view']
  ghost_eligible: boolean
  summary_eligible: boolean
  vto_eligible: boolean
  kind?: string | null
  sort_order?: number | null
  gender?: string | null
  publicUrl?: string | null
  storage_path?: string | null
  processed_path?: string | null
  placement_x?: number | null
  placement_y?: number | null
  resolvedKind: string
  kindSource: 'explicit' | 'fallback'
  resolvedGender: string | null
  genderSource: 'image' | 'product' | 'none'
  columns: Record<string, unknown>
  isValid: boolean
  statusLabel: string
  missingColumns: string[]
}


  const phase1Section = (
    <div className="grid grid-cols-1 lg:grid-cols-[2fr,3fr] gap-4">
      <div className="space-y-4">
        {productFields}
      </div>
      <div className="space-y-4">
        {imageGrid}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Tagging Guidelines</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Use these rules before completing Phase 1.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="mt-0.5 text-[11px]">Category</Badge>
              <span>Select item category (topwear/bottomwear/dresses/footwear).</span>
            </div>
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="mt-0.5 text-[11px]">Summary</Badge>
              <span>Tag ≥1 front flatlay <strong>or</strong> front model as summary_eligible=true; add back if available.</span>
            </div>
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="mt-0.5 text-[11px]">Ghost</Badge>
              <span>Tag ≥1 front model as ghost_eligible=true; back if available. Set product_view front/back.</span>
            </div>
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="mt-0.5 text-[11px]">Kind</Badge>
              <span>Set kind for every image (flatlay/model/detail) and pick exactly one primary.</span>
            </div>
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="mt-0.5 text-[11px]">Required</Badge>
              <span>Ensure price, product_url, and primary image are present. Mark VTO on at least one image if policy requires.</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Phase 1 Checklist</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">Must-haves before completing Phase 1.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {validations.map((item, idx) => (
              <div key={`${item.code}-${idx}`} className="flex items-center gap-2">
                <Badge variant={item.severity === 'error' ? 'destructive' : 'outline'} className="text-[11px]">
                  {item.severity === 'error' ? 'Required' : 'Warning'}
                </Badge>
                <span>{item.message}</span>
              </div>
            ))}
            {validations.length === 0 && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Badge variant="outline" className="text-[11px]">Ready</Badge>
                <span>All required fields satisfied.</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )

  const footer = (
    <>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-t pt-4 mt-6">
        <div className="text-sm text-muted-foreground">
          Complete Phase 1 once product details and image tags are finalised.
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={stopPolling}>Pause Auto-refresh</Button>
          <Button variant="outline" onClick={startPolling}>Resume Auto-refresh</Button>
          <Button
            onClick={handleCompletePhase1}
            disabled={phase1.status === 'saving' || hasBlockingErrors}
          >
            {phase1.status === 'saving' ? 'Submitting…' : 'Complete Phase 1'}
          </Button>
        </div>
      </div>
      <Dialog
        open={phase1CompletePreviewOpen}
        onOpenChange={(open) => {
          if (phase1.status === 'saving') return
          setPhase1CompletePreviewOpen(open)
        }}
      >
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Are you sure the tagging is right?</DialogTitle>
            <DialogDescription>
              Review the product fields and image taggings before completing Phase 1.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] pr-4">
            <div className="space-y-6">
              <div className="space-y-3">
                <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Product fields</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[28%]">Field</TableHead>
                      <TableHead>Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {productFieldRows.map((row) => (
                      <TableRow key={row.id} className={row.isRequired && !row.isValid ? 'bg-destructive/5' : undefined}>
                        <TableCell className="font-medium text-sm">{row.label}</TableCell>
                        <TableCell className="whitespace-pre-wrap text-sm">{row.render()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="space-y-3">
                <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Image taggings</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {imagesForm.map((image, index) => (
                    <div key={`phase1-preview-${image.url}-${index}`} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">Image {index + 1}</span>
                        {image.is_primary && <Badge variant="default">Primary</Badge>}
                      </div>
                      <div className="relative aspect-square overflow-hidden rounded-md border bg-muted">
                        <img src={getImageSrc(image)} alt={`Preview image ${index + 1}`} className="h-full w-full object-contain" />
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>Kind: {image.kind ?? '—'}</div>
                        <div>View: {image.product_view ?? '—'}</div>
                        <div>Ghost: {image.ghost_eligible ? 'Yes' : 'No'}</div>
                        <div>Summary: {image.summary_eligible ? 'Yes' : 'No'}</div>
                        <div>VTO: {image.vto_eligible ? 'Yes' : 'No'}</div>
                        <div>Sort: {typeof image.sort_order === 'number' ? image.sort_order : '—'}</div>
                      </div>
                      <p className="break-all text-[11px] text-muted-foreground">{image.url}</p>
                    </div>
                  ))}
                  {imagesForm.length === 0 && (
                    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      No images available to review.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPhase1CompletePreviewOpen(false)}
              disabled={phase1.status === 'saving'}
            >
              No, Stay on Phase 1
            </Button>
            <Button
              onClick={() => void submitPhase1Completion()}
              disabled={phase1.status === 'saving'}
            >
              {phase1.status === 'saving' ? 'Submitting…' : 'Yes, Proceed ahead'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )

  let mainContent: React.ReactNode
  if (!jobIdParam) {
    mainContent = (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>No job selected</AlertTitle>
        <AlertDescription>Select a job from the queue to review ingestion progress.</AlertDescription>
      </Alert>
    )
  } else if (loading && !job) {
    mainContent = <Skeleton className="h-[400px] w-full" />
  } else if (!job) {
    mainContent = (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Job not found</AlertTitle>
        <AlertDescription>Ensure the job ID is correct and try again.</AlertDescription>
      </Alert>
    )
  } else {
    const timeline = [
      { label: 'Queued', value: catalogJob?.queued_at },
      { label: 'Started', value: catalogJob?.started_at },
      { label: 'Phase 1 Completed', value: catalogJob?.phase1_completed_at },
      { label: 'Phase 2 Completed', value: catalogJob?.phase2_completed_at },
      { label: 'Stage Completed', value: catalogJob?.stage_at },
      { label: 'Promote Completed', value: catalogJob?.promote_at },
      { label: 'Completed', value: catalogJob?.completed_at },
    ].filter((entry) => Boolean(entry.value)) as Array<{ label: string; value: string }>;

    const phaseFlagBadges = catalogJob && catalogJob.phase_flags && typeof catalogJob.phase_flags === 'object'
      ? Object.entries(catalogJob.phase_flags)
          .filter(([, value]) => Boolean(value))
          .map(([key]) => key.replace(/_/g, ' '))
      : [];

    mainContent = (
      <div className="space-y-6">
        {catalogLoading && (
          <Skeleton className="h-32 w-full" />
        )}
        {catalogError && !catalogLoading && (
          <Alert variant="destructive">
            <AlertTitle>Unable to load job metadata</AlertTitle>
            <AlertDescription>{catalogError}</AlertDescription>
          </Alert>
        )}
        {catalogJob && !catalogLoading && !catalogError && (
          <Card>
            <CardHeader className="py-[3px]">
              <CardTitle className="text-xl">Job overview</CardTitle>
              <div className="text-[10px] text-muted-foreground">
                <p>Captured metadata from the ingestion catalog.</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge variant={catalogStatusVariant} className="capitalize text-[10px]">
                    {catalogStatusLabel}
                  </Badge>
                  {catalogJob.pause_reason && (
                    <Badge variant="outline">Paused: {catalogJob.pause_reason}</Badge>
                  )}
                  {catalogJob.batch_id && <Badge variant="outline">Batch</Badge>}
                  {catalogJob.error_count > 0 && (
                    <Badge variant="destructive">Errors: {catalogJob.error_count}</Badge>
                  )}
                  {phaseFlagBadges.map((flag) => (
                    <Badge key={flag} variant="outline" className="capitalize">
                      {flag}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pb-[2px]">
              <div className="grid gap-1.5 text-sm sm:grid-cols-2">
                <div className="space-y-1">
                  <p className="font-medium">Created</p>
                  <p className="text-muted-foreground">{formatTimestamp(catalogJob.created_at)}</p>
                </div>
                <div className="space-y-1">
                  <p className="font-medium">Started</p>
                  <p className="text-muted-foreground">{formatTimestamp(catalogJob.started_at ?? undefined)}</p>
                </div>
                <div className="space-y-1">
                  <p className="font-medium">Queued</p>
                  <p className="text-muted-foreground">{formatTimestamp(catalogJob.queued_at ?? undefined)}</p>
                </div>
                <div className="space-y-1">
                  <p className="font-medium">Completed</p>
                  <p className="text-muted-foreground">{formatTimestamp(catalogJob.completed_at ?? undefined)}</p>
                </div>
              </div>
              {timeline.length > 0 && (
                <div className="rounded-md border px-3 py-[2px]">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Milestones</p>
                  <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                    {timeline.map((entry) => (
                      <div key={entry.label} className="flex items-center justify-between gap-2">
                        <span>{entry.label}</span>
                        <span className="text-muted-foreground">{formatTimestamp(entry.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {catalogJob.last_error && (
                <Alert variant="destructive">
                  <AlertTitle>Last error</AlertTitle>
                  <AlertDescription>{catalogJob.last_error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        )}
        {job && (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Outstanding items</CardTitle>
              <CardDescription>Resolve these before approving the job.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {outstandingIssues.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="font-medium text-green-600">✓</span>
                  <span>Nothing pending — you are ready to review.</span>
                </div>
              ) : (
                outstandingIssues.map((issue, index) => (
                  <div
                    key={`${issue.message}-${index}`}
                    className={cn(
                      'rounded-md border p-2 text-[10px]',
                      issue.level === 'error' ? 'border-destructive/60 bg-destructive/10 text-destructive' : 'border-amber-300/60 bg-amber-50 text-amber-600'
                    )}
                  >
                    {issue.message}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        )}
        {job && (
          <Card>
            <CardHeader>
              <CardTitle>Automation status</CardTitle>
              <CardDescription>Track background steps powering Phase 2.</CardDescription>
            </CardHeader>
            <CardContent className="h-fit">
              <div className="grid gap-4 sm:grid-cols-3">
                {automationStatuses.map((item) => {
                  const variant = item.ready ? 'default' : item.lastRun ? 'secondary' : 'outline'
                  return (
                    <div key={item.key} className="h-fit rounded-lg border px-3 py-[2px] text-[10px]">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-sm">{item.label}</p>
                        <Badge variant={variant} className="text-xs">
                          {item.stateLabel}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Last run: {item.lastRun ? formatTimestamp(item.lastRun) : '—'}
                      </p>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}
        {ghostBackWarningVisible && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Back ghost generation disabled</AlertTitle>
            <AlertDescription>
              Back generation will not happen. Back-view images marked ghost-eligible will be ignored.
            </AlertDescription>
          </Alert>
        )}
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            const next = value as 'phase1' | 'phase2'
            setActiveTab(next)
            if (next === 'phase2') {
              setHasSeenPhase2(true)
            }
          }}
        >
          <TabsList className="grid h-fit w-fit grid-cols-2 text-xs">
            <TabsTrigger value="phase1" className="text-xs">Phase 1 · Tagging</TabsTrigger>
            <TabsTrigger value="phase2" className="text-xs" disabled={!flags?.hitlPhase1Completed}>Phase 2 · Approval</TabsTrigger>
          </TabsList>
          <TabsContent value="phase1" className="mt-6">
            {phase1Section}
            {footer}
          </TabsContent>
          <TabsContent value="phase2" className="mt-6">
            <Card className="mb-4">
              <CardHeader>
                <CardTitle>Phase 2 readiness checklist</CardTitle>
                <CardDescription>Ensure each item is complete before approving.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {phase2Checklist.map((item) => (
                  <div key={item.label} className="flex items-center gap-2">
                    <span className={cn('text-lg leading-none', item.done ? 'text-green-600' : 'text-muted-foreground')}>
                      {item.done ? '✓' : '•'}
                    </span>
                    <span className={cn(item.done ? 'text-muted-foreground' : 'text-foreground font-medium')}>{item.label}</span>
                  </div>
                ))}
                {outstandingIssues.map((issue, index) => (
                  <div
                    key={`phase2-issue-${index}`}
                    className={cn(
                      'flex items-center gap-2 rounded-md border p-2',
                      issue.level === 'error' ? 'border-destructive/60 bg-destructive/10 text-destructive' : 'border-amber-300/60 bg-amber-50 text-amber-600'
                    )}
                  >
                    <Badge variant={issue.level === 'error' ? 'destructive' : 'outline'} className="text-[11px]">
                      {issue.level === 'error' ? 'Error' : 'Warning'}
                    </Badge>
                    <span>{issue.message}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <div className="grid grid-cols-1 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Garment Summaries</CardTitle>
                  <CardDescription>Review AI summaries for front/back views, edit JSON, or regenerate.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="Front Summary (JSON)">
                      <Textarea
                        rows={6}
                        value={summaryFrontText}
                        onChange={(event) => setSummaryFrontText(event.target.value)}
                      />
                    </Field>
                    <Field label="Back Summary (JSON)">
                      <Textarea
                        rows={6}
                        value={summaryBackText}
                        onChange={(event) => setSummaryBackText(event.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
                    <Field label="Summary Version" className="md:w-64">
                      <Input
                        value={summaryVersion}
                        onChange={(event) => setSummaryVersion(event.target.value)}
                      />
                    </Field>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        onClick={handleSaveSummaries}
                        disabled={!summariesDirty || phase2.status === 'saving'}
                      >
                        {phase2.status === 'saving' && phase2.lastAction === 'save' ? 'Saving…' : 'Save summaries'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          const resolvedJobId = resolveJobId(job)
                          if (!resolvedJobId) return
                          phase2.regenerate(resolvedJobId, 'garment_summary')
                        }}
                        disabled={!job || phase2.status === 'regenerating'}
                      >
                        {phase2.status === 'regenerating' && phase2.lastAction === 'regenerate' ? 'Regenerating…' : 'Regenerate summaries'}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Regeneration produces fresh copy using updated Phase 2 tags.
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Enrichment Suggestions</CardTitle>
                    <CardDescription>Compare enriched attributes and accept the ones that look right.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {!hasAnySuggestions && (
                      <p className="text-sm text-muted-foreground">
                        No enrichment suggestions available yet. Regenerate above to request fresh attributes.
                      </p>
                    )}
                    {hasAnySuggestions && !hasVisibleSuggestions && (
                      <div className="flex items-center justify-between rounded-md border border-dashed p-4 text-xs text-muted-foreground">
                        <span>All suggestions dismissed for this session.</span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setDismissedSuggestions({})
                            setSuggestionDrafts({})
                          }}
                        >
                          Show suggestions
                        </Button>
                      </div>
                    )}
                    {hasVisibleSuggestions && (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[18%]">Field</TableHead>
                            <TableHead>Current Draft</TableHead>
                            <TableHead>Suggested</TableHead>
                            <TableHead className="w-[18%]">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ENRICH_FIELD_META.map(({ key, label, helper }) => {
                            const suggestionRaw = enrichSuggestions[key]
                            if (suggestionRaw === undefined) return null
                            if (dismissedSuggestions[key]) {
                              return (
                                <TableRow key={`${key}-dismissed`} className="opacity-70">
                                  <TableCell>
                                    <div className="flex flex-col gap-1">
                                      <span className="font-medium">{label}</span>
                                      {helper && <span className="text-xs text-muted-foreground">{helper}</span>}
                                      <Badge variant="outline" className="w-fit text-xs uppercase tracking-wide">Dismissed</Badge>
                                    </div>
                                  </TableCell>
                                  <TableCell colSpan={2} className="text-sm text-muted-foreground">
                                    Hidden until you restore it.
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleRestoreSuggestion(key)}
                                    >
                                      <Undo2 className="mr-1 h-4 w-4" />
                                      Restore
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              )
                            }

                            const editValue = suggestionDrafts[key] ?? serializeSuggestionForEdit(key, suggestionRaw)
                            const parsed = parseEditedSuggestionValue(key, editValue)
                            const normalizedSuggestion = parsed.error ? null : normalizeEnrichSuggestionValue(key, parsed.value)
                            const currentValue =
                              key === 'product_name_suggestion'
                                ? productForm.product_name
                                : (productForm as Record<string, unknown>)[key]
                            const applied = !parsed.error && valuesEqual(currentValue ?? null, normalizedSuggestion ?? null)
                            const previewText = formatSuggestionValue(normalizedSuggestion)
                            const onDraftChange = (value: string) => {
                              setSuggestionDrafts((prev) => ({
                                ...prev,
                                [key]: value,
                              }))
                            }

                            return (
                              <TableRow key={key}>
                                <TableCell>
                                  <div className="flex flex-col gap-1">
                                    <span className="font-medium">{label}</span>
                                    {helper && <span className="text-xs text-muted-foreground">{helper}</span>}
                                    {applied && <Badge variant="outline" className="w-fit text-xs uppercase tracking-wide">Applied</Badge>}
                                  </div>
                                </TableCell>
                                <TableCell className="whitespace-pre-wrap text-sm text-muted-foreground">
                                  {formatSuggestionValue(currentValue)}
                                </TableCell>
                                <TableCell>
                                  <div className="space-y-2 text-sm">
                                    {key === 'vibes' ? (
                                      <Input
                                        value={editValue}
                                        onChange={(event) => onDraftChange(event.target.value)}
                                        placeholder="streetwear, vintage graphic"
                                      />
                                    ) : (
                                      <Textarea
                                        value={editValue}
                                        onChange={(event) => onDraftChange(event.target.value)}
                                        rows={key === 'product_specifications' ? 6 : 4}
                                      />
                                    )}
                                    {parsed.error ? (
                                      <p className="text-xs text-destructive">{parsed.error}</p>
                                    ) : (
                                      <p className="text-xs text-muted-foreground">
                                        Preview: {previewText}
                                      </p>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-col gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleApplySuggestion(key)}
                                      disabled={applied || phase2.status === 'saving' || pendingSuggestion === key || Boolean(parsed.error)}
                                    >
                                      {pendingSuggestion === key && phase2.status === 'saving' ? 'Applying…' : 'Accept'}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleDismissSuggestion(key)}
                                    >
                                      Dismiss
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                          <TableRow>
                            <TableCell colSpan={4}>
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={handleApplyAllSuggestions}
                                  disabled={!hasAcceptAllEligibleSuggestions || acceptAllSuggestionsPending || phase2.status === 'saving' || pendingSuggestion !== null}
                                >
                                  {acceptAllSuggestionsPending ? (
                                    <>
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      Accepting…
                                    </>
                                  ) : (
                                    'Accept All'
                                  )}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Ghost Mannequin Assets</CardTitle>
                    <CardDescription>Review staging renders, upload processed assets, and request regenerations.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {ghostViewOrder.map((view) => {
                      const info = ghostViews[view]
                      const isUploading = uploadingView === view
                      const isRegenerating = regeneratingView === view
                      const error = uploadErrors[view]
                      return (
                        <div key={view} className="space-y-4 border-b pb-4 last:border-b-0 last:pb-0">
                          <div className="text-sm font-semibold">{GHOST_VIEW_LABELS[view]}</div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-sm font-medium">
                                <span>Staging Render</span>
                                {info.stagingUrl && (
                                  <div className="flex items-center gap-1">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        const filename =
                                          info.stagingPath?.split('/').pop() ??
                                          `${resolvedJobIdMemo ?? 'job'}-${view}-staging.png`
                                        void downloadAsset(info.stagingUrl, filename)
                                      }}
                                    >
                                      <Download className="mr-1 h-4 w-4" />
                                      Download
                                    </Button>
                                    <Button asChild variant="ghost" size="sm">
                                      <a href={info.stagingUrl} target="_blank" rel="noreferrer">
                                        <ExternalLink className="mr-1 h-4 w-4" />
                                        Open staging
                                      </a>
                                    </Button>
                                  </div>
                                )}
                              </div>
                              <div className="relative aspect-[3/4] overflow-hidden rounded-md border bg-muted">
                                {info.stagingUrl ? (
                                  <img
                                    src={info.stagingUrl}
                                    alt={`${view} staging ghost mannequin`}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                                    Awaiting staging render
                                  </div>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Generated {formatTimestamp(info.stagingCreatedAt)}
                              </p>
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-sm font-medium">
                                <span>Processed Asset</span>
                                {info.processedUrl && (
                                  <div className="flex items-center gap-1">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        const filename =
                                          info.processedPath?.split('/').pop() ??
                                          `${resolvedJobIdMemo ?? 'job'}-${view}-processed.png`
                                        void downloadAsset(info.processedUrl, filename)
                                      }}
                                    >
                                      <Download className="mr-1 h-4 w-4" />
                                      Download
                                    </Button>
                                    <Button asChild variant="ghost" size="sm">
                                      <a href={info.processedUrl} target="_blank" rel="noreferrer">
                                        <ExternalLink className="mr-1 h-4 w-4" />
                                        Open processed
                                      </a>
                                    </Button>
                                  </div>
                                )}
                              </div>
                              <div className="relative aspect-[3/4] overflow-hidden rounded-md border bg-muted">
                                {info.processedUrl ? (
                                  <img
                                    src={info.processedUrl}
                                    alt={`${view} processed ghost mannequin`}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                                    No processed upload yet
                                  </div>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Storage path: {info.processedPath ?? '—'}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-3">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleGhostRegenerate(view)}
                              disabled={isRegenerating || isUploading}
                            >
                              {isRegenerating ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  Regenerating…
                                </>
                              ) : (
                                'Regenerate'
                              )}
                            </Button>
                            <div>
                              <input
                                ref={(node) => {
                                  uploadInputRefs.current[view] = node
                                }}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleGhostFileChange(view)}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={isUploading || !resolvedJobIdMemo}
                                onClick={() => triggerGhostUploadDialog(view)}
                              >
                                {isUploading ? (
                                  <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Uploading…
                                  </>
                                ) : (
                                  <>
                                    <UploadCloud className="mr-2 h-4 w-4" />
                                    Upload processed
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                          {error && <p className="text-xs text-destructive">{error}</p>}
                        </div>
                      )
                    })}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Studio Preview</CardTitle>
                    <CardDescription>Validate mannequin placement and masking using the processed ghost asset before promotion.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-[2fr,3fr]">
                      <div className="space-y-2">
                        <div className="relative aspect-[3/4] overflow-hidden rounded-md border bg-muted">
                          {previewRenderedItems.length > 0 && mannequinQuery.data ? (
                            <AvatarRenderer
                              mannequinConfig={mannequinQuery.data}
                              items={previewRenderedItems}
                              containerHeight={560}
                              containerWidth={420}
                              gender={effectivePreviewGender}
                              itemOpacity={previewOpacity / 100}
                              showBody
                              showHead
                              visibleSegments={bodyPartsVisible ?? undefined}
                            />
                          ) : fallbackPreviewUrl ? (
                            <img src={fallbackPreviewUrl} alt="Preview garment" className="h-full w-full object-contain" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                              No preview imagery resolved yet
                            </div>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{previewStatusText}</p>
                      </div>
                        <div className="space-y-4">
                        <div className="space-y-2">
                          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Mannequin</Label>
                          <ToggleGroup
                            type="single"
                            value={mannequinGenderMode}
                            onValueChange={(value) => {
                              if (!value) return
                              if (value === 'auto' || value === 'male' || value === 'female') {
                                setMannequinGenderMode(value)
                              }
                            }}
                            variant="outline"
                            size="sm"
                          >
                            <ToggleGroupItem value="auto">Auto</ToggleGroupItem>
                            <ToggleGroupItem value="female">Female</ToggleGroupItem>
                            <ToggleGroupItem value="male">Male</ToggleGroupItem>
                          </ToggleGroup>
                          <p className="text-xs text-muted-foreground">
                            Auto resolves from product gender ({productForm.gender || '—'}) → {autoPreviewGender}.
                          </p>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Placement X</Label>
                          <div className="flex items-center gap-3">
                            <Slider
                              className="flex-1"
                              value={[placementX ?? 0]}
                              onValueChange={(value) => handlePlacementChange('x', value)}
                              min={-100}
                              max={100}
                              step={FLOAT_INPUT_STEP}
                            />
                            <div className="relative">
                              <Input
                                value={placementXText}
                                onChange={(event) => setPlacementXText(event.target.value)}
                                onBlur={() => {
                                  if (skipPlacementXBlurCommit.current) {
                                    skipPlacementXBlurCommit.current = false
                                    return
                                  }
                                  commitPlacementXText()
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault()
                                    commitPlacementXText()
                                    skipPlacementXBlurCommit.current = true
                                    event.currentTarget.blur()
                                  }
                                  if (event.key === 'Escape') {
                                    event.preventDefault()
                                    skipPlacementXBlurCommit.current = true
                                    setPlacementXText(formatFloat(placementX ?? 0))
                                    event.currentTarget.blur()
                                  }
                                }}
                                inputMode="decimal"
                                placeholder="0"
                                className="h-8 w-24 pr-7"
                              />
                              <div className="pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 flex-col gap-0.5">
                                <button
                                  type="button"
                                  aria-label="Increase placement X"
                                  className="pointer-events-auto flex h-3.5 w-3.5 items-center justify-center rounded hover:bg-muted"
                                  onMouseDown={(event) => {
                                    event.preventDefault()
                                    skipPlacementXBlurCommit.current = true
                                    nudgePlacementX(FLOAT_INPUT_STEP)
                                  }}
                                >
                                  <ChevronUp className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  aria-label="Decrease placement X"
                                  className="pointer-events-auto flex h-3.5 w-3.5 items-center justify-center rounded hover:bg-muted"
                                  onMouseDown={(event) => {
                                    event.preventDefault()
                                    skipPlacementXBlurCommit.current = true
                                    nudgePlacementX(-FLOAT_INPUT_STEP)
                                  }}
                                >
                                  <ChevronDown className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          </div>
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>-100</span>
                            <span>{formatFloat(placementX ?? 0)}</span>
                            <span>100</span>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Placement Y</Label>
                          <div className="flex items-center gap-3">
                            <Slider
                              className="flex-1"
                              value={[placementY ?? 0]}
                              onValueChange={(value) => handlePlacementChange('y', value)}
                              min={-100}
                              max={100}
                              step={FLOAT_INPUT_STEP}
                            />
                            <div className="relative">
                              <Input
                                value={placementYText}
                                onChange={(event) => setPlacementYText(event.target.value)}
                                onBlur={() => {
                                  if (skipPlacementYBlurCommit.current) {
                                    skipPlacementYBlurCommit.current = false
                                    return
                                  }
                                  commitPlacementYText()
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault()
                                    commitPlacementYText()
                                    skipPlacementYBlurCommit.current = true
                                    event.currentTarget.blur()
                                  }
                                  if (event.key === 'Escape') {
                                    event.preventDefault()
                                    skipPlacementYBlurCommit.current = true
                                    setPlacementYText(formatFloat(placementY ?? 0))
                                    event.currentTarget.blur()
                                  }
                                }}
                                inputMode="decimal"
                                placeholder="0"
                                className="h-8 w-24 pr-7"
                              />
                              <div className="pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 flex-col gap-0.5">
                                <button
                                  type="button"
                                  aria-label="Increase placement Y"
                                  className="pointer-events-auto flex h-3.5 w-3.5 items-center justify-center rounded hover:bg-muted"
                                  onMouseDown={(event) => {
                                    event.preventDefault()
                                    skipPlacementYBlurCommit.current = true
                                    nudgePlacementY(FLOAT_INPUT_STEP)
                                  }}
                                >
                                  <ChevronUp className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  aria-label="Decrease placement Y"
                                  className="pointer-events-auto flex h-3.5 w-3.5 items-center justify-center rounded hover:bg-muted"
                                  onMouseDown={(event) => {
                                    event.preventDefault()
                                    skipPlacementYBlurCommit.current = true
                                    nudgePlacementY(-FLOAT_INPUT_STEP)
                                  }}
                                >
                                  <ChevronDown className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          </div>
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>-100</span>
                            <span>{formatFloat(placementY ?? 0)}</span>
                            <span>100</span>
                          </div>
                        </div>
                        {scalingSupported && (
                          <div className="space-y-2">
                            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Scale (image length)</Label>
                            <div className="flex items-center gap-3">
                              <Slider
                                className="flex-1"
                                value={[sliderCurrentValue]}
                                onValueChange={handleImageLengthChange}
                                min={sliderRange.min}
                                max={sliderRange.max}
                                step={FLOAT_INPUT_STEP}
                              />
                              <div className="relative">
                                <Input
                                  value={imageLengthText}
                                  onChange={(event) => setImageLengthText(event.target.value)}
                                  onBlur={() => {
                                    if (skipImageLengthBlurCommit.current) {
                                      skipImageLengthBlurCommit.current = false
                                      return
                                    }
                                    commitImageLengthText()
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault()
                                      commitImageLengthText()
                                      skipImageLengthBlurCommit.current = true
                                      event.currentTarget.blur()
                                    }
                                    if (event.key === 'Escape') {
                                      event.preventDefault()
                                      skipImageLengthBlurCommit.current = true
                                      setImageLengthText(imageLength === null ? '' : formatFloat(imageLength))
                                      event.currentTarget.blur()
                                    }
                                  }}
                                  inputMode="decimal"
                                  placeholder={imageLength === null ? 'Auto' : '0'}
                                  className="h-8 w-24 pr-7"
                                />
                                <div className="pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 flex-col gap-0.5">
                                  <button
                                    type="button"
                                    aria-label="Increase scale"
                                    className="pointer-events-auto flex h-3.5 w-3.5 items-center justify-center rounded hover:bg-muted"
                                    onMouseDown={(event) => {
                                      event.preventDefault()
                                      skipImageLengthBlurCommit.current = true
                                      nudgeImageLength(FLOAT_INPUT_STEP)
                                    }}
                                  >
                                    <ChevronUp className="h-3 w-3" />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label="Decrease scale"
                                    className="pointer-events-auto flex h-3.5 w-3.5 items-center justify-center rounded hover:bg-muted"
                                    onMouseDown={(event) => {
                                      event.preventDefault()
                                      skipImageLengthBlurCommit.current = true
                                      nudgeImageLength(-FLOAT_INPUT_STEP)
                                    }}
                                  >
                                    <ChevronDown className="h-3 w-3" />
                                  </button>
                                </div>
                              </div>
                            </div>
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>{sliderRange.min} cm</span>
                              <span>{sliderLabel}</span>
                              <span>{sliderRange.max} cm</span>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleImageLengthAuto}
                                disabled={imageLength === null && initialImageLength === null}
                              >
                                Use auto scale
                              </Button>
                              {imageLength === null && (
                                <span className="text-xs text-muted-foreground">
                                  Preview uses head-based scaling
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                        <div className="space-y-2">
                          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Item Opacity</Label>
                          <Slider
                            value={[previewOpacity]}
                            onValueChange={(value) => setPreviewOpacity(value[0] ?? 100)}
                            min={10}
                            max={100}
                            step={5}
                          />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>10%</span>
                            <span>{previewOpacity}%</span>
                            <span>100%</span>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Visible body parts</Label>
                          <div className="flex flex-wrap gap-2">
                            {MANNEQUIN_SEGMENT_NAMES.map((segment) => {
                              const isChecked = bodyPartsVisible?.includes(segment) ?? false
                              return (
                                <Button
                                  key={segment}
                                  type="button"
                                  variant={isChecked ? 'default' : 'outline'}
                                  size="sm"
                                  onClick={() => {
                                    setBodyPartsVisible((prev) => {
                                      const current = prev ?? []
                                      if (current.includes(segment)) {
                                        return current.filter((entry) => entry !== segment)
                                      }
                                      return [...current, segment]
                                    })
                                  }}
                                >
                                  {segment.replace(/_/g, ' ')}
                                </Button>
                              )
                            })}
                          </div>
                          <p className="text-xs text-muted-foreground">Select mannequin segments to remain visible; defaults to all segments.</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" onClick={handlePlacementReset} disabled={!hasPreviewChanges}>
                            Reset to saved
                          </Button>
                          <Button
                            size="sm"
                            onClick={handlePlacementSave}
                            disabled={!hasPreviewChanges || placementPending}
                          >
                            {placementPending ? 'Saving…' : 'Save placement & visibility'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Draft Payloads</CardTitle>
                    <CardDescription>Review the full records that will be staged and promoted once Phase 2 is approved.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Product Payload</h3>
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={phase2.status === 'saving'}>
                              Refresh
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={handleSaveProductPayload}
                              disabled={productPayloadSaving}
                            >
                              {productPayloadSaving ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  Saving…
                                </>
                              ) : (
                                'Save Product Payload'
                              )}
                            </Button>
                          </div>
                        </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[28%]">Field</TableHead>
                            <TableHead>Value</TableHead>
                            <TableHead className="w-[25%]">DB Column</TableHead>
                            <TableHead className="w-[15%]">Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {productFieldRows.map((row) => (
                            <TableRow key={row.id} className={row.isRequired && !row.isValid ? 'bg-destructive/5' : undefined}>
                              <TableCell>
                                <div className="flex flex-col gap-1">
                                  <span className="font-medium text-sm">{row.label}</span>
                                  <span className="text-xs text-muted-foreground">{row.helpText}</span>
                                </div>
                              </TableCell>
                              <TableCell className="whitespace-pre-wrap text-sm">
                                {row.renderEditable ? row.renderEditable() : row.render()}
                              </TableCell>
                              <TableCell className="text-xs font-mono text-muted-foreground">{row.column}</TableCell>
                              <TableCell>
                                {row.isValid ? (
                                  <Badge variant="outline" className="text-xs">{row.statusLabel}</Badge>
                                ) : (
                                  <Badge variant="destructive" className="text-xs">Fix required</Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Product Images</h3>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleSaveImagePayload}
                          disabled={imagePayloadSaving}
                        >
                          {imagePayloadSaving ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Saving…
                            </>
                          ) : (
                            'Save Image Payload'
                          )}
                        </Button>
                      </div>
                      <div className="space-y-4">
                        {imageFieldRows.map((row) => (
                          <div
                            key={row.id}
                            className={cn(
                              'rounded-lg border p-4 transition-colors',
                              row.isPrimary ? 'border-primary/60 bg-primary/5' : 'border-border bg-card'
                            )}
                          >
                            <div className="flex flex-col gap-4 sm:flex-row">
                              <div className="sm:w-28 sm:flex-none">
                                <div className="overflow-hidden rounded-md border bg-muted">
                                  {row.thumbnailUrl ? (
                                    <img src={row.thumbnailUrl} alt={row.label} className="h-28 w-28 object-cover" />
                                  ) : (
                                    <div className="flex h-28 w-28 items-center justify-center text-xs text-muted-foreground">
                                      No preview
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex-1 space-y-3">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium">{row.label}</span>
                                      {row.isPrimary && <Badge variant="default" className="text-xs">Primary</Badge>}
                                      {row.kindSource === 'fallback' && (
                                        <Badge variant="outline" className="text-xs">Kind inferred</Badge>
                                      )}
                                    </div>
                                    <p className="text-xs text-muted-foreground break-all">
                                      {row.publicUrl ?? row.url ?? 'Pending upload'}
                                    </p>
                                  </div>
                                  {formatBadgeStatus(row.statusLabel, !row.isValid)}
                                </div>
                                <div className="grid gap-2 text-xs sm:grid-cols-4">
                                  <div className="space-y-1">
                                    <span className="text-muted-foreground">Kind</span>
                                    <Select
                                      value={row.kind ?? undefined}
                                      onValueChange={(value) =>
                                        setImagesForm((prev) =>
                                          prev.map((img) =>
                                            img.url === row.url ? { ...img, kind: value as DraftImage['kind'] } : img
                                          )
                                        )
                                      }
                                    >
                                      <SelectTrigger className="h-8 text-xs">
                                        <SelectValue placeholder="Select kind" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="model">Model</SelectItem>
                                        <SelectItem value="flatlay">Flatlay</SelectItem>
                                        <SelectItem value="detail">Detail</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-1">
                                    <span className="text-muted-foreground">View</span>
                                    <Select
                                      value={row.product_view ?? 'none'}
                                      onValueChange={(value) =>
                                        setImagesForm((prev) =>
                                          prev.map((img) =>
                                            img.url === row.url
                                              ? {
                                                  ...img,
                                                  product_view: value === 'none' ? null : (value as NonNullable<DraftImage['product_view']>),
                                                }
                                              : img
                                          )
                                        )
                                      }
                                    >
                                      <SelectTrigger className="h-8 text-xs">
                                        <SelectValue placeholder="Select view" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {viewOptions.map((option) => (
                                          <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                          </SelectItem>
                                        ))}
                                        <SelectItem value="none">Unassigned</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-1">
                                    <span className="text-muted-foreground">Sort order</span>
                                    <Input
                                      type="number"
                                      value={row.sort_order ?? ''}
                                      onChange={(event) => {
                                        const next = event.target.value === '' ? null : Number(event.target.value)
                                        setImagesForm((prev) =>
                                          prev.map((img) =>
                                            img.url === row.url ? { ...img, sort_order: next ?? undefined } : img
                                          )
                                        )
                                      }}
                                      className="h-8 text-xs"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <span className="text-muted-foreground">Primary</span>
                                    <Switch
                                      checked={row.isPrimary}
                                      onCheckedChange={(checked) =>
                                        setImagesForm((prev) =>
                                          prev.map((img) =>
                                            img.url === row.url
                                              ? { ...img, is_primary: checked }
                                              : checked
                                                ? { ...img, is_primary: false }
                                                : img
                                          )
                                        )
                                      }
                                    />
                                  </div>
                                </div>
                                <div className="grid gap-2 text-xs sm:grid-cols-4">
                                  <div className="space-y-1">
                                    <span className="text-muted-foreground">Ghost eligible</span>
                                    <Switch
                                      checked={row.ghost_eligible}
                                      onCheckedChange={(checked) =>
                                        setImagesForm((prev) =>
                                          prev.map((img) =>
                                            img.url === row.url ? { ...img, ghost_eligible: checked } : img
                                          )
                                        )
                                      }
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <span className="text-muted-foreground">Summary eligible</span>
                                    <Switch
                                      checked={row.summary_eligible}
                                      onCheckedChange={(checked) =>
                                        setImagesForm((prev) =>
                                          prev.map((img) =>
                                            img.url === row.url ? { ...img, summary_eligible: checked } : img
                                          )
                                        )
                                      }
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <span className="text-muted-foreground">VTO eligible</span>
                                    <Switch
                                      checked={row.vto_eligible}
                                      onCheckedChange={(checked) =>
                                        setImagesForm((prev) =>
                                          prev.map((img) =>
                                            img.url === row.url ? { ...img, vto_eligible: checked } : img
                                          )
                                        )
                                      }
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <span className="text-muted-foreground">Gender</span>
                                    <div className="flex items-center gap-2">
                                      <Badge variant="outline" className="text-xs capitalize">
                                        {row.resolvedGender ?? '—'}
                                      </Badge>
                                      {row.genderSource === 'product' && (
                                        <span className="text-[10px] uppercase text-muted-foreground">Inherited</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <details className="text-xs">
                                  <summary className="cursor-pointer text-muted-foreground">Pipeline details</summary>
                                  <div className="mt-2 space-y-1 font-mono">
                                    {PRODUCT_IMAGE_COLUMNS_ORDER.map((column) => (
                                      <div key={column} className="flex justify-between gap-2">
                                        <span>product_images.{column}</span>
                                        <span className="text-right">{formatColumnValue(row.columns[column])}</span>
                                      </div>
                                    ))}
                                    <div className="flex justify-between gap-2">
                                      <span>storage_path</span>
                                      <span className="text-right">
                                        {row.storage_path ?? '—'}
                                      </span>
                                    </div>
                                    <div className="flex justify-between gap-2">
                                      <span>processed_path</span>
                                      <span className="text-right">
                                        {row.processed_path ?? '—'}
                                      </span>
                                    </div>
                                  </div>
                                </details>
                              </div>
                            </div>
                          </div>
                        ))}
                        {imageFieldRows.length === 0 && (
                          <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
                            No product images resolved for this draft.
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Phase 2 Approval</CardTitle>
                    <CardDescription>Stage the reviewed payloads and publish them to production.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-1">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Stage</p>
                        <Badge variant={stageBadgeVariant} className="w-fit text-xs">
                          {stageStatusLabel}
                        </Badge>
                        <p className="text-xs text-muted-foreground">{stageStatusDescription}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Promote</p>
                        <Badge variant={promoteBadgeVariant} className="w-fit text-xs">
                          {promoteStatusLabel}
                        </Badge>
                        <p className="text-xs text-muted-foreground">{promoteStatusDescription}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Phase 2</p>
                        <Badge variant={phase2BadgeVariant} className="w-fit text-xs">
                          {phase2StatusLabel}
                        </Badge>
                        <p className="text-xs text-muted-foreground">{phase2StatusDescription}</p>
                      </div>
                    </div>
                    {(stageErrors.length > 0 || promoteErrors.length > 0) && (
                      <div className="space-y-1 text-sm text-destructive">
                        {stageErrors.map((error, index) => (
                          <p key={`stage-error-${index}`}>Stage: {error.message}</p>
                        ))}
                        {promoteErrors.map((error, index) => (
                          <p key={`promote-error-${index}`}>Promote: {error.message}</p>
                        ))}
                      </div>
                    )}
                    {phase2.status === 'error' && phase2.error && (
                      <div className="text-sm text-destructive">{phase2.error}</div>
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                      <Button onClick={handleApprovePhase2} disabled={approvalDisabled} size="sm">
                        {approvalInFlight ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Approving…
                          </>
                        ) : (
                          'Approve & Publish'
                        )}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Approving will persist the current draft payloads, stage them, and push the vetted records to
                        production.
                      </p>
                    </div>
                  </CardContent>
                </Card>
                {/* Ghost tooling, payload tables, studio preview to follow */}
              </div>
            </TabsContent>
          </Tabs>
        </div>
    );
  }

  return (
    <div className="flex h-screen flex-col lg:flex-row">
      <aside className="w-full border-b lg:w-[340px] lg:border-b-0 lg:border-r">
        <JobListSidebar selectedJobId={jobIdParam || null} onSelectJob={handleSelectJob} />
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="border-b bg-background">
          <div className="mx-auto w-full max-w-6xl px-6 py-4">{renderHeader()}</div>
        </header>
        <main className="flex-1 overflow-y-auto bg-muted/30">
          <div className="mx-auto w-full max-w-6xl px-6 py-6 space-y-6">{mainContent}</div>
        </main>
      </div>
    </div>
  )
}

export default InventoryDashboard
