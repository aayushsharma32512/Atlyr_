import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Remote Supabase configuration (same as other upload scripts)
const REMOTE_SUPABASE_URL = "https://hhqnvjxnsbwhmrldohbz.supabase.co";
const REMOTE_SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhocW52anhuc2J3aG1ybGRvaGJ6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Mjc0NjU2NiwiZXhwIjoyMDY4MzIyNTY2fQ.HKba451rI7d1cxFqdozeMss9TdSoMPmJD5f-ItAgOas";

console.log('🔧 Using REMOTE Supabase database for product updates');
console.log('📊 URL:', REMOTE_SUPABASE_URL);
console.log('🔑 Using remote service role key\n');

const supabase = createClient(REMOTE_SUPABASE_URL, REMOTE_SUPABASE_KEY);

// Error tracking
const errors = [];
const successCount = { updated: 0, skipped: 0, notFound: 0 };

// Columns to update (mapping Excel column names to database column names)
const COLUMNS_TO_UPDATE = [
  'description',
  'fit', 
  'feel',
  'vibes', // Excel has 'vibe' but database has 'vibes'
  'color_group',
  'product_name',
  'type_category'
];

// Map Excel column names to database column names
const COLUMN_MAPPING = {
  'vibe': 'vibes' // Map Excel 'vibe' to database 'vibes'
};

async function readExcelFile() {
  try {
    console.log('📖 Reading Excel file...');
    
    const excelPath = path.join(__dirname, '..', 'products_rows_1908_vSM_Upload.xlsm');
    
    if (!fs.existsSync(excelPath)) {
      throw new Error(`Excel file not found at: ${excelPath}`);
    }
    
    const workbook = XLSX.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`✅ Read ${data.length} rows from Excel file`);
    console.log(`📋 Columns found: ${Object.keys(data[0] || {}).join(', ')}`);
    
    // Validate required columns exist (check Excel column names)
    const requiredExcelColumns = COLUMNS_TO_UPDATE.map(dbCol => {
      // Find the Excel column name (reverse mapping)
      return Object.keys(COLUMN_MAPPING).find(key => COLUMN_MAPPING[key] === dbCol) || dbCol;
    });
    
    const missingColumns = requiredExcelColumns.filter(col => !(col in data[0]));
    if (missingColumns.length > 0) {
      throw new Error(`Missing required columns: ${missingColumns.join(', ')}`);
    }
    
    return data;
  } catch (error) {
    console.error('❌ Error reading Excel file:', error.message);
    throw error;
  }
}

async function updateProduct(productData) {
  try {
    const { id, ...updateData } = productData;
    
    // Only include the columns we want to update, with proper mapping
    const filteredUpdateData = {};
    COLUMNS_TO_UPDATE.forEach(dbCol => {
      // Find the Excel column name (reverse mapping)
      const excelCol = Object.keys(COLUMN_MAPPING).find(key => COLUMN_MAPPING[key] === dbCol) || dbCol;
      
      if (updateData[excelCol] !== undefined && updateData[excelCol] !== null && updateData[excelCol] !== '') {
        filteredUpdateData[dbCol] = updateData[excelCol];
      }
    });
    
    // Skip if no data to update
    if (Object.keys(filteredUpdateData).length === 0) {
      successCount.skipped++;
      console.log(`⏭️  Skipped ${id}: No data to update`);
      return;
    }
    
    // Update the product
    const { data, error } = await supabase
      .from('products')
      .update(filteredUpdateData)
      .eq('id', id)
      .select('id');
    
    if (error) {
      if (error.code === 'PGRST116') {
        // Product not found
        successCount.notFound++;
        console.log(`❌ Product not found: ${id}`);
        errors.push({ id, error: 'Product not found' });
      } else {
        throw error;
      }
    } else {
      successCount.updated++;
      console.log(`✅ Updated product: ${id}`);
    }
    
  } catch (error) {
    console.error(`❌ Error updating product ${productData.id}:`, error.message);
    errors.push({ id: productData.id, error: error.message });
  }
}

async function main() {
  try {
    console.log('🚀 Starting product details update...\n');
    
    // Read Excel file
    const products = await readExcelFile();
    
    console.log(`\n🔄 Processing ${products.length} products...\n`);
    
    // Process each product
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      console.log(`[${i + 1}/${products.length}] Processing: ${product.id}`);
      await updateProduct(product);
    }
    
    // Summary
    console.log('\n📊 Update Summary:');
    console.log(`✅ Successfully updated: ${successCount.updated}`);
    console.log(`⏭️  Skipped (no changes): ${successCount.skipped}`);
    console.log(`❌ Not found: ${successCount.notFound}`);
    console.log(`💥 Errors: ${errors.length}`);
    
    if (errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      errors.forEach(({ id, error }) => {
        console.log(`  - ${id}: ${error}`);
      });
      
      // Save errors to file
      const errorFile = path.join(__dirname, '..', 'update-product-errors.json');
      fs.writeFileSync(errorFile, JSON.stringify(errors, null, 2));
      console.log(`\n📄 Errors saved to: ${errorFile}`);
    }
    
    console.log('\n🎉 Product update process completed!');
    
  } catch (error) {
    console.error('💥 Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the script
main();
