import { supabase } from "@/integrations/supabase/client"

import { generateShareSlug, isSafeSharePath } from "./shareLinkSlug"

const table = () => supabase.from("share_links")

const UNIQUE_VIOLATION = "23505"
const MAX_MINT_ATTEMPTS = 4

/** The slug already minted for `path`, or null. Paths are unique, so at most one. */
async function findShareSlug(path: string): Promise<string | null> {
  const { data, error } = await table().select("slug").eq("path", path).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? data.slug : null
}

/**
 * The slug for `path`, reusing an existing one so a look shares to the same
 * link every time. A unique clash is either a concurrent mint of this path
 * (re-read and reuse) or a slug collision (draw again).
 */
export async function createShareLink(path: string, userId: string | null): Promise<string> {
  if (!isSafeSharePath(path)) {
    throw new Error("share path must be relative to this app")
  }
  const existing = await findShareSlug(path)
  if (existing) return existing

  let lastError: unknown = null
  for (let attempt = 0; attempt < MAX_MINT_ATTEMPTS; attempt++) {
    const slug = generateShareSlug()
    const { error } = await table().insert({ slug, path, created_by: userId })
    if (!error) return slug
    lastError = error
    if (error.code !== UNIQUE_VIOLATION) break
    const raced = await findShareSlug(path)
    if (raced) return raced
  }
  throw lastError instanceof Error ? lastError : new Error("could not create share link")
}

/** The long path behind a slug, or null when it does not exist. */
export async function resolveShareLink(slug: string): Promise<string | null> {
  const { data, error } = await table().select("path").eq("slug", slug).maybeSingle()
  if (error) throw new Error(error.message)
  const path = data ? data.path : null
  // Defence in depth: the CHECK constraint should make this unreachable.
  return path && isSafeSharePath(path) ? path : null
}
