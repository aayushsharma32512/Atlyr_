// @ts-nocheck
/* eslint-disable */
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.19.0'

export function getGeminiClient() {
  const apiKey = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GOOGLE_API_KEY')
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY/GOOGLE_API_KEY')
  return new GoogleGenerativeAI(apiKey)
}

function base64FromBytes(bytes: Uint8Array): string {
  // Avoid spreading large arrays (causes stack overflow). Encode in chunks.
  const chunk = 0x8000; // 32KB
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk)
    // Using apply with small chunks keeps call stacks safe
    binary += String.fromCharCode.apply(null, sub as unknown as number[])
  }
  return btoa(binary)
}

export async function toInlineImagePartFromBytes(bytes: Uint8Array, mimeType: string) {
  const base64 = base64FromBytes(bytes)
  return { inlineData: { data: base64, mimeType } }
}

export async function toInlineImagePartFromUrl(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch image url ${url}: ${res.status}`)
  const mimeType = res.headers.get('content-type') || 'image/png'
  const buf = new Uint8Array(await res.arrayBuffer())
  return toInlineImagePartFromBytes(buf, mimeType)
}

export async function generateJson({ modelName, systemInstruction, temperature = 0.2, seed = 7, parts }: { modelName: string; systemInstruction: string; temperature?: number; seed?: number; parts: any[] }) {
  const genai = getGeminiClient()
  const model = genai.getGenerativeModel({ model: modelName, systemInstruction })
  const result = await model.generateContent({ contents: [{ role: 'user', parts }], generationConfig: { temperature, seed, responseMimeType: 'application/json' } })
  const text = result.response?.text?.() || ''
  return text
}

export async function generateText({ modelName, systemInstruction, temperature = 0.2, seed = 7, parts }: { modelName: string; systemInstruction: string; temperature?: number; seed?: number; parts: any[] }) {
  const genai = getGeminiClient()
  const model = genai.getGenerativeModel({ model: modelName, systemInstruction })
  const result = await model.generateContent({ contents: [{ role: 'user', parts }], generationConfig: { temperature, seed } })
  const text = result.response?.text?.() || ''
  return text
}

export async function generateImage({ modelName, systemInstruction, temperature = 0.1, seed = 7, parts }: { modelName: string; systemInstruction: string; temperature?: number; seed?: number; parts: any[] }) {
  const genai = getGeminiClient()
  const model = genai.getGenerativeModel({ model: modelName, systemInstruction })
  const result: any = await model.generateContent({ contents: [{ role: 'user', parts }], generationConfig: { temperature, seed } })
  // Find first inline image
  const candidates = result?.response?.candidates || []
  for (const cand of candidates) {
    const partsResp = cand?.content?.parts || []
    for (const p of partsResp) {
      if (p?.inlineData?.data) {
        const b64 = p.inlineData.data as string
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
        const mime = p.inlineData.mimeType || 'image/png'
        return { bytes, mime }
      }
    }
  }
  throw new Error('No image returned from model')
}


