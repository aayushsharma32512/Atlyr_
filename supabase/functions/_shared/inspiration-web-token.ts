export type InspirationWebSelectionPayload = {
  version: 1
  importId: string
  candidateId: string
  providerResultId: string
  rank: number
  title: string
  merchantDomain: string
  listingUrl: string
  imageUrl: string
  expiresAt: number
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
  const binary = atob(padded)
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))
}

async function signature(secret: string, encodedPayload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`inspiration-web-selection:${encodedPayload}`),
  )
  return Array.from(new Uint8Array(signed), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

export async function signInspirationWebSelection(
  payload: InspirationWebSelectionPayload,
  secret: string,
): Promise<string> {
  const encodedPayload = encodeBase64Url(JSON.stringify(payload))
  return `${encodedPayload}.${await signature(secret, encodedPayload)}`
}

export async function verifyInspirationWebSelection(
  token: string,
  secret: string,
): Promise<InspirationWebSelectionPayload | null> {
  const [encodedPayload, suppliedSignature, ...rest] = token.split(".")
  if (!encodedPayload || !suppliedSignature || rest.length) return null
  const expectedSignature = await signature(secret, encodedPayload)
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) return null
  try {
    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as InspirationWebSelectionPayload
    return payload?.version === 1 ? payload : null
  } catch {
    return null
  }
}
