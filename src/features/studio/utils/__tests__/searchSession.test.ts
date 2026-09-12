import { beforeEach, describe, expect, it } from "bun:test"

import { DOCUMENT_ID, readStoredSearch, writeStoredSearch } from "../searchSession"
import type { SlotSearchStates } from "@/features/studio/context/StudioContext"

/** Minimal sessionStorage so these run outside a browser. */
function installStorage() {
  const map = new Map<string, string>()
  ;(globalThis as { window?: unknown }).window = {
    sessionStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
  }
  return map
}

const committed = (text: string): SlotSearchStates => ({
  top: {
    draftText: "",
    draftImageUrl: null,
    committedText: text,
    committedImageUrl: null,
    activeFilters: {},
    activeFilterIds: [],
  },
})

describe("studio search session", () => {
  let store: Map<string, string>
  beforeEach(() => {
    store = installStorage()
  })

  it("restores a committed search within the same document", () => {
    writeStoredSearch("o1", committed("shirt"))
    expect(readStoredSearch("o1").top?.committedText).toBe("shirt")
  })

  it("shows the restored query in the bar", () => {
    writeStoredSearch("o1", committed("shirt"))
    expect(readStoredSearch("o1").top?.draftText).toBe("shirt")
  })

  it("does NOT restore after a refresh — the document id changed", () => {
    writeStoredSearch("o1", committed("shirt"), "doc-before-refresh")
    expect(readStoredSearch("o1", "doc-after-refresh")).toEqual({})
  })

  it("keeps searches apart per outfit", () => {
    writeStoredSearch("o1", committed("shirt"))
    expect(readStoredSearch("o2")).toEqual({})
  })

  it("clears the key when nothing is committed, rather than leaving a stale one", () => {
    writeStoredSearch("o1", committed("shirt"))
    writeStoredSearch("o1", {})
    expect(store.size).toBe(0)
    expect(readStoredSearch("o1")).toEqual({})
  })

  it("ignores a draft that was never submitted", () => {
    writeStoredSearch("o1", {
      top: {
        draftText: "half typed",
        draftImageUrl: null,
        committedText: "",
        committedImageUrl: null,
        activeFilters: {},
        activeFilterIds: [],
      },
    })
    expect(readStoredSearch("o1")).toEqual({})
  })

  it("survives a corrupt or legacy payload", () => {
    store.set("atlyr:studio:search:o1", "{not json")
    expect(readStoredSearch("o1")).toEqual({})
    // The pre-stamp shape had no `d`, so it is simply not restored.
    store.set("atlyr:studio:search:o2", JSON.stringify(committed("old")))
    expect(readStoredSearch("o2")).toEqual({})
  })

  it("uses a document id that is a non-empty string", () => {
    expect(typeof DOCUMENT_ID).toBe("string")
    expect(DOCUMENT_ID.length).toBeGreaterThan(0)
  })
})
