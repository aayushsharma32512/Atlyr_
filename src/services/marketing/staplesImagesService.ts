import { supabase } from "@/integrations/supabase/client"

export async function getStaplesPublicImageUrls(input: {
  bucket: string
  prefixes: string[]
  targetCount: number
}): Promise<string[]> {
  const { bucket, prefixes, targetCount } = input

  for (const prefix of prefixes) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 200 })

    if (error) {
      continue
    }

    const files = (data ?? []).filter((item) => item.name && !item.name.endsWith("/"))
    if (files.length === 0) {
      continue
    }

    return files.slice(0, targetCount).map((file) => {
      const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(`${prefix}/${file.name}`)
      return publicUrlData.publicUrl
    })
  }

  return []
}

