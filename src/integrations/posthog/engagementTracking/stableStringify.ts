type JsonPrimitive = string | number | boolean | null

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>()

  const stringify = (input: unknown): string => {
    if (input === null) return "null"

    const t = typeof input
    if (t === "string") return JSON.stringify(input)
    if (t === "number") return Number.isFinite(input) ? String(input) : "null"
    if (t === "boolean") return input ? "true" : "false"
    if (t === "undefined") return "null"
    if (t === "bigint") return JSON.stringify(String(input))
    if (t === "symbol" || t === "function") return "null"

    if (Array.isArray(input)) {
      return `[${input.map((entry) => stringify(entry)).join(",")}]`
    }

    if (input instanceof Date) {
      return JSON.stringify(input.toISOString())
    }

    if (!isPlainObject(input)) {
      try {
        return JSON.stringify(input as JsonPrimitive)
      } catch {
        return "null"
      }
    }

    if (seen.has(input)) return "null"
    seen.add(input)

    const keys = Object.keys(input).sort()
    const pairs = keys.map((key) => `${JSON.stringify(key)}:${stringify(input[key])}`)
    return `{${pairs.join(",")}}`
  }

  return stringify(value)
}

