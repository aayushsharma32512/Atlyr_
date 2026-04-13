type StudioDataIssue =
  | {
      type: "missing-placement"
      slot: string
      productId: string
      placement_x: number | null
      placement_y: number | null
      image_length: number | null
    }

export function reportStudioDataIssue(issue: StudioDataIssue) {
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn("[studio:data]", issue)
  }
}


