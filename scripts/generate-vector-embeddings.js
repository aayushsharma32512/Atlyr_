#!/usr/bin/env node

/**
 * Script to generate vector embeddings for outfits and products
 * Uses OpenAI text-embedding-3-small model (1536 dimensions)
 * 
 * Prerequisites:
 * 1. Set OPENAI_API_KEY in .env.local
 * 2. Ensure Supabase is running and accessible
 * 3. Run the migration to add vector columns first
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import path from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

// Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Cache file paths
const OUTFITS_CACHE_FILE = 'outfits_embeddings_cache.csv';
const PRODUCTS_CACHE_FILE = 'products_embeddings_cache.csv';

if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY not found in .env');
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Supabase credentials not found in .env');
  process.exit(1);
}

// Initialize clients
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Cache management functions
function loadCache(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return new Map();
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');
    const cache = new Map();
    
    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const [id, description, embedding] = lines[i].split(',');
      if (id && description && embedding) {
        cache.set(id, {
          description_text: description,
          vector_embedding: embedding
        });
      }
    }
    
    console.log(`📁 Loaded ${cache.size} cached embeddings from ${filePath}`);
    return cache;
  } catch (error) {
    console.warn(`⚠️ Could not load cache from ${filePath}:`, error.message);
    return new Map();
  }
}

function saveToCache(filePath, id, description, embedding) {
  try {
    // Create directory if it doesn't exist
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Create file with header if it doesn't exist
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, 'id,description_text,vector_embedding\n');
    }
    
    // Append the new entry
    fs.appendFileSync(filePath, `${id},"${description.replace(/"/g, '""')}","${embedding}"\n`);
  } catch (error) {
    console.warn(`⚠️ Could not save to cache ${filePath}:`, error.message);
  }
}

// Helper function to generate natural language description for an outfit
async function generateOutfitDescription(outfit, categories, occasions) {
  // Generate description in the same format as the function
  
  const text_llm = `The outfit ${outfit.name} falls under the ${outfit.category} category, ` +
    `is ideal for ${outfit.occasion}, pairs ${outfit.top_id} with ${outfit.bottom_id} and ${outfit.shoes_id}, ` +
    `offers a ${outfit.fit || 'standard'} fit with a ${outfit.feel || 'comfortable'} feel, evokes the word association ${outfit.word_association || 'style'}, ` +
    `and is described as ${outfit.description || 'a fashionable ensemble'}`;
  
  return text_llm;
}

// Helper function to generate natural language description for a product
async function generateProductDescription(product) {
  // Helper function to filter out invalid values
  const isValidValue = (value) => {
    return value && value !== 'nan' && value !== 'null' && value !== 'undefined' && value.toString().trim() !== '';
  };

  // Build the description parts
  const name = product.product_name || product.id;
  const brand = isValidValue(product.brand) ? ` by ${product.brand}` : '';
  
  // Type/category part
  let typePart = '';
  if (isValidValue(product.type_category) || isValidValue(product.type)) {
    const typeCategory = isValidValue(product.type_category) ? product.type_category : '';
    const type = isValidValue(product.type) ? `(${product.type})` : '';
    const typeComponents = [typeCategory, type].filter(Boolean);
    typePart = typeComponents.length > 0 ? ` — a ${typeComponents.join(' ')}` : '';
  }
  
  // Attributes part
  const attributes = [
    product.description,
    isValidValue(product.color_group) ? `in ${product.color_group}` : null,
    isValidValue(product.fit) ? `${product.fit} fit` : null,
    isValidValue(product.feel) ? `${product.feel} feel` : null,
    isValidValue(product.gender) ? `for ${product.gender}` : null,
    isValidValue(product.vibes) ? `with a ${product.vibes} vibe` : null
  ].filter(Boolean);
  
  const attributesPart = attributes.length > 0 ? ` — ${attributes.join(', ')}` : '';
  
  // Price part
  const pricePart = product.price != null ? ` — Price INR ${product.price}` : '';
  
  // Combine all parts
  const text_llm = `${name}${brand}${typePart}${attributesPart}${pricePart}`;

  return text_llm;
}

// Helper function to get embedding from OpenAI
async function getEmbedding(text) {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      encoding_format: 'float',
    });
    
    return response.data[0].embedding;
  } catch (error) {
    console.error('❌ Error getting embedding:', error.message);
    
    // Check if it's a quota/rate limit error
    if (error.message.includes('429') || error.message.includes('quota') || error.message.includes('rate limit')) {
      console.log('⏳ Rate limit/quota exceeded. Waiting 60 seconds before retrying...');
      await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 60 seconds
      
      // Try one more time
      try {
        console.log('🔄 Retrying embedding generation...');
        const retryResponse = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: text,
          encoding_format: 'float',
        });
        return retryResponse.data[0].embedding;
      } catch (retryError) {
        console.error('❌ Retry failed:', retryError.message);
        throw new Error('Rate limit exceeded. Please wait and try again later.');
      }
    }
    
    throw error;
  }
}

// Process outfits
async function processOutfits() {
  console.log('🔄 Processing outfits...');
  
  // Load cache
  const outfitsCache = loadCache(OUTFITS_CACHE_FILE);
  
  try {
    // Fetch all outfits
    const { data: outfits, error: outfitsError } = await supabase
      .from('outfits')
      .select('*');
    
    if (outfitsError) throw outfitsError;
    
    // Fetch categories and occasions for context
    const { data: categories, error: categoriesError } = await supabase
      .from('categories')
      .select('*');
    
    if (categoriesError) throw categoriesError;
    
    const { data: occasions, error: occasionsError } = await supabase
      .from('occasions')
      .select('*');
    
    if (occasionsError) throw occasionsError;
    
    // Fetch all products for reference
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('*');
    
    if (productsError) throw productsError;
    
    console.log(`📊 Found ${outfits.length} outfits to process`);
    
    // Debug: Show first outfit structure
    if (outfits.length > 0) {
      console.log('🔍 Sample outfit structure:', JSON.stringify(outfits[0], null, 2));
    }
    
    let processed = 0;
    let errors = 0;
    let cached = 0;
    
    for (let i = 0; i < outfits.length; i++) {
      const outfit = outfits[i];
      try {
        console.log(`🔄 Processing outfit ${i + 1}/${outfits.length}: ${outfit.name || outfit.id}`);
        
        // Check if we have cached data
        if (outfitsCache.has(outfit.id)) {
          const cachedData = outfitsCache.get(outfit.id);
          console.log(`📁 Using cached data for outfit: ${outfit.id}`);
          
          // Update database with cached data
          const { error: updateError } = await supabase
            .from('outfits')
            .update({
              description_text: cachedData.description_text,
              vector_embedding: JSON.parse(cachedData.vector_embedding)
            })
            .eq('id', outfit.id);
          
          if (updateError) throw updateError;
          
          console.log(`✅ Updated outfit from cache: ${outfit.id}`);
          cached++;
          continue; // Skip to next outfit
        }
        
        // Skip if already has description and embedding in database (unless force flag is set)
        if (outfit.description_text && outfit.vector_embedding && !options.force) {
          console.log(`⏭️  Skipping outfit ${outfit.id} (already processed in database)`);
          processed++;
          continue;
        }
        
        // Get the individual products for this outfit
        const topProduct = outfit.top_id ? products.find(p => p.id === outfit.top_id) : null;
        const bottomProduct = outfit.bottom_id ? products.find(p => p.id === outfit.bottom_id) : null;
        const shoesProduct = outfit.shoes_id ? products.find(p => p.id === outfit.shoes_id) : null;
        
        // Skip if no products found (shouldn't happen but safety check)
        if (!topProduct && !bottomProduct && !shoesProduct) {
          console.log(`⚠️  Skipping outfit ${outfit.id} - no products found`);
          continue;
        }
        
        // Generate description
        const description = await generateOutfitDescription(outfit, categories, occasions);
        
        // Get embedding
        const embedding = await getEmbedding(description);
        
        // Save to cache
        saveToCache(OUTFITS_CACHE_FILE, outfit.id, description, JSON.stringify(embedding));
        
        // Update database
        const { error: updateError } = await supabase
          .from('outfits')
          .update({
            description_text: description,
            vector_embedding: embedding
          })
          .eq('id', outfit.id);
        
        if (updateError) throw updateError;
        
        console.log(`✅ Processed outfit: ${outfit.name} (${i + 1}/${outfits.length})`);
        processed++;
        
        // Rate limiting - OpenAI free tier has strict limits
        // Wait 3 seconds between requests to avoid hitting rate limits
        await new Promise(resolve => setTimeout(resolve, 3000));
        
      } catch (error) {
        console.error(`❌ Error processing outfit ${outfit.id}:`, error.message);
        errors++;
        
        // If it's a quota error, stop processing and inform user
        if (error.message.includes('Rate limit exceeded') || error.message.includes('quota')) {
          console.log('🛑 Stopping processing due to quota/rate limit. Please wait and run the script again later.');
          break;
        }
      }
    }
    
    console.log(`🎉 Outfits processing complete: ${processed} processed, ${cached} cached, ${errors} errors`);
    
    // If we stopped due to quota, show what's left
    if (processed + cached + errors < outfits.length) {
      const remaining = outfits.length - processed - cached - errors;
      console.log(`⏳ ${remaining} outfits remaining to process. Run the script again later when quota resets.`);
    }
    
  } catch (error) {
    console.error('❌ Error processing outfits:', error);
  }
}

// Process products
async function processProducts() {
  console.log('🔄 Processing products...');
  
  // Load cache
  const productsCache = loadCache(PRODUCTS_CACHE_FILE);
  
  try {
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('*');
    
    if (productsError) throw productsError;
    
    console.log(`📊 Found ${products.length} products to process`);
    
    let processed = 0;
    let errors = 0;
    let cached = 0;
    
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      try {
        console.log(`🔄 Processing product ${i + 1}/${products.length}: ${product.id}`);
        
        // Check if we have cached data
        if (productsCache.has(product.id)) {
          const cachedData = productsCache.get(product.id);
          console.log(`📁 Using cached data for product: ${product.id}`);
          
          // Update database with cached data
          const { error: updateError } = await supabase
            .from('products')
            .update({
              description_text: cachedData.description_text,
              vector_embedding: JSON.parse(cachedData.vector_embedding)
            })
            .eq('id', product.id);
          
          if (updateError) throw updateError;
          
          console.log(`✅ Updated product from cache: ${product.id}`);
          cached++;
          continue; // Skip to next product
        }
        
        // Skip if already has description and embedding in database (unless force flag is set)
        if (product.description_text && product.vector_embedding && !options.force) {
          console.log(`⏭️  Skipping product ${product.id} (already processed in database)`);
          processed++;
          continue;
        }
        
        // Generate description
        const description = await generateProductDescription(product);
        
        // Get embedding
        const embedding = await getEmbedding(description);
        
        // Save to cache
        saveToCache(PRODUCTS_CACHE_FILE, product.id, description, JSON.stringify(embedding));
        
        // Update database
        const { error: updateError } = await supabase
          .from('products')
          .update({
            description_text: description,
            vector_embedding: embedding
          })
          .eq('id', product.id);
        
        if (updateError) throw updateError;
        
        console.log(`✅ Processed product: ${product.id} (${i + 1}/${products.length})`);
        processed++;
        
        // Rate limiting - OpenAI free tier has strict limits
        // Wait 3 seconds between requests to avoid hitting rate limits
        await new Promise(resolve => setTimeout(resolve, 3000));
        
      } catch (error) {
        console.error(`❌ Error processing product ${product.id}:`, error.message);
        errors++;
        
        // If it's a quota error, stop processing and inform user
        if (error.message.includes('Rate limit exceeded') || error.message.includes('quota')) {
          console.log('🛑 Stopping processing due to quota/rate limit. Please wait and run the script again later.');
          break;
        }
      }
    }
    
    console.log(`🎉 Products processing complete: ${processed} processed, ${cached} cached, ${errors} errors`);
    
    // If we stopped due to quota, show what's left
    if (processed + cached + errors < products.length) {
      const remaining = products.length - processed - cached - errors;
      console.log(`⏳ ${remaining} products remaining to process. Run the script again later when quota resets.`);
    }
    
  } catch (error) {
    console.error('❌ Error processing products:', error);
  }
}

// Function to clear cache files
function clearCache() {
  try {
    if (fs.existsSync(OUTFITS_CACHE_FILE)) {
      fs.unlinkSync(OUTFITS_CACHE_FILE);
      console.log(`🗑️  Cleared ${OUTFITS_CACHE_FILE}`);
    }
    if (fs.existsSync(PRODUCTS_CACHE_FILE)) {
      fs.unlinkSync(PRODUCTS_CACHE_FILE);
      console.log(`🗑️  Cleared ${PRODUCTS_CACHE_FILE}`);
    }
  } catch (error) {
    console.warn('⚠️  Could not clear cache files:', error.message);
  }
}

// Main execution
async function main() {
  console.log('🚀 Starting vector embedding generation...');
  
  // Show what will be processed
  if (shouldProcessProducts && shouldProcessOutfits) {
    console.log('📝 This will generate descriptions and embeddings for all outfits and products');
  } else if (shouldProcessProducts) {
    console.log('📝 This will generate descriptions and embeddings for products only');
  } else if (shouldProcessOutfits) {
    console.log('📝 This will generate descriptions and embeddings for outfits only');
  }
  
  if (options.force) {
    console.log('🔄 FORCE MODE: Will regenerate all descriptions and embeddings (ignoring existing data)');
  } else {
    console.log('💾 Cache files will be used to avoid regenerating existing embeddings');
  }
  console.log('');
  
  // Check if cache files exist
  if (shouldProcessOutfits && fs.existsSync(OUTFITS_CACHE_FILE)) {
    const outfitCacheSize = fs.readFileSync(OUTFITS_CACHE_FILE, 'utf8').split('\n').length - 2; // -2 for header and empty line
    console.log(`📁 Found outfits cache: ${outfitCacheSize} cached embeddings`);
  }
  if (shouldProcessProducts && fs.existsSync(PRODUCTS_CACHE_FILE)) {
    const productCacheSize = fs.readFileSync(PRODUCTS_CACHE_FILE, 'utf8').split('\n').length - 2; // -2 for header and empty line
    console.log(`📁 Found products cache: ${productCacheSize} cached embeddings`);
  }
  console.log('');
  
  try {
    // Process based on CLI options
    if (shouldProcessOutfits) {
      await processOutfits();
      console.log('');
    }
    
    if (shouldProcessProducts) {
      await processProducts();
      console.log('');
    }
    
    console.log('🎉 All processing complete!');
    console.log('💡 You can now use the vector search functions in your application');
    
    // Show which cache files were used
    const cacheFiles = [];
    if (shouldProcessOutfits) cacheFiles.push(OUTFITS_CACHE_FILE);
    if (shouldProcessProducts) cacheFiles.push(PRODUCTS_CACHE_FILE);
    
    if (cacheFiles.length > 0) {
      console.log('💾 Cache files saved for future runs:');
      cacheFiles.forEach(file => console.log(`   - ${file}`));
    }
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

// CLI options
const options = {
  clearCache: args.includes('--clear-cache') || args.includes('-c'),
  help: args.includes('--help') || args.includes('-h'),
  products: args.includes('--products') || args.includes('-p'),
  outfits: args.includes('--outfits') || args.includes('-o'),
  all: args.includes('--all') || args.includes('-a'),
  force: args.includes('--force') || args.includes('-f')
};

// Handle help
if (options.help) {
  console.log('Usage: node generate-vector-embeddings.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --products, -p       Process only products');
  console.log('  --outfits, -o        Process only outfits');
  console.log('  --all, -a            Process both products and outfits (default)');
  console.log('  --force, -f          Force regeneration (ignore existing data)');
  console.log('  --clear-cache, -c    Clear all cache files before running');
  console.log('  --help, -h           Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  node generate-vector-embeddings.js              # Process both with caching');
  console.log('  node generate-vector-embeddings.js --products   # Process only products');
  console.log('  node generate-vector-embeddings.js --outfits    # Process only outfits');
  console.log('  node generate-vector-embeddings.js --force      # Force regeneration of all data');
  console.log('  node generate-vector-embeddings.js --clear-cache # Clear cache and regenerate all');
  process.exit(0);
}

// Handle clear cache
if (options.clearCache) {
  console.log('🗑️  Clearing cache files...');
  clearCache();
  console.log('✅ Cache cleared. Run the script again to regenerate all embeddings.');
  process.exit(0);
}

// Determine what to process
let shouldProcessProducts = false;
let shouldProcessOutfits = false;

if (options.products) {
  shouldProcessProducts = true;
} else if (options.outfits) {
  shouldProcessOutfits = true;
} else {
  // Default: process both
  shouldProcessProducts = true;
  shouldProcessOutfits = true;
}

// Run the script
main().catch(console.error);
