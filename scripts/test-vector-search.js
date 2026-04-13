/**
 * Vector Search Test Script
 * 
 * This script allows you to test the vector search functionality directly
 * from the command line without going through the UI.
 * 
 * Usage:
 *   node scripts/test-vector-search.js "casual summer outfit"
 *   node scripts/test-vector-search.js "formal business wear" --type outfits
 *   node scripts/test-vector-search.js "blue jeans" --type products
 *   node scripts/test-vector-search.js --help
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env.local') });

// Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY not found in .env.local');
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Supabase credentials not found in .env.local');
  process.exit(1);
}

// Initialize clients
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
    throw error;
  }
}

// Test vector search using RPC functions
async function testVectorSearch(query, searchType = 'outfits', limit = 5, threshold = 0.7) {
  console.log(`🔍 Testing vector search for: "${query}"`);
  console.log(`📊 Search type: ${searchType}`);
  console.log(`📏 Limit: ${limit}`);
  console.log(`🎯 Similarity threshold: ${(threshold * 100).toFixed(1)}%`);
  console.log('');
  
  try {
    // Step 1: Generate embedding for the query
    console.log('🔄 Generating embedding...');
    const embedding = await getEmbedding(query);
    console.log(`✅ Generated embedding (${embedding.length} dimensions)`);
    console.log('');
    
    // Step 2: Perform vector search
    console.log('🔍 Performing vector search...');
    let results;
    let error;
    
    if (searchType === 'outfits') {
      const { data, error: searchError } = await supabase.rpc('search_outfits_by_vector', {
        query_embedding: embedding,
        match_threshold: threshold,
        match_count: limit
      });
      results = data;
      error = searchError;
    } else if (searchType === 'products') {
      const { data, error: searchError } = await supabase.rpc('search_products_by_vector', {
        query_embedding: embedding,
        match_threshold: threshold,
        match_count: limit
      });
      results = data;
      error = searchError;
    } else {
      throw new Error('Invalid search type. Use "outfits" or "products"');
    }
    
    if (error) {
      console.error('❌ Search error:', error);
      return;
    }
    
    // Step 3: Display results
    console.log(`🎯 Found ${results?.length || 0} results:`);
    console.log('');
    
    if (!results || results.length === 0) {
      console.log('❌ No results found');
      return;
    }
    
    results.forEach((result, index) => {
      console.log(`--- Result ${index + 1} (Similarity: ${(result.similarity * 100).toFixed(1)}%) ---`);
      
      if (searchType === 'outfits') {
        console.log(`ID: ${result.id}`);
        console.log(`Name: ${result.name}`);
        console.log(`Category: ${result.category}`);
        console.log(`Occasion: ${result.occasion}`);
        console.log(`Gender: ${result.gender || 'N/A'}`);
        console.log(`Fit: ${result.fit || 'N/A'}`);
        console.log(`Feel: ${result.feel || 'N/A'}`);
        console.log(`Description: ${result.description_text || 'N/A'}`);
      } else {
        console.log(`ID: ${result.id}`);
        console.log(`Type: ${result.type}`);
        console.log(`Brand: ${result.brand}`);
        console.log(`Color: ${result.color}`);
        console.log(`Size: ${result.size}`);
        console.log(`Price: ${result.price} ${result.currency}`);
        console.log(`Description: ${result.description_text || 'N/A'}`);
      }
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Test database connection
async function testDatabaseConnection() {
  console.log('🔌 Testing database connection...');
  
  try {
    // Test basic connection
    const { data, error } = await supabase
      .from('outfits')
      .select('id, name')
      .limit(1);
    
    if (error) {
      throw error;
    }
    
    console.log('✅ Database connection successful');
    console.log(`📊 Sample outfit: ${data[0]?.name || 'None found'}`);
    console.log('');
    
    // Test if vector functions exist
    console.log('🔍 Testing vector search functions...');
    
    try {
      const { data: testData, error: testError } = await supabase.rpc('search_outfits_by_vector', {
        query_embedding: new Array(1536).fill(0), // Dummy embedding
        match_threshold: 0.1,
        match_count: 1
      });
      
      if (testError && testError.message.includes('function') && testError.message.includes('does not exist')) {
        console.log('❌ Vector search functions not found. Run migrations first.');
        console.log('   npx supabase db push');
        return false;
      }
      
      console.log('✅ Vector search functions available');
      return true;
      
    } catch (funcError) {
      console.log('❌ Vector search functions not available:', funcError.message);
      return false;
    }
    
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  
  // Show help
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Vector Search Test Script');
    console.log('');
    console.log('Usage:');
    console.log('  node scripts/test-vector-search.js "search query" [options]');
    console.log('');
    console.log('Options:');
    console.log('  --type <type>        Search type: outfits (default) or products');
    console.log('  --limit <number>     Maximum number of results (default: 5)');
    console.log('  --threshold <float>  Similarity threshold 0.0-1.0 (default: 0.7)');
    console.log('  --test-db            Test database connection only');
    console.log('  --help, -h           Show this help message');
    console.log('');
    console.log('Examples:');
    console.log('  node scripts/test-vector-search.js "casual summer outfit"');
    console.log('  node scripts/test-vector-search.js "blue jeans" --type products');
    console.log('  node scripts/test-vector-search.js "formal wear" --type outfits --limit 10');
    console.log('  node scripts/test-vector-search.js "casual outfit" --threshold 0.5');
    console.log('  node scripts/test-vector-search.js --test-db');
    process.exit(0);
  }
  
  // Test database connection only
  if (args.includes('--test-db')) {
    await testDatabaseConnection();
    process.exit(0);
  }
  
  // Get search query
  const query = args[0];
  if (!query) {
    console.error('❌ Search query is required');
    console.log('Use --help for usage information');
    process.exit(1);
  }
  
  // Parse options
  const typeIndex = args.indexOf('--type');
  const searchType = typeIndex !== -1 && args[typeIndex + 1] ? args[typeIndex + 1] : 'outfits';
  
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex !== -1 && args[limitIndex + 1] ? parseInt(args[limitIndex + 1]) : 5;
  
  const thresholdIndex = args.indexOf('--threshold');
  const threshold = thresholdIndex !== -1 && args[thresholdIndex + 1] ? parseFloat(args[thresholdIndex + 1]) : 0.7;
  
  // Validate options
  if (!['outfits', 'products'].includes(searchType)) {
    console.error('❌ Invalid search type. Use "outfits" or "products"');
    process.exit(1);
  }
  
  if (isNaN(limit) || limit < 1 || limit > 50) {
    console.error('❌ Invalid limit. Use a number between 1 and 50');
    process.exit(1);
  }
  
  if (isNaN(threshold) || threshold < 0 || threshold > 1) {
    console.error('❌ Invalid threshold. Use a number between 0 and 1 (e.g., 0.5 for 50%)');
    process.exit(1);
  }
  
  console.log('🚀 Vector Search Test Script');
  console.log('============================');
  console.log('');
  
  // Test database connection first
  const dbOk = await testDatabaseConnection();
  if (!dbOk) {
    console.log('❌ Cannot proceed without database connection');
    process.exit(1);
  }
  
  console.log('');
  
  // Show threshold info
  console.log('💡 Threshold Guide:');
  console.log(`   • ${(threshold * 100).toFixed(1)}% = ${threshold} (current setting)`);
  console.log('   • 90% = 0.9 (very strict, only very similar results)');
  console.log('   • 70% = 0.7 (default, balanced results)');
  console.log('   • 50% = 0.5 (loose, more diverse results)');
  console.log('   • 30% = 0.3 (very loose, many results)');
  console.log('');
  
  // Perform the search
  await testVectorSearch(query, searchType, limit, threshold);
}

// Run the script
main().catch(console.error);
