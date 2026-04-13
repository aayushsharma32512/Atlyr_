export type PreviewGender = 'male' | 'female'

const FEMALE_TOKENS = new Set(['female', 'woman', 'women', 'womens', 'girl', 'girls', 'f'])
const MALE_TOKENS = new Set(['male', 'man', 'men', 'mens', 'boy', 'boys', 'm'])

function tokenizeGender(raw: string): string[] {
  return raw
    .trim()
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
}

export function resolvePreviewGender(rawGender?: string | null): PreviewGender {
  if (typeof rawGender !== 'string') return 'female'

  const tokens = tokenizeGender(rawGender)
  if (!tokens.length) return 'female'

  const hasFemale = tokens.some((token) => FEMALE_TOKENS.has(token))
  const hasMale = tokens.some((token) => MALE_TOKENS.has(token))

  if (hasFemale && !hasMale) return 'female'
  if (hasMale && !hasFemale) return 'male'

  // Keep existing behavior (stable default) for unknown/ambiguous tags like "unisex" or "women-men".
  return 'female'
}

