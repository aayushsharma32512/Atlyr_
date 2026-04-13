import { createClient } from '@supabase/supabase-js';
import { AutoTokenizer, SiglipTextModel, AutoProcessor, SiglipVisionModel } from '@huggingface/transformers';

const MODEL_NAME = 'Marqo/marqo-fashionSigLIP';
let tokenizer = null;
let textModel = null;
let imageProcessor = null;
let visionModel = null;

// Initialize Fashion-SigLIP models
export async function initializeModels() {
  if (tokenizer && textModel && imageProcessor && visionModel) {
    return { tokenizer, textModel, imageProcessor, visionModel };
  }
  
  console.log('🔄 Loading Fashion-SigLIP models...');
  tokenizer = await AutoTokenizer.from_pretrained(MODEL_NAME);
  textModel = await SiglipTextModel.from_pretrained(MODEL_NAME);
  imageProcessor = await AutoProcessor.from_pretrained(MODEL_NAME);
  visionModel = await SiglipVisionModel.from_pretrained(MODEL_NAME);
  console.log('✅ Models loaded');
  
  return { tokenizer, textModel, imageProcessor, visionModel };
}

// Encode text query to 768-dim vector
async function encodeTextQuery(queryText) {
  const { tokenizer, textModel } = await initializeModels();
  const inputs = await tokenizer([queryText], {
    padding: 'max_length',
    truncation: true,
  });
  const output = await textModel(inputs);
  return output.text_embeds.normalize().tolist()[0];
}

// Encode image URL to 768-dim vector (direct image URLs only)
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

// Fetch top 50 products by text similarity
async function fetchTextCandidates(supabase, queryVec) {
  const { data, error } = await supabase.rpc('match_products_text', {
    query_embedding: queryVec,
    match_threshold: 0,
    match_count: 50,
  });

  if (error) throw error;

  return data.map((item) => ({
    id: item.id,
    product_name: item.product_name,
    brand: item.brand,
    color: item.color,
    type_category: item.type_category,
    text_score: item.similarity,
  }));
}

// Fetch top 50 products by image similarity
async function fetchImageCandidates(supabase, queryVec) {
  const { data, error } = await supabase.rpc('match_products_image', {
    query_embedding: queryVec,
    match_threshold: 0,
    match_count: 50,
  });

  if (error) throw error;

  return data.map((item) => ({
    id: item.id,
    product_name: item.product_name,
    brand: item.brand,
    color: item.color,
    type_category: item.type_category,
    image_score: item.similarity,
  }));
}

// Normalize scores to [0, 1]
function normalizeScores(results, scoreKey) {
  if (results.length === 0) return results;

  const scores = results.map((r) => r[scoreKey]);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const range = maxScore - minScore;

  return results.map((r) => ({
    ...r,
    [`${scoreKey}_norm`]: range === 0 ? 1.0 : (r[scoreKey] - minScore) / range,
  }));
}

// Merge text and image candidates, deduplicate by ID
function mergeCandidates(textResults, imageResults) {
  const merged = new Map();

  for (const item of textResults) {
    merged.set(item.id, { 
      ...item, 
      image_score: item.image_score || null,
      image_score_norm: 0 
    });
  }

  for (const item of imageResults) {
    if (merged.has(item.id)) {
      const existing = merged.get(item.id);
      existing.image_score = item.image_score;
      existing.image_score_norm = item.image_score_norm;
    } else {
      merged.set(item.id, { 
        ...item, 
        text_score: item.text_score || null,
        text_score_norm: 0 
      });
    }
  }

  return Array.from(merged.values());
}

// Fuse scores with configurable weights
function fuseScores(candidates, textWeight = 0.65, imageWeight = 0.35) {
  return candidates.map((item) => ({
    ...item,
    final_score:
      textWeight * (item.text_score_norm || 0) +
      imageWeight * (item.image_score_norm || 0),
  }));
}

// Text-based search (text query → text + image vectors, 65% text weight)
export async function searchProducts(supabase, queryText) {
  console.log(`🔍 Text search for: "${queryText}"`);

  const queryVec = await encodeTextQuery(queryText);

  const [textResults, imageResults] = await Promise.all([
    fetchTextCandidates(supabase, queryVec),
    fetchImageCandidates(supabase, queryVec),
  ]);

  const textNormalized = normalizeScores(textResults, 'text_score');
  const imageNormalized = normalizeScores(imageResults, 'image_score');

  const merged = mergeCandidates(textNormalized, imageNormalized);
  console.log(`📊 ${textResults.length} text + ${imageResults.length} image → ${merged.length} merged`);

  const fused = fuseScores(merged, 0.65, 0.35); // Text-first: 65% text, 35% image
  const sorted = fused.sort((a, b) => b.final_score - a.final_score);
  const top20 = sorted.slice(0, 20);

  return {
    query: queryText,
    query_type: 'text',
    total_candidates: merged.length,
    results: top20,
  };
}

// Image-based search (image URL → text + image vectors, 65% image weight)
export async function searchProductsByImage(supabase, imageUrl) {
  console.log(`🖼️  Image search for: "${imageUrl}"`);

  const queryVec = await encodeImageQuery(imageUrl);

  const [textResults, imageResults] = await Promise.all([
    fetchTextCandidates(supabase, queryVec),
    fetchImageCandidates(supabase, queryVec),
  ]);

  const textNormalized = normalizeScores(textResults, 'text_score');
  const imageNormalized = normalizeScores(imageResults, 'image_score');

  const merged = mergeCandidates(textNormalized, imageNormalized);
  console.log(`📊 ${textResults.length} text + ${imageResults.length} image → ${merged.length} merged`);

  const fused = fuseScores(merged, 0.35, 0.65); // Image-first: 35% text, 65% image
  const sorted = fused.sort((a, b) => b.final_score - a.final_score);
  const top20 = sorted.slice(0, 20);

  return {
    query: imageUrl,
    query_type: 'image',
    total_candidates: merged.length,
    results: top20,
  };
}

// Hybrid search (text query + image URL → combine both searches)
export async function searchProductsHybrid(supabase, queryText, imageUrl) {
  console.log(`🔀 Hybrid search for text: "${queryText}" + image: "${imageUrl}"`);

  // Run both text and image searches independently
  const [textSearchResults, imageSearchResults] = await Promise.all([
    searchProducts(supabase, queryText),
    searchProductsByImage(supabase, imageUrl),
  ]);

  // Get top 20 from each
  const textTop20 = textSearchResults.results;
  const imageTop20 = imageSearchResults.results;

  console.log(`📊 Text search: ${textTop20.length} results, Image search: ${imageTop20.length} results`);

  // Combine and deduplicate by ID, averaging scores for duplicates
  const hybridMap = new Map();

  for (const item of textTop20) {
    hybridMap.set(item.id, {
      ...item,
      text_final_score: item.final_score,
      image_final_score: 0,
      sources: ['text'],
    });
  }

  for (const item of imageTop20) {
    if (hybridMap.has(item.id)) {
      const existing = hybridMap.get(item.id);
      existing.image_final_score = item.final_score;
      existing.sources.push('image');
    } else {
      hybridMap.set(item.id, {
        ...item,
        text_final_score: 0,
        image_final_score: item.final_score,
        sources: ['image'],
      });
    }
  }

  // Calculate final score: average of both final scores
  // Remove internal tracking fields for consistent response
  const hybridResults = Array.from(hybridMap.values()).map((item) => {
    const final_score = (item.text_final_score + item.image_final_score) / 2;
    const { text_final_score, image_final_score, sources: _, ...cleanItem } = item;
    return {
      ...cleanItem,
      final_score,
    };
  });

  // Sort by final score and take top 20
  const sorted = hybridResults.sort((a, b) => b.final_score - a.final_score);
  const top20 = sorted.slice(0, 20);

  console.log(`🔗 Merged: ${hybridResults.length} unique products`);

  return {
    query_text: queryText,
    query_image: imageUrl,
    query_type: 'hybrid',
    total_candidates: hybridResults.length,
    results: top20,
  };
}

// Create Supabase client helper
export function createSupabaseClient(url, key) {
  if (!url || !key) {
    throw new Error('Missing Supabase credentials');
  }
  return createClient(url, key);
}
