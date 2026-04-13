type Gender = "male" | "female" | "unisex" | null

export function buildGenderFilter(gender: Gender) {
  const base = ["gender.eq.unisex"]
  if (gender === "male" || gender === "female") {
    base.push(`gender.eq.${gender}`)
  }

  return base.join(",")
}
