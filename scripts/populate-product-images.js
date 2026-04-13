const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
const path = require('path');

// Load environment variables
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function populateProductImages(excelFilePath) {
  console.log('📊 Starting Product Images Database Population\n');
  
  try {
    // Read Excel file
    console.log(`📖 Reading Excel file: ${excelFilePath}`);
    const workbook = XLSX.readFile(excelFilePath);
    
    // Get the Database_Upload sheet
    const sheetName = 'Database_Upload';
    if (!workbook.SheetNames.includes(sheetName)) {
      throw new Error(`Sheet '${sheetName}' not found in Excel file. Available sheets: ${workbook.SheetNames.join(', ')}`);
    }
    
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`📋 Found ${data.length} rows to insert`);
    
    if (data.length === 0) {
      console.log('❌ No data found in Excel file');
      return { success: false, message: 'No data found' };
    }
    
    // Validate data structure
    console.log('\n🔍 Validating data structure...');
    const requiredColumns = ['product_id', 'kind', 'sort_order', 'is_primary', 'url', 'gender'];
    const sampleRow = data[0];
    
    const missingColumns = requiredColumns.filter(col => !(col in sampleRow));
    if (missingColumns.length > 0) {
      throw new Error(`Missing required columns: ${missingColumns.join(', ')}`);
    }
    
    console.log('✅ Data structure validation passed');
    
    // Validate data types and values
    console.log('\n🔍 Validating data values...');
    let validRows = 0;
    let invalidRows = 0;
    const validationErrors = [];
    
    data.forEach((row, index) => {
      const errors = [];
      
      // Check product_id
      if (!row.product_id || typeof row.product_id !== 'string') {
        errors.push('product_id missing or not string');
      }
      
      // Check kind
      if (!row.kind || !['flatlay', 'model', 'detail'].includes(row.kind.toLowerCase())) {
        errors.push(`kind must be 'flatlay', 'model', or 'detail', got: ${row.kind}`);
      }
      
      // Check sort_order
      if (typeof row.sort_order !== 'number' || row.sort_order < 0) {
        errors.push(`sort_order must be a non-negative number, got: ${row.sort_order}`);
      }
      
      // Check is_primary
      if (typeof row.is_primary !== 'boolean' && row.is_primary !== 0 && row.is_primary !== 1) {
        errors.push(`is_primary must be boolean (true/false) or 0/1, got: ${row.is_primary}`);
      }
      
      // Check url
      if (!row.url || typeof row.url !== 'string' || !row.url.startsWith('http')) {
        errors.push('url missing or not a valid URL');
      }
      
      // Check gender
      if (!row.gender || !['male', 'female'].includes(row.gender.toLowerCase())) {
        errors.push(`gender must be 'male' or 'female', got: ${row.gender}`);
      }
      
      if (errors.length > 0) {
        validationErrors.push({ row: index + 1, errors });
        invalidRows++;
      } else {
        validRows++;
      }
    });
    
    console.log(`✅ Valid rows: ${validRows}`);
    console.log(`❌ Invalid rows: ${invalidRows}`);
    
    if (invalidRows > 0) {
      console.log('\n❌ Validation errors found:');
      validationErrors.slice(0, 5).forEach(error => {
        console.log(`  Row ${error.row}: ${error.errors.join(', ')}`);
      });
      if (validationErrors.length > 5) {
        console.log(`  ... and ${validationErrors.length - 5} more errors`);
      }
      throw new Error(`Found ${invalidRows} invalid rows. Please fix the Excel file before proceeding.`);
    }
    
    // Check for primary image constraint violations
    console.log('\n🔍 Checking primary image constraints...');
    const productPrimaryCounts = {};
    data.forEach(row => {
      const productId = row.product_id;
      const isPrimary = row.is_primary === true || row.is_primary === 1;
      
      if (!productPrimaryCounts[productId]) {
        productPrimaryCounts[productId] = 0;
      }
      
      if (isPrimary) {
        productPrimaryCounts[productId]++;
      }
    });
    
    const productsWithMultiplePrimary = Object.entries(productPrimaryCounts)
      .filter(([productId, count]) => count > 1)
      .map(([productId, count]) => ({ productId, count }));
    
    if (productsWithMultiplePrimary.length > 0) {
      console.log('❌ Products with multiple primary images:');
      productsWithMultiplePrimary.forEach(({ productId, count }) => {
        console.log(`  - ${productId}: ${count} primary images`);
      });
      throw new Error('Found products with multiple primary images. Each product should have only one primary image.');
    }
    
    console.log('✅ Primary image constraint validation passed');
    
    // Prepare data for insertion
    console.log('\n📤 Preparing data for database insertion...');
    const insertData = data.map(row => ({
      product_id: row.product_id,
      kind: row.kind.toLowerCase(),
      sort_order: row.sort_order,
      is_primary: row.is_primary === true || row.is_primary === 1,
      url: row.url,
      gender: row.gender.toLowerCase()
    }));
    
    // Insert data in batches
    const BATCH_SIZE = 50;
    let insertedCount = 0;
    let errorCount = 0;
    const insertErrors = [];
    
    console.log(`\n📥 Inserting data in batches of ${BATCH_SIZE}...`);
    
    for (let i = 0; i < insertData.length; i += BATCH_SIZE) {
      const batch = insertData.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(insertData.length / BATCH_SIZE);
      
      console.log(`  📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} rows)...`);
      
      try {
        const { data: insertResult, error } = await supabase
          .from('product_images')
          .insert(batch)
          .select();
        
        if (error) {
          console.error(`  ❌ Batch ${batchNumber} failed:`, error.message);
          errorCount += batch.length;
          insertErrors.push({ batch: batchNumber, error: error.message });
        } else {
          console.log(`  ✅ Batch ${batchNumber} successful: ${insertResult.length} rows inserted`);
          insertedCount += insertResult.length;
        }
      } catch (error) {
        console.error(`  ❌ Batch ${batchNumber} failed:`, error.message);
        errorCount += batch.length;
        insertErrors.push({ batch: batchNumber, error: error.message });
      }
      
      // Add delay between batches
      if (i + BATCH_SIZE < insertData.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Print summary
    console.log('\n📋 DATABASE POPULATION SUMMARY:');
    console.log(`  ✅ Successfully inserted: ${insertedCount} rows`);
    console.log(`  ❌ Failed to insert: ${errorCount} rows`);
    console.log(`  📊 Total processed: ${insertData.length} rows`);
    
    if (insertErrors.length > 0) {
      console.log('\n❌ Insert errors:');
      insertErrors.forEach(error => {
        console.log(`  - Batch ${error.batch}: ${error.error}`);
      });
    }
    
    // Verify insertion
    console.log('\n🔍 Verifying database insertion...');
    const { data: verifyData, error: verifyError } = await supabase
      .from('product_images')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (verifyError) {
      console.error('❌ Verification failed:', verifyError.message);
    } else {
      console.log('✅ Database verification successful');
      console.log('📋 Sample inserted records:');
      verifyData.forEach(record => {
        console.log(`  - ${record.product_id} (${record.kind}): ${record.url.substring(0, 50)}...`);
      });
    }
    
    return {
      success: true,
      insertedCount,
      errorCount,
      totalProcessed: insertData.length,
      errors: insertErrors
    };
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// CLI argument parsing
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
📊 Product Images Database Population Script

Usage: bun scripts/populate-product-images.js [excel-file] [options]

Arguments:
  excel-file    Path to the Excel file generated by upload script

Options:
  --help, -h    Show this help message
  --verify      Only verify the Excel file without inserting data

Example:
  bun scripts/populate-product-images.js product-images-upload-mapping_2024-08-22.xlsx
    `);
    return;
  }
  
  if (args.length === 0) {
    console.error('❌ Please provide the Excel file path as an argument');
    console.log('Usage: bun scripts/populate-product-images.js [excel-file]');
    process.exit(1);
  }
  
  const excelFilePath = args[0];
  
  // Check if file exists
  if (!require('fs').existsSync(excelFilePath)) {
    console.error(`❌ Excel file not found: ${excelFilePath}`);
    process.exit(1);
  }
  
  if (args.includes('--verify')) {
    console.log('🔍 VERIFY MODE - Only validating Excel file');
    // TODO: Implement verify-only mode
    return;
  }
  
  try {
    const result = await populateProductImages(excelFilePath);
    
    if (result.success) {
      console.log('\n🎉 Database population completed successfully!');
      console.log('\n📝 Next steps:');
      console.log('  1. Verify the data in your Supabase dashboard');
      console.log('  2. Test the image URLs to ensure they are accessible');
      console.log('  3. Update your products table with vibes data if needed');
    } else {
      console.error('\n❌ Database population failed:', result.error);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { populateProductImages };
