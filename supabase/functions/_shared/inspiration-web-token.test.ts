import { describe, expect, test } from "bun:test"
import {
  signInspirationWebSelection,
  verifyInspirationWebSelection,
  type InspirationWebSelectionPayload,
} from "./inspiration-web-token"

const payload: InspirationWebSelectionPayload = {
  version: 1,
  importId: "import-1",
  candidateId: "candidate-1",
  providerResultId: "lens:1",
  rank: 1,
  title: "Nehebkau Cuban Shirt – White Cobra",
  merchantDomain: "whitecobra.in",
  listingUrl: "https://whitecobra.in/products/nehebkau-cuban-shirt",
  imageUrl: "https://whitecobra.in/cdn/shop/files/shirt.png",
  expiresAt: 2_000_000_000,
}

describe("inspiration web selection tokens", () => {
  test("round-trips the signed result payload", async () => {
    const token = await signInspirationWebSelection(payload, "secret")

    expect(await verifyInspirationWebSelection(token, "secret")).toEqual(payload)
  })

  test("rejects a modified payload or a different secret", async () => {
    const token = await signInspirationWebSelection(payload, "secret")
    const [encoded, signature] = token.split(".")
    const tampered = `${encoded.slice(0, -1)}A.${signature}`

    expect(await verifyInspirationWebSelection(tampered, "secret")).toBeNull()
    expect(await verifyInspirationWebSelection(token, "different-secret")).toBeNull()
  })

  test("rejects malformed tokens", async () => {
    expect(await verifyInspirationWebSelection("not-a-token", "secret")).toBeNull()
  })
})
