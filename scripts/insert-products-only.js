import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Remote Supabase configuration
const REMOTE_SUPABASE_URL = "https://hhqnvjxnsbwhmrldohbz.supabase.co";
const REMOTE_SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhocW52anhuc2J3aG1ybGRvaGJ6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Mjc0NjU2NiwiZXhwIjoyMDY4MzIyNTY2fQ.HKba451rI7d1cxFqdozeMss9TdSoMPmJD5f-ItAgOas";

console.log('🔧 Using REMOTE Supabase database for product insertion');
console.log('📊 URL:', REMOTE_SUPABASE_URL);
console.log('🔑 Using remote service role key\n');

const supabase = createClient(REMOTE_SUPABASE_URL, REMOTE_SUPABASE_KEY);

// ---------------- CLI ARG PARSING ----------------
// Usage: bun scripts/insert-products-only.js --staples
// Usage: bun scripts/insert-products-only.js --folder staples
// Usage: bun scripts/insert-products-only.js --gender women --staples
function getArg(name, fallback) {
  const prefix = `--${name}`;
  const arg = process.argv.find(a => a === prefix || a.startsWith(prefix + '='));
  if (!arg) return fallback;
  if (arg.includes('=')) return arg.split('=')[1];
  // handle "--gender women" form
  const idx = process.argv.indexOf(arg);
  return process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')
    ? process.argv[idx + 1]
    : fallback;
}

// Check for custom folder argument (--staples, --casual, etc.)
function getCustomFolder() {
  // Look for any argument that starts with -- and isn't a known parameter
  const knownParams = ['gender', 'folder'];
  const customFolderArg = process.argv.find(arg => 
    arg.startsWith('--') && 
    !knownParams.some(param => arg === `--${param}` || arg.startsWith(`--${param}=`))
  );
  
  if (customFolderArg) {
    return customFolderArg.substring(2); // Remove the -- prefix
  }
  
  return null;
}

const genderArgRaw = (getArg('gender', 'men') || '').toLowerCase();
const genderArg = ['men', 'women'].includes(genderArgRaw) ? genderArgRaw : 'men';

// Determine folder configuration
const customFolder = getCustomFolder();
const explicitFolder = getArg('folder', null);

let folderFromGender;

if (customFolder) {
  // Use custom folder (e.g., --staples)
  folderFromGender = customFolder.charAt(0).toUpperCase() + customFolder.slice(1) + '_Outfits';
  console.log(`🎯 Custom folder detected: ${customFolder}`);
  console.log(`📁 Source folder: ${folderFromGender}`);
} else if (explicitFolder) {
  // Use explicit folder parameter (e.g., --folder staples)
  folderFromGender = explicitFolder.charAt(0).toUpperCase() + explicitFolder.slice(1) + '_Outfits';
  console.log(`🎯 Explicit folder: ${explicitFolder}`);
  console.log(`📁 Source folder: ${folderFromGender}`);
} else {
  // Use default gender-based folders
  folderFromGender = genderArg === 'women' ? 'Women_Outfits' : 'Men_Outfits';
  console.log(`🎯 Target gender: ${genderArg} | Folder: ${folderFromGender}`);
}

// Error tracking
const errors = [];
const successCount = { products: 0 };

function readExcelFile() {
  try {
    console.log('📊 Reading Excel file...');
    
    const excelPath = path.join(__dirname, `../${folderFromGender}/DB_Ready_Products/DB_Ready_List.xlsx`);
    const workbook = XLSX.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    const products = XLSX.utils.sheet_to_json(worksheet);
    console.log(`✅ Read ${products.length} products from Excel`);
    
    return products;
  } catch (error) {
    console.error('❌ Error reading Excel file:', error.message);
    errors.push({
      type: 'excel_read',
      error: error.message
    });
    throw error;
  }
}

function validateProduct(product, index) {
  const required = ['id', 'type', 'brand', 'size', 'price', 'description', 'color'];
  const missing = required.filter(field => !product[field]);
  
  if (missing.length > 0) {
    errors.push({
      type: 'validation',
      product_id: product.id,
      row: index + 1,
      error: `Missing required fields: ${missing.join(', ')}`
    });
    return false;
  }
  
  // Validate image_url exists
  if (!product.image_url) {
    errors.push({
      type: 'validation',
      product_id: product.id,
      row: index + 1,
      error: 'Missing image_url field'
    });
    return false;
  }
  
  // Validate price is a number
  if (isNaN(parseInt(product.price))) {
    errors.push({
      type: 'validation',
      product_id: product.id,
      row: index + 1,
      error: 'Price must be a valid number'
    });
    return false;
  }
  
  return true;
}

async function insertProductsToDatabase(products) {
  console.log('💾 Inserting products into REMOTE database...');
  
  const validProducts = products.filter((product, index) => validateProduct(product, index));
  
  console.log(`📝 Inserting ${validProducts.length} valid products...`);
  
  for (const product of validProducts) {
    try {
      const upsertPayload = {
        id: product.id,
        type: product.type,
        brand: product.brand,
        product_name: product.product_name ?? null,
        size: product.size,
        price: parseInt(product.price),
        currency: product.currency || 'INR',
        image_url: product.image_url,
        description: product.description,
        color: product.color,
        color_group: product.color_group ?? product.Color_group ?? null,
        placement_x: product.placement_x ?? null,
        placement_y: product.placement_y ?? null,
        type_category: product.type_category ?? null,
        // New fields included for upsert/update
        fit: product.fit ?? null,
        feel: product.feel ?? null,
        category_id: product.category_id ?? null,
        image_length: product.image_length != null && product.image_length !== '' ? Number(product.image_length) : null,
        product_length: product.product_length != null && product.product_length !== '' ? Number(product.product_length) : null,
        product_url: product.product_url ?? null,
        gender: product.gender ?? genderArg
      };

      const { error } = await supabase
        .from('products')
        .upsert([upsertPayload], { onConflict: 'id' });
      
      if (error) throw error;
      
      successCount.products++;
      console.log(`✅ Inserted product: ${product.id}`);
    } catch (error) {
      console.error(`❌ Failed to insert product ${product.id}:`, error.message);
      errors.push({
        type: 'database_insert',
        product_id: product.id,
        error: error.message
      });
    }
  }
  
  console.log(`✅ Inserted ${successCount.products}/${validProducts.length} products successfully`);
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
    'Product ID': error.product_id || 'N/A',
    'Row Number': error.row || 'N/A',
    Error: error.error,
    Timestamp: new Date().toISOString()
  }));
  
  // Create workbook and worksheet
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(errorData);
  
  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Error Report');
  
  // Write to file with folder-specific name
  const folderName = customFolder || explicitFolder || genderArg;
  const reportPath = path.join(__dirname, `../${folderFromGender}/DB_Ready_Products/product-insert-error-report-${folderName}.xlsx`);
  XLSX.writeFile(workbook, reportPath);
  
  console.log(`📄 Error report saved to: ${reportPath}`);
}

function showProductSummary(products) {
  console.log('\n📋 Product Summary:');
  console.log(`Total products in Excel: ${products.length}`);
  
  const types = {};
  const brands = {};
  const typeCategories = {};
  
  products.forEach(product => {
    types[product.type] = (types[product.type] || 0) + 1;
    brands[product.brand] = (brands[product.brand] || 0) + 1;
    if (product.type_category) {
      typeCategories[product.type_category] = (typeCategories[product.type_category] || 0) + 1;
    }
  });
  
  console.log('\n📊 By Type:');
  Object.entries(types).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });
  
  console.log('\n🏷️  By Brand:');
  Object.entries(brands).forEach(([brand, count]) => {
    console.log(`  ${brand}: ${count}`);
  });
  
  if (Object.keys(typeCategories).length > 0) {
    console.log('\n📂 By Type Category:');
    Object.entries(typeCategories).forEach(([category, count]) => {
      console.log(`  ${category}: ${count}`);
    });
  }
  
  console.log('\n💰 Price Range:');
  const prices = products.map(p => parseInt(p.price)).filter(p => !isNaN(p));
  if (prices.length > 0) {
    console.log(`  Min: ₹${Math.min(...prices)}`);
    console.log(`  Max: ₹${Math.max(...prices)}`);
    console.log(`  Avg: ₹${Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)}`);
  }
}

async function main() {
  try {
    console.log('🚀 Starting PRODUCT INSERTION process...\n');
    
    // Step 1: Read Excel file
    const products = readExcelFile();
    
    // Step 2: Show product summary
    showProductSummary(products);
    
    // Step 3: Insert products into database
    await insertProductsToDatabase(products);
    
    // Step 4: Generate error report
    generateErrorReport();
    
    // Final summary
    console.log('\n📊 Final Summary (PRODUCT INSERTION):');
    console.log(`✅ Products inserted: ${successCount.products}`);
    console.log(`❌ Errors encountered: ${errors.length}`);
    
    if (errors.length > 0) {
      const folderName = customFolder || explicitFolder || genderArg;
      console.log(`📄 Check product-insert-error-report-${folderName}.xlsx for detailed error information`);
    }
    
    console.log('\n🎯 Next Steps:');
    console.log('1. Check your remote database at: https://hhqnvjxnsbwhmrldohbz.supabase.co');
    console.log('2. Verify products were inserted correctly');
    console.log('3. Products are now available in your remote database');
    
  } catch (error) {
    console.error('💥 Fatal error:', error.message);
    process.exit(1);
  }
}

main(); 