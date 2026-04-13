# Multimodal Fashion Search Guide

Complete guide to the dual-retrieval fusion search system using Fashion-SigLIP embeddings.

## Overview

The search API provides a **multi-modal `/search` endpoint** that accepts:
- **Text search**: `?q=<query>` - searches using text description
- **Image search**: `?imageUrl=<image_url>` - searches using visual similarity
- **Combined search**: `?q=<query>&imageUrl=<image_url>` - combines both for better results

**How it works:**
1. Each search type retrieves 20 candidates independently
2. Results are combined with score boosting for products found in multiple searches
3. Top 20 products returned, sorted by combined score

All searches use Fashion-SigLIP dual-retrieval: encoding queries into 768-dim vectors and retrieving candidates from both text and image embeddings, then fusing scores for optimal results.

## Quick Start

```bash
# 1. Start the search server
node search-server.js

# 2. Text search
curl "http://localhost:8788/search?q=blue+jeans"

# 3. Image search
curl "http://localhost:8788/search?imageUrl=https://example.com/image.jpg"

# 4. Combined search (text + image)
curl "http://localhost:8788/search?q=blue+jeans&imageUrl=https://example.com/image.jpg"
```

## Table of Contents
1. [Database Setup](#database-setup)
2. [Generating Product Embeddings](#generating-product-embeddings)
3. [Search Implementation](#search-implementation)
4. [Search Types](#search-types)
5. [API Usage](#api-usage)

---

## Database Setup

### 1. Add Vector Columns to Products Table

**Migration:** `supabase/migrations/20251207010031_add_multimodal_vectors_to_products.sql`

```sql
-- Add text and image vector columns (768 dimensions for Fashion-SigLIP)
ALTER TABLE products 
ADD COLUMN text_vector vector(768),
ADD COLUMN image_vector vector(768);

-- Create IVFFlat indexes for fast similarity search using cosine distance
CREATE INDEX IF NOT EXISTS products_text_vector_idx 
ON products USING ivfflat (text_vector vector_cosine_ops) 
WITH (lists = 100);

CREATE INDEX IF NOT EXISTS products_image_vector_idx 
ON products USING ivfflat (image_vector vector_cosine_ops) 
WITH (lists = 100);
```

**Key Points:**
- **Dimensions:** 768 (Fashion-SigLIP output size)
- **Index Type:** IVFFlat with `vector_cosine_ops` for cosine distance
- **Lists:** 100 (good for ~10K products; adjust based on dataset size)

### 2. Create RPC Functions for Vector Search

**Migration:** `supabase/migrations/20251207030000_add_dual_retrieval_functions.sql`

```sql
-- Text-based search function
CREATE OR REPLACE FUNCTION match_products_text(
  query_embedding vector(768),
  match_threshold float DEFAULT 0.0,
  match_count int DEFAULT 50
)
RETURNS TABLE (
  id text,
  product_name text,
  brand text,
  color text,
  type_category text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id::text,
    p.product_name,
    p.brand,
    p.color,
    p.type_category,
    1 - (p.text_vector <=> query_embedding) as similarity
  FROM products p
  WHERE p.text_vector IS NOT NULL
    AND 1 - (p.text_vector <=> query_embedding) > match_threshold
  ORDER BY p.text_vector <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Image-based search function
CREATE OR REPLACE FUNCTION match_products_image(
  query_embedding vector(768),
  match_threshold float DEFAULT 0.0,
  match_count int DEFAULT 50
)
RETURNS TABLE (
  id text,
  product_name text,
  brand text,
  color text,
  type_category text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id::text,
    p.product_name,
    p.brand,
    p.color,
    p.type_category,
    1 - (p.image_vector <=> query_embedding) as similarity
  FROM products p
  WHERE p.image_vector IS NOT NULL
    AND 1 - (p.image_vector <=> query_embedding) > match_threshold
  ORDER BY p.image_vector <=> query_embedding
  LIMIT match_count;
END;
$$;
```

**Key Points:**
- **Distance Operator:** `<=>` (cosine distance)
- **Similarity Calculation:** `1 - distance` (higher is better)
- **Default Limit:** 50 candidates per modality
- **Ordering:** By distance (ascending = most similar first)

---

## Generating Product Embeddings

### Script: `scripts/generate-fashion-siglip-embeddings-local.js`

This script generates both text and image embeddings for all products using the Marqo/marqo-fashionSigLIP model.

**Important:** This script will **regenerate embeddings for ALL products**, even if they already have embeddings. This ensures embeddings are always up-to-date with the latest model and product data.

### Usage

```bash
# Install dependencies (if not already done)
bun install

# Run the embedding generation script
bun run scripts/generate-fashion-siglip-embeddings-local.js
```

### How It Works

```javascript
import { pipeline, AutoTokenizer } from '@huggingface/transformers';
import { createClient } from '@supabase/supabase-js';

// 1. Initialize models
const textModel = await pipeline(
  'feature-extraction',
  'Marqo/marqo-fashionSigLIP',
  { quantized: false }
);

const visionModel = await pipeline(
  'image-feature-extraction',
  'Marqo/marqo-fashionSigLIP',
  { quantized: false }
);

const tokenizer = await AutoTokenizer.from_pretrained('Marqo/marqo-fashionSigLIP');

// 2. Fetch all products from database
const { data: products } = await supabase
  .from('products')
  .select('id, name, description, image_url');

// 3. For each product, generate embeddings
for (const product of products) {
  // Text embedding: concatenate name + description
  const textInput = `${product.name} ${product.description || ''}`.trim();
  const tokens = await tokenizer(textInput, {
    padding: true,
    truncation: true,
    return_tensors: 'pt'
  });
  const textOutput = await textModel(tokens);
  const textVector = textOutput[0].normalize().tolist();
  
  // Image embedding: from product image URL
  const imageOutput = await visionModel(product.image_url);
  const imageVector = imageOutput[0].image_embeds.normalize().tolist();
  
  // 4. Update product with both vectors
  await supabase
    .from('products')
    .update({
      text_vector: textVector,
      image_vector: imageVector
    })
    .eq('id', product.id);
}
```

**Key Points:**
- **Text Input:** Combines product name + description + fit + feel + color + vibes + type_category
- **Image Input:** Direct product image URL
- **Normalization:** Both embeddings are L2-normalized
- **Batch Processing:** Processes products in batches of 20
- **Regeneration:** Always regenerates embeddings even if they already exist
- **Output:** 768-dimensional vectors for both modalities

### Verification

```bash
# Check how many products have embeddings
psql $DATABASE_URL -c "SELECT 
  COUNT(*) as total,
  COUNT(text_vector) as with_text_vector,
  COUNT(image_vector) as with_image_vector
FROM products;"
```

Expected output:
```
 total | with_text_vector | with_image_vector 
-------+------------------+-------------------
   317 |              317 |               317
```

---

## Search Implementation

### Architecture

```
┌─────────────────┐
│   User Query    │
│  (text/image)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Encode Query   │
│  to 768-dim     │
│     vector      │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│     Dual Retrieval (Top 50 each)    │
│                                     │
│  ┌───────────┐     ┌─────────────┐ │
│  │   Text    │     │    Image    │ │
│  │ Candidates│     │  Candidates │ │
│  └─────┬─────┘     └──────┬──────┘ │
└────────┼──────────────────┼────────┘
         │                  │
         └────────┬─────────┘
                  ▼
         ┌────────────────┐
         │ Normalize      │
         │ Scores [0,1]   │
         └────────┬───────┘
                  │
                  ▼
         ┌────────────────┐
         │ Merge & Fuse   │
         │ (weighted sum) │
         └────────┬───────┘
                  │
                  ▼
         ┌────────────────┐
         │  Return Top 20 │
         └────────────────┘
```

### Core Functions

Location: `lib/search.js`

#### 1. Model Initialization

```javascript
let textModel, visionModel, tokenizer, imageProcessor;

async function initializeModels() {
  if (textModel && visionModel && tokenizer && imageProcessor) {
    return { textModel, visionModel, tokenizer, imageProcessor };
  }

  const { pipeline, AutoTokenizer, AutoProcessor } = await import('@huggingface/transformers');
  
  textModel = await pipeline(
    'feature-extraction',
    'Marqo/marqo-fashionSigLIP',
    { quantized: false }
  );
  
  visionModel = await pipeline(
    'image-feature-extraction',
    'Marqo/marqo-fashionSigLIP',
    { quantized: false }
  );
  
  tokenizer = await AutoTokenizer.from_pretrained('Marqo/marqo-fashionSigLIP');
  imageProcessor = await AutoProcessor.from_pretrained('Marqo/marqo-fashionSigLIP');
  
  return { textModel, visionModel, tokenizer, imageProcessor };
}
```

#### 2. Text Query Encoding

```javascript
async function encodeTextQuery(query) {
  const { tokenizer, textModel } = await initializeModels();
  
  const tokens = await tokenizer(query, {
    padding: true,
    truncation: true,
    return_tensors: 'pt'
  });
  
  const output = await textModel(tokens);
  return output[0].normalize().tolist();
}
```

#### 3. Image Query Encoding

```javascript
async function encodeImageQuery(imageUrl) {
  const { imageProcessor, visionModel } = await initializeModels();
  
  // Get image as RawImage for Transformers.js
  const { RawImage } = await import('@huggingface/transformers');
  const image = await RawImage.fromURL(imageUrl);
  
  // Process and encode
  const inputs = await imageProcessor(image);
  const output = await visionModel(inputs);
  return output.image_embeds.normalize().tolist()[0];
}
```

**Important:** Only direct image URLs are supported (e.g., `.jpg`, `.png`, `.webp`). To get a direct URL: right-click image → "Copy image address".

#### 4. Fetch Candidates

```javascript
async function fetchTextCandidates(queryVector, matchCount = 50) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.rpc('match_products_text', {
    query_embedding: queryVector,
    match_count: matchCount,
    match_threshold: 0.0
  });
  
  if (error) throw error;
  return data || [];
}

async function fetchImageCandidates(queryVector, matchCount = 50) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.rpc('match_products_image', {
    query_embedding: queryVector,
    match_count: matchCount,
    match_threshold: 0.0
  });
  
  if (error) throw error;
  return data || [];
}
```

#### 5. Score Normalization

```javascript
function normalizeScores(candidates) {
  if (candidates.length === 0) return [];
  
  const scores = candidates.map(c => c.similarity);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const range = maxScore - minScore;
  
  if (range === 0) {
    return candidates.map(c => ({ ...c, similarity: 1.0 }));
  }
  
  return candidates.map(c => ({
    ...c,
    similarity: (c.similarity - minScore) / range
  }));
}
```

#### 6. Merge Candidates

```javascript
function mergeCandidates(textCandidates, imageCandidates) {
  const productMap = new Map();
  
  // Add text candidates
  for (const product of textCandidates) {
    productMap.set(product.id, {
      ...product,
      text_score: product.similarity,
      image_score: 0
    });
  }
  
  // Add/merge image candidates
  for (const product of imageCandidates) {
    if (productMap.has(product.id)) {
      productMap.get(product.id).image_score = product.similarity;
    } else {
      productMap.set(product.id, {
        ...product,
        text_score: 0,
        image_score: product.similarity
      });
    }
  }
  
  return Array.from(productMap.values());
}
```

#### 7. Fuse Scores

```javascript
function fuseScores(candidates, textWeight, imageWeight) {
  return candidates.map(product => ({
    ...product,
    final_score: (product.text_score * textWeight) + (product.image_score * imageWeight)
  }));
}
```

---

## Search Types

### 1. Text Search (Default)

**Weights:** 65% text, 35% image  
**Use Case:** User provides a text query like "blue jeans" or "red summer dress"

```javascript
async function searchProducts(query, limit = 20) {
  // 1. Encode text query
  const queryVector = await encodeTextQuery(query);
  
  // 2. Get top 50 from each modality
  const textCandidates = await fetchTextCandidates(queryVector, 50);
  const imageCandidates = await fetchImageCandidates(queryVector, 50);
  
  // 3. Normalize scores to [0, 1]
  const normalizedText = normalizeScores(textCandidates);
  const normalizedImage = normalizeScores(imageCandidates);
  
  // 4. Merge candidates
  const merged = mergeCandidates(normalizedText, normalizedImage);
  
  // 5. Fuse with 65% text, 35% image
  const fused = fuseScores(merged, 0.65, 0.35);
  
  // 6. Sort and return top N
  return fused
    .sort((a, b) => b.final_score - a.final_score)
    .slice(0, limit);
}
```

**Example:**
```bash
curl "http://localhost:8788/search?q=blue+jeans"
```

**Response:**
```json
{
  "query": "blue jeans",
  "query_type": "text",
  "total_candidates": 91,
  "results": [
    {
      "id": "WIDE HIGH JEANS_w",
      "product_name": "WIDE HIGH JEANS",
      "brand": "H&M",
      "color": "Light denim blue",
      "type_category": null,
      "text_score": 0.7837,
      "text_score_norm": 1,
      "image_score": 0.0958,
      "image_score_norm": 0.9959,
      "final_score": 0.9986
    },
    ...
  ]
}
```

**Response Fields:**
- `query` - The original text query
- `query_type` - Always "text" for text search
- `total_candidates` - Number of unique products found
- `results` - Array of top 20 products (sorted by `final_score`)
  - `id` - Unique product identifier
  - `product_name` - Product name
  - `brand` - Product brand
  - `color` - Product color
  - `type_category` - Product category (may be null)
  - `text_score` - Raw similarity score from text vector (0-1)
  - `text_score_norm` - Normalized text score (0-1)
  - `image_score` - Raw similarity score from image vector (0-1)
  - `image_score_norm` - Normalized image score (0-1)
  - `final_score` - Weighted fusion score: 65% text + 35% image

### 2. Image Search

**Weights:** 35% text, 65% image  
**Use Case:** User provides an image URL (e.g., from another website, screenshot)

```javascript
async function searchProductsByImage(imageUrl, limit = 20) {
  // 1. Encode image query
  const queryVector = await encodeImageQuery(imageUrl);
  
  // 2. Get top 50 from each modality
  const textCandidates = await fetchTextCandidates(queryVector, 50);
  const imageCandidates = await fetchImageCandidates(queryVector, 50);
  
  // 3. Normalize scores to [0, 1]
  const normalizedText = normalizeScores(textCandidates);
  const normalizedImage = normalizeScores(imageCandidates);
  
  // 4. Merge candidates
  const merged = mergeCandidates(normalizedText, normalizedImage);
  
  // 5. Fuse with 35% text, 65% image
  const fused = fuseScores(merged, 0.35, 0.65);
  
  // 6. Sort and return top N
  return fused
    .sort((a, b) => b.final_score - a.final_score)
    .slice(0, limit);
}
```

**Example:**
```bash
curl "http://localhost:8788/search?imageUrl=https://t3.ftcdn.net/jpg/04/83/25/50/360_F_483255019_m1r1ujM8EOkr8PamCHF85tQ0rHG3Fiqz.jpg"
```

**Response:**
```json
{
  "query": "https://t3.ftcdn.net/jpg/04/83/25/50/360_F_483255019_m1r1ujM8EOkr8PamCHF85tQ0rHG3Fiqz.jpg",
  "query_type": "image",
  "total_candidates": 70,
  "results": [
    {
      "id": "WIDE HIGH JEANS_w",
      "product_name": "WIDE HIGH JEANS",
      "brand": "H&M",
      "color": "Light denim blue",
      "type_category": null,
      "text_score": 0.0935,
      "text_score_norm": 1,
      "image_score": 0.7321,
      "image_score_norm": 0.9301,
      "final_score": 0.9546
    },
    ...
  ]
}
```

**Response Fields:**
- `query` - The original image URL
- `query_type` - Always "image" for image search
- `total_candidates` - Number of unique products found
- `results` - Array of top 20 products (sorted by `final_score`)
  - Same fields as text search
  - `final_score` - Weighted fusion score: 35% text + 65% image

### 3. Hybrid Search

**Weights:** Average of text search and image search results  
**Use Case:** User provides both text query AND image URL

```javascript
async function searchProductsHybrid(query, imageUrl, limit = 20) {
  // 1. Run both searches independently
  const textSearchResults = await searchProducts(query, 20);
  const imageSearchResults = await searchProductsByImage(imageUrl, 20);
  
  // 2. Merge results and average scores
  const productMap = new Map();
  
  for (const product of textSearchResults) {
    productMap.set(product.id, {
      ...product,
      text_final_score: product.final_score,
      image_final_score: 0,
      count: 1
    });
  }
  
  for (const product of imageSearchResults) {
    if (productMap.has(product.id)) {
      const existing = productMap.get(product.id);
      existing.image_final_score = product.final_score;
      existing.count = 2;
    } else {
      productMap.set(product.id, {
        ...product,
        text_final_score: 0,
        image_final_score: product.final_score,
        count: 1
      });
    }
  }
  
  // 3. Calculate hybrid score (average)
  const hybridResults = Array.from(productMap.values()).map(product => ({
    ...product,
    hybrid_score: (product.text_final_score + product.image_final_score) / 2
  }));
  
  // 4. Sort and return top N
  return hybridResults
    .sort((a, b) => b.hybrid_score - a.hybrid_score)
    .slice(0, limit);
}
```

**Example:**
```bash
curl "http://localhost:8788/search?q=blue+jeans&imageUrl=https://t3.ftcdn.net/jpg/04/83/25/50/360_F_483255019_m1r1ujM8EOkr8PamCHF85tQ0rHG3Fiqz.jpg"
```

**Response:**
```json
{
  "query_text": "blue jeans",
  "query_image": "https://t3.ftcdn.net/jpg/04/83/25/50/360_F_483255019_m1r1ujM8EOkr8PamCHF85tQ0rHG3Fiqz.jpg",
  "query_type": "hybrid",
  "total_candidates": 28,
  "results": [
    {
      "id": "WIDE HIGH JEANS_w",
      "product_name": "WIDE HIGH JEANS",
      "brand": "H&M",
      "color": "Light denim blue",
      "type_category": null,
      "text_score": 0.7837,
      "text_score_norm": 1,
      "image_score": 0.0958,
      "image_score_norm": 0.9959,
      "final_score": 0.9986,
      "text_final_score": 0.9986,
      "image_final_score": 0.9546,
      "sources": ["text", "image"],
      "hybrid_score": 0.9766,
      "in_both": true
    },
    ...
  ]
}
```

**Response Fields:**
- `query_text` - The original text query
- `query_image` - The original image URL
- `query_type` - Always "hybrid" for hybrid search
- `total_candidates` - Number of unique products from both searches
- `results` - Array of top 20 products (sorted by `hybrid_score`)
  - All fields from text and image searches
  - `text_final_score` - Final score from text search (0-1)
  - `image_final_score` - Final score from image search (0-1)
  - `sources` - Array indicating which searches found this product
  - `hybrid_score` - Average of text_final_score and image_final_score
  - `in_both` - Boolean indicating if product was in both top-20 results

---

## API Usage

### Starting the Server

```bash
# Start the search server on port 8788
node search-server.js
```

Server logs:
```
🚀 Fashion Search API running on http://localhost:8788

Multi-Modal Search:
📝 Text:      http://localhost:8788/search?q=<query>
🖼️  Image:     http://localhost:8788/search?imageUrl=<image_url>
🔀 Combined:  http://localhost:8788/search?q=<query>&imageUrl=<image_url>
💚 Health:    http://localhost:8788/health
```

### Multi-Modal Search Endpoint

The server provides a **single `/search` endpoint** that accepts:

- `q` → Text search
- `imageUrl` → Image search  
- Both → Combined multi-modal search with score fusion

**How Combined Search Works:**
1. Each search type retrieves 20 candidates independently
2. Results are merged with score boosting:
   - Products in 1 source: base score
   - Products in 2 sources: 2x score boost (highest priority)
3. Top 20 products returned, sorted by combined score

**Response Format (Standardized for all search types):**
```json
{
  "query_text": "red dress",
  "query_image": "https://...",
  "query_url": "https://...",
  "query_type": "text+image",
  "search_types": ["text", "image"],
  "total_candidates": 35,
  "results": [
    {
      "id": "PRODUCT_ID",
      "product_name": "Product Name",
      "brand": "Brand Name",
      "color": "Red",
      "type_category": "dress",
      "text_score": 0.65,
      "text_score_norm": 1.0,
      "image_score": 0.62,
      "image_score_norm": 0.95,
      "combined_score": 1.62,
      "sources": ["text", "image"],
      "source_count": 2,
      "text_search_score": 0.58,
      "image_search_score": 0.54
    }
  ]
}
```

**Result Fields (Consistent Across All Search Types):**
- `id` - Product identifier
- `product_name` - Product name
- `brand` - Brand name
- `color` - Product color
- `type_category` - Product category (may be null)
- `text_score` - Raw text vector similarity (0-1, null if not computed)
- `text_score_norm` - Normalized text score (0-1, null if not computed)
- `image_score` - Raw image vector similarity (0-1, null if not computed)
- `image_score_norm` - Normalized image score (0-1, null if not computed)
- `combined_score` - Sum of scores from all searches that found this product
- `sources` - Array of search types that found this product ["text", "image"]
- `source_count` - Number of searches that found this product (1-2)
- `text_search_score` - Final score from text search (present only if found via text)
- `image_search_score` - Final score from image search (present only if found via image)


**Score Ranges:**
- **Single source (text OR image):** 0.18 to 0.65
  - Normalized similarity score from Fashion-SigLIP embeddings
- **Multi-source combination:**
  - 2 sources: 0.36 to 1.30 (scores summed)
- **Higher `combined_score`** = found in more search types = more universally relevant product

#### 1. Text Search

```bash
# Basic text search
curl "http://localhost:8788/search?q=red+dress"
```

#### 2. Image Search

```bash
# Direct image URL
curl "http://localhost:8788/search?imageUrl=https://cdn.example.com/product.jpg"
```

**Important:** Use `imageUrl` parameter. Must be a direct image URL.

#### 3. Text + Image (Combined Search)

```bash
curl "http://localhost:8788/search?q=summer+dress&imageUrl=https://cdn.example.com/dress.jpg"
```

**Result:** Products appearing in both searches get higher scores (2x boost).

#### 4. Health Check

```bash
curl "http://localhost:8788/health"
```

Response:
```json
{
  "ok": true,
  "service": "Fashion Search API"
}
```

### Error Handling

All endpoints return consistent error format:

```json
{
  "error": "Missing parameters",
  "message": "Provide at least one: \"q\" (text), \"imageUrl\" (image), or \"url\" (product page)"
}
```

Common errors:
- **Missing parameters:** Must provide at least one of `q` or `imageUrl`
- **Invalid image URL:** Image URL must be a direct link to an image file
- **Model loading errors:** Models fail to initialize (check logs)
- **Database errors:** RPC function failures or connection issues

---

## Performance Notes

### Indexing
- **IVFFlat:** Fast approximate search, good for 1K-1M items
- **Lists Parameter:** Set to `sqrt(num_rows)` for optimal performance
  - 317 products → 100 lists (current)
  - 10K products → 100 lists
  - 100K products → 316 lists
  - 1M products → 1000 lists

### Query Speed
- **Text encoding:** ~50-100ms (CPU)
- **Image encoding:** ~200-400ms (CPU)
- **Database lookup:** ~10-50ms per modality
- **Total latency:** 
  - Text search: ~150-250ms
  - Image search: ~400-600ms
  - Hybrid search: ~600-900ms

### Scaling Tips
1. **Use quantized models** for faster inference (set `quantized: true`)
2. **Increase `lists`** as dataset grows
3. **Cache embeddings** for common queries
4. **Use GPU** for encoding (if available)
5. **Batch process** multiple queries together

---

## Testing

### 1. Test Text Search

```bash
# Search for blue jeans
curl "http://localhost:8788/search?q=blue+jeans"

# Search for red summer dress
curl "http://localhost:8788/search?q=red+summer+dress"

# Search for running shoes
curl "http://localhost:8788/search?q=running+shoes"
```

### 2. Test Image Search

```bash
# Use a direct image URL (stock photo)
curl "http://localhost:8788/search?imageUrl=https://t3.ftcdn.net/jpg/04/83/25/50/360_F_483255019_m1r1ujM8EOkr8PamCHF85tQ0rHG3Fiqz.jpg"

# Use a product image (must be direct URL ending in .jpg, .png, etc.)
curl "http://localhost:8788/search?imageUrl=https://cdn.shopify.com/product-123.jpg"
```

### 3. Test Combined Search

```bash
# Combine text and image
curl "http://localhost:8788/search?q=blue+jeans&imageUrl=https://t3.ftcdn.net/jpg/04/83/25/50/360_F_483255019_m1r1ujM8EOkr8PamCHF85tQ0rHG3Fiqz.jpg"

# Another example
curl "http://localhost:8788/search?q=casual+jacket&imageUrl=https://cdn.example.com/jacket.jpg"
```

### 4. Verify Database

```bash
# Check vector coverage
psql $DATABASE_URL -c "
SELECT 
  COUNT(*) as total_products,
  COUNT(text_vector) as have_text_embeddings,
  COUNT(image_vector) as have_image_embeddings,
  COUNT(CASE WHEN text_vector IS NOT NULL AND image_vector IS NOT NULL THEN 1 END) as have_both
FROM products;
"
```

Expected output:
```
 total_products | have_text_embeddings | have_image_embeddings | have_both 
----------------+----------------------+-----------------------+-----------
            317 |                  317 |                   317 |       317
```

---

## Troubleshooting

### Models not loading
```bash
# Clear cache and reinstall
rm -rf node_modules/.cache
bun install
```

### Database connection issues
```bash
# Check environment variables
echo $SUPABASE_URL
echo $SUPABASE_ANON_KEY

# Test connection
psql $DATABASE_URL -c "SELECT COUNT(*) FROM products;"
```

### Image URL not working
```bash
# Verify it's a direct image URL
curl -I "https://example.com/image.jpg"
# Should return Content-Type: image/jpeg

# If it's a product page, get the direct image:
# 1. Open page in browser
# 2. Right-click image → "Copy image address"
# 3. Use that URL instead
```

### Slow queries
```bash
# Check index usage
psql $DATABASE_URL -c "
EXPLAIN ANALYZE
SELECT id, name, image_url, 1 - (text_vector <=> '[0.1, 0.2, ...]'::vector) as similarity
FROM products
WHERE text_vector IS NOT NULL
ORDER BY text_vector <=> '[0.1, 0.2, ...]'::vector
LIMIT 50;
"

# Should see "Index Scan using products_text_vector_idx"
```

---

## Summary

### Key Concepts
1. **Unified Endpoint:** Single `/search` endpoint auto-detects search type from parameters
2. **Dual Retrieval:** Get candidates from both text and image similarity
3. **Fusion:** Combine scores with configurable weights
4. **Cosine Distance:** Measure similarity between vectors
5. **Fashion-SigLIP:** CLIP-style model trained on fashion data

### Search Weights
- **Text Search** (`?q=...`): 65% text, 35% image - prioritizes textual match
- **Image Search** (`?imageUrl=...`): 35% text, 65% image - prioritizes visual match
- **Hybrid Search** (`?q=...&imageUrl=...`): Averages both search results

### API Endpoints
```bash
# All searches use the same unified endpoint:
GET http://localhost:8788/search

# Parameters:
#   q=<text_query>        - Text search query
#   imageUrl=<image_url>  - Direct image URL (.jpg, .png, .webp)
#   Both parameters       - Hybrid search

# Examples:
curl "http://localhost:8788/search?q=blue+jeans"
curl "http://localhost:8788/search?imageUrl=https://example.com/image.jpg"
curl "http://localhost:8788/search?q=blue+jeans&imageUrl=https://example.com/image.jpg"
```

### Files Reference
- `search-server.js` - Unified API server (port 8788)
- `lib/search.js` - Core search logic (text, image, hybrid)
- `supabase/migrations/20251207010031_add_multimodal_vectors_to_products.sql` - Vector columns
- `supabase/migrations/20251207030000_add_dual_retrieval_functions.sql` - RPC functions
- `supabase/migrations/20251207040000_add_vector_versioning.sql` - Versioning & triggers
- `scripts/generate-fashion-siglip-embeddings-local.js` - Full embedding regeneration
- `scripts/embedding-update.js` - Incremental embedding updates
- `.github/workflows/daily-embedding-update.yml` - Automated daily updates

### Next Steps
1. Generate embeddings for all products (`bun run scripts/generate-fashion-siglip-embeddings-local.js`)
2. Test each search type using the unified endpoint
3. Monitor query performance and latency
4. Tune weights based on user feedback
5. Scale indexes as dataset grows (adjust `lists` parameter)

---

## Embedding Update System

### Overview

The system maintains embeddings with automatic version control and incremental updates:

**Database Fields:**
- `text_vector` (vector[768]) - Text embedding from product fields
- `image_vector` (vector[768]) - Image embedding from product image
- `vector_version` (int) - Embedding model version (manually incremented)
- `embedded_at` (timestamp) - Last successful embedding time

### Automatic Updates

**Triggers automatically nullify vectors when data changes:**
- Text fields change (name, description, color, type, fit, feel, vibes) → `text_vector = NULL`
- Image URL changes → `image_vector = NULL`

**Daily automated updates (2 AM UTC via GitHub Actions):**
```bash
bun run embedding:update
```

This processes products where:
- `text_vector IS NULL` OR
- `image_vector IS NULL` OR
- `vector_version != CURRENT_VECTOR_VERSION` OR
- `updated_at > embedded_at`

### Manual Operations

**Full regeneration (force re-embed everything):**
```bash
bun run scripts/generate-fashion-siglip-embeddings-local.js
```

**Incremental update (only changed/missing):**
```bash
bun run embedding:update
```

**Version upgrade process:**
1. Edit `scripts/embedding-update.js`
2. Change `CURRENT_VECTOR_VERSION` from 1 to 2
3. Run `bun run embedding:update` (will re-embed all products)

### Monitoring

**Check update status:**
```sql
-- Products needing updates
SELECT COUNT(*) as needs_update
FROM products
WHERE text_vector IS NULL 
   OR image_vector IS NULL 
   OR vector_version != 1
   OR updated_at > embedded_at;

-- Embedding coverage
SELECT 
  COUNT(*) as total,
  COUNT(text_vector) as have_text,
  COUNT(image_vector) as have_image,
  MAX(vector_version) as current_version,
  MAX(embedded_at) as last_update
FROM products;
```

**Performance:** ~300-500ms per product (20 products/batch, 3-second pause between batches)

### Configuration

**GitHub Actions Schedule:**
Edit `.github/workflows/daily-embedding-update.yml`:
```yaml
schedule:
  - cron: '0 2 * * *'  # Daily at 2 AM UTC
```

**Required Secrets:**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_SERVICE_ROLE_KEY`

**Batch Settings:**
Edit `scripts/embedding-update.js`:
```javascript
const BATCH_SIZE = 20;        // Products per batch
const RETRY_LIMIT = 3;        // Retries for failed images
const BATCH_DELAY_MS = 3000;  // Pause between batches
```

### How New Products Are Handled

1. New product inserted with `text_vector = NULL`, `image_vector = NULL`
2. Daily cron job picks it up automatically
3. Embeddings generated and saved with version + timestamp
4. Product becomes searchable within 24 hours

**For immediate processing:**
```bash
bun run embedding:update
```

---
