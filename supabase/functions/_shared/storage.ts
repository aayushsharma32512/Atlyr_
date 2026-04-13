// @ts-nocheck
/* eslint-disable */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export function getSupabaseAdmin() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return createClient(supabaseUrl, supabaseServiceKey)
}

export async function putObject(bucket: string, path: string, bytes: Uint8Array, contentType: string) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.storage.from(bucket).upload(path, bytes, { contentType, upsert: true })
  if (error) throw new Error(`[Storage][putObject] ${error.message}`)
  return data
}

export async function moveObject(bucket: string, fromPath: string, toPath: string) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.storage.from(bucket).move(fromPath, toPath)
  if (error) throw new Error(`[Storage][moveObject] ${error.message}`)
  return data
}

export async function copyObject(bucket: string, fromPath: string, toPath: string) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.storage.from(bucket).copy(fromPath, toPath)
  if (error) throw new Error(`[Storage][copyObject] ${error.message}`)
  return data
}

export async function deleteObjects(bucket: string, paths: string[]) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.storage.from(bucket).remove(paths)
  if (error) throw new Error(`[Storage][deleteObjects] ${error.message}`)
  return data
}

export async function createSignedUrl(bucket: string, path: string, expiresInSeconds = 3600) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds)
  if (error) throw new Error(`[Storage][createSignedUrl] ${error.message}`)
  return data
}

export async function downloadObject(bucket: string, path: string): Promise<Uint8Array> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.storage.from(bucket).download(path)
  if (error) throw new Error(`[Storage][downloadObject] ${error.message}`)
  const arrayBuffer = await data.arrayBuffer()
  return new Uint8Array(arrayBuffer)
}


