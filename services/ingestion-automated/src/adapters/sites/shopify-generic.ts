// Generic Shopify filter for stores not matched by a specific profile.
// Works JSON-only (no HTML needed): filters the LLM-extracted images to Shopify CDN URLs,
// then deduplicates by base asset key, keeping the highest-resolution variant.
import {
  looksLikeShopifyImageUrl,
  shopifyBaseAssetKey,
  parseShopifyResolutionScore,
  dedupeByResolution,
} from './shared';

export function isShopifySite(imageUrls: string[]): boolean {
  if (imageUrls.length === 0) return false;
  const shopifyCount = imageUrls.filter(looksLikeShopifyImageUrl).length;
  return shopifyCount / imageUrls.length >= 0.5;
}

export function extractShopifyGenericImages(jsonImages: string[]): string[] {
  const filtered = jsonImages.filter(looksLikeShopifyImageUrl);
  if (filtered.length === 0) return jsonImages;
  return dedupeByResolution(filtered, shopifyBaseAssetKey, parseShopifyResolutionScore);
}
