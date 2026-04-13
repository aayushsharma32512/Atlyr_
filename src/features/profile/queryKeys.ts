export const profileKeys = {
  all: ["profile"] as const,
  detail: (userId: string | null) => [...profileKeys.all, "detail", userId ?? "anonymous"] as const,
  update: (userId: string | null) => [...profileKeys.all, "update", userId ?? "anonymous"] as const,
  mannequinHeadSvg: (gender: string | null, bodyType: string | null) =>
    [...profileKeys.all, "mannequin-head-svg", gender ?? "unknown", bodyType ?? "unknown"] as const,
  avatarHairStyles: (gender: string | null) =>
    [...profileKeys.all, "avatar-hair-styles", gender ?? "unknown"] as const,
}
