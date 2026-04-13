import { getSupabaseAdmin } from './images.ts'

declare const Deno:
  | {
      env: {
        get(key: string): string | undefined
      }
    }
  | undefined

type ProductImageRow = {
  id: string
  product_id: string
  kind: string
  url?: string | null
  sort_order?: number | null
  product_view?: string | null
  vto_eligible?: boolean | null
  summary_eligible?: boolean | null
}

export type TryOnImageReference = {
  id: string
  productId: string
  url: string
  source: 'model' | 'flatlay'
}

const PRODUCT_IMAGE_FIELDS =
  'id, product_id, kind, url, sort_order, product_view, vto_eligible, summary_eligible'

function formatError(productId: string, kind: string) {
  return new Error(
    `[selectFrontEligibleImage] missing ${kind} front image for product ${productId}`,
  )
}

function resolveUrl(raw?: string | null): string | null {
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) return raw
  const envBase = typeof Deno !== 'undefined' ? Deno?.env?.get('PUBLIC_ASSETS_BASE_URL') : undefined
  const base = envBase || ''
  if (!base) return null
  const needsSlash = base.endsWith('/') || raw.startsWith('/') ? '' : '/'
  return `${base}${needsSlash}${raw}`
}

function sortImages(images: ProductImageRow[]) {
  return [...images].sort((a, b) => {
    const orderA = a.sort_order ?? Number.MAX_SAFE_INTEGER
    const orderB = b.sort_order ?? Number.MAX_SAFE_INTEGER
    if (orderA !== orderB) return orderA - orderB
    return a.id < b.id ? -1 : 1
  })
}

async function fetchImages(productId: string, where: Record<string, string | boolean>) {
  const supabase = await getSupabaseAdmin()
  let query = supabase
    .from('product_images')
    .select(PRODUCT_IMAGE_FIELDS)
    .eq('product_id', productId)

  Object.entries(where).forEach(([key, value]) => {
    query = query.eq(key, value)
  })

  const { data, error } = await query
  if (error) {
    throw new Error(`[selectFrontEligibleImage] ${error.message}`)
  }
  return (data as ProductImageRow[]) ?? []
}

export async function getFrontImageCandidates(productId: string) {
  let modelFront = await fetchImages(productId, {
    kind: 'model',
    product_view: 'front',
    vto_eligible: true,
  })
  if (modelFront.length === 0) {
    modelFront = await fetchImages(productId, {
      kind: 'model',
      vto_eligible: true,
    })
  }

  let flatlayFront = await fetchImages(productId, {
    kind: 'flatlay',
    product_view: 'front',
    vto_eligible: true,
  })
  if (flatlayFront.length === 0) {
    flatlayFront = await fetchImages(productId, {
      kind: 'flatlay',
      vto_eligible: true,
    })
  }

  return {
    model: modelFront,
    flatlay: flatlayFront,
  }
}

export async function selectFrontEligibleImage(
  productId: string,
): Promise<TryOnImageReference> {
  const { model: modelFront, flatlay: flatlayFront } =
    await getFrontImageCandidates(productId)

  const ordered = sortImages(modelFront.length ? modelFront : flatlayFront)
  const chosen = ordered.find((row) => resolveUrl(row.url))
  if (!chosen) {
    throw formatError(productId, modelFront.length ? 'model' : 'flatlay')
  }
  const resolvedUrl = resolveUrl(chosen.url)
  if (!resolvedUrl) {
    throw formatError(productId, chosen.kind)
  }
  const source: 'model' | 'flatlay' =
    chosen.kind === 'flatlay' ? 'flatlay' : 'model'
  return {
    id: chosen.id,
    productId,
    url: resolvedUrl,
    source,
  }
}

export async function resolveTryOnImages(params: {
  topId?: string | null
  bottomId?: string | null
  footwearId?: string | null
}) {
  const result: {
    top?: TryOnImageReference
    bottom?: TryOnImageReference
    footwear?: TryOnImageReference
  } = {}
  const tasks: Array<Promise<void>> = []

  if (params.topId) {
    tasks.push(
      selectFrontEligibleImage(params.topId).then((ref) => {
        result.top = ref
      }),
    )
  }
  if (params.bottomId) {
    tasks.push(
      selectFrontEligibleImage(params.bottomId).then((ref) => {
        result.bottom = ref
      }),
    )
  }
  if (params.footwearId) {
    tasks.push(
      selectFrontEligibleImage(params.footwearId).then((ref) => {
        result.footwear = ref
      }),
    )
  }

  await Promise.all(tasks)
  return result
}

