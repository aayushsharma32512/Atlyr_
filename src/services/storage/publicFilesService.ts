import { supabase } from "@/integrations/supabase/client"

type UploadSearchImageOptions = {
  file: File
  folder?: string
}

const DEFAULT_BUCKET = "public-files"
const DEFAULT_FOLDER = "search-images"

export async function uploadSearchImage({ file, folder = DEFAULT_FOLDER }: UploadSearchImageOptions) {
  const fileExt = file.name.split(".").pop()
  const fileName = `${Math.random().toString(36).slice(2)}.${fileExt}`
  const filePath = `${folder}/${fileName}`

  const { error: uploadError } = await supabase.storage.from(DEFAULT_BUCKET).upload(filePath, file)
  if (uploadError) {
    throw uploadError
  }

  const { data } = supabase.storage.from(DEFAULT_BUCKET).getPublicUrl(filePath)
  return data.publicUrl
}
