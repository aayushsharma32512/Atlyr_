import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// Local Supabase configuration
const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

console.log('🔧 Using LOCAL Supabase database for outfit creation');
console.log('📊 URL:', LOCAL_SUPABASE_URL);
console.log('🔑 Using local service role key\n');

const supabase = createClient(LOCAL_SUPABASE_URL, LOCAL_SUPABASE_KEY);

// Error tracking
const errors = [];
const successCount = { outfits: 0 };

// Outfit categories and occasions
const categories = [
  { id: 'for-you', name: 'For You' },
  { id: 'date-fits', name: 'Date Fits' },
  { id: 'old-money', name: 'Old Money' },
  { id: 'casual', name: 'Casual' },
  { id: 'business', name: 'Business' }
];

const occasions = [
  { id: 'work', name: 'Work', background_url: '/Backgrounds/7.png' },
  { id: 'casual', name: 'Casual', background_url: '/Backgrounds/8.png' },
  { id: 'date', name: 'Date', background_url: '/Backgrounds/9.png' },
  { id: 'party', name: 'Party', background_url: '/Backgrounds/10.png' },
  { id: 'travel', name: 'Travel', background_url: '/Backgrounds/11.png' },
  { id: 'brunch', name: 'Brunch', background_url: '/Backgrounds/13.png' },
  { id: 'business', name: 'Business', background_url: '/Backgrounds/14.png' }
];

async function fetchProducts() {
  try {
    console.log('📊 Fetching products from database...');
    
    const { data: products, error } = await supabase
      .from('products')
      .select('*')
      .order('type');
    
    if (error) throw error;
    
    console.log(`✅ Found ${products.length} products`);
    
    // Group products by type
    const productsByType = {
      top: products.filter(p => p.type === 'top'),
      bottom: products.filter(p => p.type === 'bottom'),
      shoes: products.filter(p => p.type === 'shoes')
    };
    
    console.log(`📊 Products by type:`);
    console.log(`  Tops: ${productsByType.top.length}`);
    console.log(`  Bottoms: ${productsByType.bottom.length}`);
    console.log(`  Shoes: ${productsByType.shoes.length}`);
    
    return productsByType;
  } catch (error) {
    console.error('❌ Error fetching products:', error.message);
    throw error;
  }
}

function generateOutfitCombinations(productsByType) {
  console.log('🎨 Generating outfit combinations...');
  
  const outfits = [];
  const { top: tops, bottom: bottoms, shoes: shoes } = productsByType;
  
  console.log(`📊 Available products:`);
  console.log(`  Tops: ${tops.length} (${tops.map(p => p.id).join(', ')})`);
  console.log(`  Bottoms: ${bottoms.length} (${bottoms.map(p => p.id).join(', ')})`);
  console.log(`  Shoes: ${shoes.length} (${shoes.map(p => p.id).join(', ')})`);
  
  // Create outfit configurations
  const outfitConfigs = [
    // Casual outfits
    { name: 'Weekend Casual', category: 'casual', occasion: 'casual', description: 'Relaxed weekend vibes' },
    { name: 'Street Style', category: 'casual', occasion: 'casual', description: 'Urban street fashion' },
    { name: 'Comfort Zone', category: 'casual', occasion: 'casual', description: 'Comfortable everyday look' },
    { name: 'Easy Breezy', category: 'casual', occasion: 'casual', description: 'Effortless casual style' },
    
    // Business outfits
    { name: 'Professional Power', category: 'business', occasion: 'work', description: 'Corporate professional look' },
    { name: 'Business Casual', category: 'business', occasion: 'work', description: 'Smart casual for office' },
    { name: 'Executive Style', category: 'business', occasion: 'work', description: 'Executive business look' },
    
    // Date outfits
    { name: 'Romantic Evening', category: 'date-fits', occasion: 'date', description: 'Perfect for date night' },
    { name: 'Chic Date', category: 'date-fits', occasion: 'date', description: 'Elegant date outfit' },
    { name: 'Sweet Romance', category: 'date-fits', occasion: 'date', description: 'Sweet romantic style' },
    
    // Party outfits
    { name: 'Night Out Glam', category: 'for-you', occasion: 'party', description: 'Party ready look' },
    { name: 'Celebration Style', category: 'for-you', occasion: 'party', description: 'Festive party outfit' },
    { name: 'Glamorous Night', category: 'for-you', occasion: 'party', description: 'Glamorous party look' },
    
    // Travel outfits
    { name: 'Jet Set Style', category: 'casual', occasion: 'travel', description: 'Comfortable travel look' },
    { name: 'Wanderlust', category: 'casual', occasion: 'travel', description: 'Adventure ready outfit' },
    { name: 'Travel Ready', category: 'casual', occasion: 'travel', description: 'Perfect for travel' },
    
    // Brunch outfits
    { name: 'Sunday Brunch', category: 'casual', occasion: 'brunch', description: 'Perfect for brunch' },
    { name: 'Brunch Vibes', category: 'casual', occasion: 'brunch', description: 'Relaxed brunch style' },
    { name: 'Brunch Elegance', category: 'casual', occasion: 'brunch', description: 'Elegant brunch look' },
    
    // Old Money outfits
    { name: 'Timeless Elegance', category: 'old-money', occasion: 'business', description: 'Classic sophisticated look' },
    { name: 'Heritage Style', category: 'old-money', occasion: 'business', description: 'Traditional luxury style' },
    { name: 'Classic Luxury', category: 'old-money', occasion: 'business', description: 'Luxury classic style' }
  ];
  
  // Track used products to ensure all are utilized
  const usedProducts = new Set();
  
  // Generate outfits with comprehensive combinations
  outfitConfigs.forEach((config, index) => {
    // Use different selection strategies to ensure all products are used
    let top, bottom, shoesItem;
    
    if (index < tops.length) {
      // First round: use each top once
      top = tops[index];
    } else if (index < tops.length + bottoms.length) {
      // Second round: use each bottom once
      const bottomIndex = index - tops.length;
      top = tops[bottomIndex % tops.length];
      bottom = bottoms[bottomIndex];
    } else if (index < tops.length + bottoms.length + shoes.length) {
      // Third round: use each shoe once
      const shoeIndex = index - tops.length - bottoms.length;
      top = tops[shoeIndex % tops.length];
      bottom = bottoms[shoeIndex % bottoms.length];
      shoesItem = shoes[shoeIndex];
    } else {
      // Remaining outfits: cycle through all products
      const topIndex = index % tops.length;
      const bottomIndex = Math.floor(index / tops.length) % bottoms.length;
      const shoesIndex = Math.floor(index / (tops.length * bottoms.length)) % shoes.length;
      
      top = tops[topIndex];
      bottom = bottoms[bottomIndex];
      shoesItem = shoes[shoesIndex];
    }
    
    // Ensure we have all three items
    if (!top) top = tops[index % tops.length];
    if (!bottom) bottom = bottoms[index % bottoms.length];
    if (!shoesItem) shoesItem = shoes[index % shoes.length];
    
    // Track used products
    usedProducts.add(top.id);
    usedProducts.add(bottom.id);
    usedProducts.add(shoesItem.id);
    
    // Calculate total price
    const totalPrice = top.price + bottom.price + shoesItem.price;
    
    // Find occasion data
    const occasionData = occasions.find(o => o.id === config.occasion);
    
    outfits.push({
      id: uuidv4(),
      name: config.name,
      category: config.category,
      occasion: occasionData.id,
      background_id: occasionData.background_url,
      top_id: top.id,
      bottom_id: bottom.id,
      shoes_id: shoesItem.id,
      description: config.description,
      total_price: totalPrice
    });
  });
  
  console.log(`✅ Generated ${outfits.length} outfit combinations`);
  console.log(`📊 Used ${usedProducts.size} unique products out of ${tops.length + bottoms.length + shoes.length} total products`);
  
  // Check if all products were used
  const allProductIds = [...tops.map(p => p.id), ...bottoms.map(p => p.id), ...shoes.map(p => p.id)];
  const unusedProducts = allProductIds.filter(id => !usedProducts.has(id));
  
  if (unusedProducts.length > 0) {
    console.log(`⚠️  Unused products: ${unusedProducts.join(', ')}`);
  } else {
    console.log(`🎉 All products were used in outfit combinations!`);
  }
  
  return outfits;
}

async function insertOutfits(outfits) {
  console.log('💾 Inserting outfits into database...');
  
  for (const outfit of outfits) {
    try {
      const { error } = await supabase
        .from('outfits')
        .insert([{
          id: outfit.id,
          name: outfit.name,
          category: outfit.category,
          occasion: outfit.occasion,
          background_id: outfit.background_id,
          top_id: outfit.top_id,
          bottom_id: outfit.bottom_id,
          shoes_id: outfit.shoes_id
        }]);
      
      if (error) throw error;
      
      successCount.outfits++;
      console.log(`✅ Created outfit: ${outfit.name} (₹${outfit.total_price})`);
    } catch (error) {
      console.error(`❌ Failed to create outfit ${outfit.name}:`, error.message);
      errors.push({
        type: 'outfit_insert',
        outfit_name: outfit.name,
        error: error.message
      });
    }
  }
  
  console.log(`✅ Inserted ${successCount.outfits}/${outfits.length} outfits successfully`);
}

function showOutfitSummary(outfits) {
  console.log('\n📋 Outfit Summary:');
  console.log(`Total outfits created: ${outfits.length}`);
  
  const categories = {};
  const occasions = {};
  const priceRange = outfits.map(o => o.total_price);
  
  outfits.forEach(outfit => {
    categories[outfit.category] = (categories[outfit.category] || 0) + 1;
    occasions[outfit.occasion] = (occasions[outfit.occasion] || 0) + 1;
  });
  
  console.log('\n📊 By Category:');
  Object.entries(categories).forEach(([category, count]) => {
    console.log(`  ${category}: ${count}`);
  });
  
  console.log('\n🎯 By Occasion:');
  Object.entries(occasions).forEach(([occasion, count]) => {
    console.log(`  ${occasion}: ${count}`);
  });
  
  console.log('\n💰 Price Range:');
  if (priceRange.length > 0) {
    console.log(`  Min: ₹${Math.min(...priceRange)}`);
    console.log(`  Max: ₹${Math.max(...priceRange)}`);
    console.log(`  Avg: ₹${Math.round(priceRange.reduce((a, b) => a + b, 0) / priceRange.length)}`);
  }
}

function generateErrorReport() {
  if (errors.length === 0) {
    console.log('🎉 No errors to report!');
    return;
  }
  
  console.log(`📋 Generating error report for ${errors.length} errors...`);
  
  // Create error report data
  const errorData = errors.map(error => ({
    Type: error.type,
    'Outfit Name': error.outfit_name || 'N/A',
    Error: error.error,
    Timestamp: new Date().toISOString()
  }));
  
  // For now, just log errors to console since we don't have XLSX in this script
  console.log('\n❌ Errors:');
  errorData.forEach(error => {
    console.log(`  ${error['Outfit Name']}: ${error.Error}`);
  });
}

async function main() {
  try {
    console.log('🚀 Starting OUTFIT CREATION process...\n');
    
    // Step 1: Fetch products from database
    const productsByType = await fetchProducts();
    
    // Step 2: Generate outfit combinations
    const outfits = generateOutfitCombinations(productsByType);
    
    // Step 3: Show outfit summary
    showOutfitSummary(outfits);
    
    // Step 4: Insert outfits into database
    await insertOutfits(outfits);
    
    // Step 5: Generate error report
    generateErrorReport();
    
    // Final summary
    console.log('\n📊 Final Summary (OUTFIT CREATION):');
    console.log(`✅ Outfits created: ${successCount.outfits}`);
    console.log(`❌ Errors encountered: ${errors.length}`);
    
    console.log('\n🎯 Next Steps:');
    console.log('1. Check your local database at: http://127.0.0.1:54323');
    console.log('2. Verify outfits were created correctly');
    console.log('3. Start your app and check the home page!');
    
  } catch (error) {
    console.error('💥 Fatal error:', error.message);
    process.exit(1);
  }
}

main(); 