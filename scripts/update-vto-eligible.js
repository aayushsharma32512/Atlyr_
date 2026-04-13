import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Supabase configuration
const REMOTE_SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const REMOTE_SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!REMOTE_SUPABASE_URL || !REMOTE_SUPABASE_KEY) {
  console.error('❌ Missing required environment variables: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

console.log('🔑 Using remote service role key\n');

const supabase = createClient(REMOTE_SUPABASE_URL, REMOTE_SUPABASE_KEY);

// Configuration
const BATCH_SIZE = 100; // Process updates in batches
const EXCEL_FILE_PATH = path.join(__dirname, '../product_images_rows_updated_new.xlsx');

// Statistics tracking
const stats = {
  totalRows: 0,
  processedRows: 0,
  successfulUpdates: 0,
  failedUpdates: 0,
  notFoundInDb: 0,
  normalizationApplied: 0,
  errors: []
};

/**
 * Normalize vto_eligible values to proper boolean
 * Handles various formats: "TRUE ", "true", "false", "FALSE", etc.
 */
function normalizeVtoEligible(value) {
  if (value === null || value === undefined) {
    return false; // Default to false for null/undefined
  }
  
  // Convert to string and trim whitespace
  const stringValue = String(value).trim().toLowerCase();
  
  // Check for true values
  if (stringValue === 'true' || stringValue === '1' || stringValue === 'yes') {
    return true;
  }
  
  // Check for false values
  if (stringValue === 'false' || stringValue === '0' || stringValue === 'no' || stringValue === '') {
    return false;
  }
  
  // If we can't determine, default to false and log warning
  console.warn(`⚠️  Unknown vto_eligible value: "${value}" - defaulting to false`);
  return false;
}

/**
 * Read and validate Excel file
 */
async function readExcelFile() {
  console.log('📖 Reading Excel file...');
  
  if (!fs.existsSync(EXCEL_FILE_PATH)) {
    throw new Error(`Excel file not found at: ${EXCEL_FILE_PATH}`);
  }
  
  try {
    const workbook = XLSX.readFile(EXCEL_FILE_PATH);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`✅ Read ${data.length} rows from Excel file`);
    
    if (data.length === 0) {
      throw new Error('No data found in Excel file');
    }
    
    // Validate required columns
    const requiredColumns = ['id', 'vto_eligible'];
    const missingColumns = requiredColumns.filter(col => !(col in data[0]));
    
    if (missingColumns.length > 0) {
      throw new Error(`Missing required columns: ${missingColumns.join(', ')}`);
    }
    
    console.log(`📋 Columns found: ${Object.keys(data[0]).join(', ')}`);
    
    // Analyze vto_eligible values before normalization
    const vtoValues = data.map(row => row.vto_eligible);
    const uniqueValues = [...new Set(vtoValues)];
    console.log(`🔍 vto_eligible values found: ${uniqueValues.join(', ')}`);
    
    // Normalize data
    const normalizedData = data.map((row, index) => {
      const originalValue = row.vto_eligible;
      const normalizedValue = normalizeVtoEligible(originalValue);
      
      if (originalValue !== normalizedValue) {
        stats.normalizationApplied++;
        console.log(`🔄 Row ${index + 1}: "${originalValue}" → ${normalizedValue}`);
      }
      
      return {
        id: row.id,
        vto_eligible: normalizedValue,
        original_vto_eligible: originalValue
      };
    });
    
    console.log(`✅ Data normalization complete. ${stats.normalizationApplied} values normalized.`);
    
    return normalizedData;
    
  } catch (error) {
    console.error('❌ Error reading Excel file:', error.message);
    throw error;
  }
}

/**
 * Verify that Excel IDs exist in the database (chunked to avoid URL size limits)
 */
async function verifyIdsExist(data) {
  console.log('🔍 Verifying Excel IDs exist in database...');
  
  const excelIds = data.map(row => row.id);
  const uniqueIds = [...new Set(excelIds)];
  
  const VERIFICATION_CHUNK_SIZE = 200; // Smaller chunks to avoid URL size limits
  const dbIds = new Set();
  const missingIds = [];
  
  try {
    // Process IDs in chunks
    for (let i = 0; i < uniqueIds.length; i += VERIFICATION_CHUNK_SIZE) {
      const chunk = uniqueIds.slice(i, i + VERIFICATION_CHUNK_SIZE);
      const chunkNumber = Math.floor(i / VERIFICATION_CHUNK_SIZE) + 1;
      const totalChunks = Math.ceil(uniqueIds.length / VERIFICATION_CHUNK_SIZE);
      
      console.log(`🔍 Verifying chunk ${chunkNumber}/${totalChunks} (${chunk.length} IDs)...`);
      
      const { data: dbData, error } = await supabase
        .from('product_images')
        .select('id')
        .in('id', chunk);
      
      if (error) {
        throw error;
      }
      
      const chunkDbIds = new Set(dbData.map(row => row.id));
      const chunkMissingIds = chunk.filter(id => !chunkDbIds.has(id));
      
      // Add to our collections
      chunkDbIds.forEach(id => dbIds.add(id));
      missingIds.push(...chunkMissingIds);
      
      // Small delay between chunks
      if (i + VERIFICATION_CHUNK_SIZE < uniqueIds.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    
    if (missingIds.length > 0) {
      console.warn(`⚠️  ${missingIds.length} IDs from Excel not found in database:`);
      missingIds.slice(0, 10).forEach(id => console.warn(`   - ${id}`));
      if (missingIds.length > 10) {
        console.warn(`   ... and ${missingIds.length - 10} more`);
      }
    }
    
    console.log(`✅ Verification complete. ${dbIds.size}/${uniqueIds.length} IDs found in database.`);
    
    return {
      foundIds: dbIds,
      missingIds: missingIds
    };
    
  } catch (error) {
    console.error('❌ Error verifying IDs:', error.message);
    throw error;
  }
}

/**
 * Update a batch of records
 */
async function updateBatch(batch, batchNumber) {
  console.log(`📦 Processing batch ${batchNumber} (${batch.length} records)...`);
  
  const batchResults = {
    successful: 0,
    failed: 0,
    errors: []
  };
  
  // Process each record in the batch
  for (const record of batch) {
    try {
      const { data, error } = await supabase
        .from('product_images')
        .update({ vto_eligible: record.vto_eligible })
        .eq('id', record.id)
        .select('id');
      
      if (error) {
        throw error;
      }
      
      if (data && data.length > 0) {
        batchResults.successful++;
        stats.successfulUpdates++;
      } else {
        batchResults.failed++;
        stats.notFoundInDb++;
        batchResults.errors.push({
          id: record.id,
          error: 'Record not found in database'
        });
      }
      
    } catch (error) {
      batchResults.failed++;
      stats.failedUpdates++;
      batchResults.errors.push({
        id: record.id,
        error: error.message
      });
      
      stats.errors.push({
        id: record.id,
        error: error.message,
        batch: batchNumber
      });
    }
    
    stats.processedRows++;
  }
  
  console.log(`✅ Batch ${batchNumber} complete: ${batchResults.successful} successful, ${batchResults.failed} failed`);
  
  if (batchResults.errors.length > 0) {
    console.log(`❌ Batch ${batchNumber} errors:`);
    batchResults.errors.slice(0, 5).forEach(err => {
      console.log(`   - ID ${err.id}: ${err.error}`);
    });
    if (batchResults.errors.length > 5) {
      console.log(`   ... and ${batchResults.errors.length - 5} more errors`);
    }
  }
  
  return batchResults;
}

/**
 * Process all updates in batches
 */
async function processUpdates(data) {
  console.log(`\n🚀 Starting batch processing of ${data.length} records...`);
  
  stats.totalRows = data.length;
  
  // Split data into batches
  const batches = [];
  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    batches.push(data.slice(i, i + BATCH_SIZE));
  }
  
  console.log(`📦 Created ${batches.length} batches of up to ${BATCH_SIZE} records each`);
  
  // Process each batch
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchNumber = i + 1;
    
    try {
      await updateBatch(batch, batchNumber);
      
      // Add a small delay between batches to avoid overwhelming the database
      if (i < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
    } catch (error) {
      console.error(`❌ Fatal error in batch ${batchNumber}:`, error.message);
      stats.errors.push({
        batch: batchNumber,
        error: error.message,
        type: 'fatal'
      });
    }
  }
}

/**
 * Verify updates were applied correctly
 */
async function verifyUpdates(data) {
  console.log('\n🔍 Verifying updates...');
  
  // Sample a few records to verify
  const sampleSize = Math.min(10, data.length);
  const sampleRecords = data.slice(0, sampleSize);
  
  try {
    const sampleIds = sampleRecords.map(record => record.id);
    
    const { data: dbData, error } = await supabase
      .from('product_images')
      .select('id, vto_eligible')
      .in('id', sampleIds);
    
    if (error) {
      throw error;
    }
    
    let verificationPassed = 0;
    let verificationFailed = 0;
    
    sampleRecords.forEach(excelRecord => {
      const dbRecord = dbData.find(db => db.id === excelRecord.id);
      
      if (dbRecord && dbRecord.vto_eligible === excelRecord.vto_eligible) {
        verificationPassed++;
      } else {
        verificationFailed++;
        console.warn(`⚠️  Verification failed for ID ${excelRecord.id}: Excel=${excelRecord.vto_eligible}, DB=${dbRecord?.vto_eligible}`);
      }
    });
    
    console.log(`✅ Verification complete: ${verificationPassed}/${sampleSize} records verified successfully`);
    
    if (verificationFailed > 0) {
      console.warn(`⚠️  ${verificationFailed} records failed verification`);
    }
    
  } catch (error) {
    console.error('❌ Error during verification:', error.message);
  }
}

/**
 * Generate and save summary report
 */
function generateSummaryReport() {
  console.log('\n📊 SUMMARY REPORT');
  console.log('='.repeat(50));
  console.log(`Total rows in Excel: ${stats.totalRows}`);
  console.log(`Rows processed: ${stats.processedRows}`);
  console.log(`Successful updates: ${stats.successfulUpdates}`);
  console.log(`Failed updates: ${stats.failedUpdates}`);
  console.log(`Not found in DB: ${stats.notFoundInDb}`);
  console.log(`Values normalized: ${stats.normalizationApplied}`);
  console.log(`Total errors: ${stats.errors.length}`);
  
  if (stats.errors.length > 0) {
    console.log('\n❌ ERRORS:');
    stats.errors.slice(0, 10).forEach((error, index) => {
      console.log(`${index + 1}. ${error.id || 'Batch ' + error.batch}: ${error.error}`);
    });
    
    if (stats.errors.length > 10) {
      console.log(`... and ${stats.errors.length - 10} more errors`);
    }
  }
  
  // Save detailed report to file
  const reportData = {
    timestamp: new Date().toISOString(),
    summary: {
      totalRows: stats.totalRows,
      processedRows: stats.processedRows,
      successfulUpdates: stats.successfulUpdates,
      failedUpdates: stats.failedUpdates,
      notFoundInDb: stats.notFoundInDb,
      normalizationApplied: stats.normalizationApplied,
      errorCount: stats.errors.length
    },
    errors: stats.errors
  };
  
  const reportPath = path.join(__dirname, `../vto-eligible-update-report-${new Date().toISOString().split('T')[0]}.json`);
  
  try {
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);
  } catch (error) {
    console.error('❌ Error saving report:', error.message);
  }
}

/**
 * Main execution function
 */
async function main() {
  console.log('🚀 Starting vto_eligible column update process\n');
  
  try {
    // Step 1: Read and normalize Excel data
    const excelData = await readExcelFile();
    
    // Step 2: Verify IDs exist in database
    const verification = await verifyIdsExist(excelData);
    
    if (verification.missingIds.length > 0) {
      console.log(`\n⚠️  Proceeding with ${verification.missingIds.length} missing IDs (will be logged as failures)`);
    }
    
    // Step 3: Process updates in batches
    await processUpdates(excelData);
    
    // Step 4: Verify updates
    await verifyUpdates(excelData);
    
    // Step 5: Generate summary report
    generateSummaryReport();
    
    console.log('\n✅ Update process completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Fatal error during update process:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run the main function
main();
