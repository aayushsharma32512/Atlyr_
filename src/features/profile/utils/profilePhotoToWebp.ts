const PHOTO_EDGE = 512
const PHOTO_MIME = "image/webp"

/** Centre-crops the picked photo to a small square WebP, so the stored file is a few tens of KB. */
export async function profilePhotoToWebp(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    const canvas = document.createElement("canvas")
    canvas.width = Math.min(PHOTO_EDGE, side)
    canvas.height = canvas.width
    const context = canvas.getContext("2d")
    if (!context) throw new Error("Could not prepare the photo")
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    const encoded = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, PHOTO_MIME, 0.85))
    if (!encoded) throw new Error("Could not prepare the photo")
    return new File([encoded], "profile.webp", { type: PHOTO_MIME })
  } finally {
    bitmap.close()
  }
}
