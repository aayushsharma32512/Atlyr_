import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing required environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------------- CLI ARG PARSING ----------------
// Usage: bun node scripts/upload-outfits.js --gender women
function getArg(name, fallback) {
  const prefix = `--${name}`;
  const arg = process.argv.find(a => a === prefix || a.startsWith(prefix + '='));
  if (!arg) return fallback;
  if (arg.includes('=')) return arg.split('=')[1];
  const idx = process.argv.indexOf(arg);
  return process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')
    ? process.argv[idx + 1]
    : fallback;
}

const genderArgRaw = (getArg('gender', 'men') || '').toLowerCase();
const genderArg = ['men', 'women'].includes(genderArgRaw) ? genderArgRaw : 'men';
const folderFromGender = genderArg === 'women' ? 'Women_Outfits' : 'Men_Outfits';
const mappingFile = genderArg === 'women' ? 'Outfit_Mapping_DB_Women.xlsx' : 'Outfit_Mapping_DB.xlsx';
console.log(`🎯 Target gender: ${genderArg} | Folder: ${folderFromGender} | File: ${mappingFile}`);

// Error tracking
const errors = [];
const successCount = { outfits: 0 };

function readExcelFile() {
  console.log('📊 Reading Excel file...');
  
  const excelPath = path.join(__dirname, `../${folderFromGender}/${mappingFile}`);
  
  // Check if file exists
  if (!fs.existsSync(excelPath)) {
    console.log(`⚠️  Excel file not found: ${excelPath}`);
    return [];
  }
  
  try {
    const workbook = XLSX.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const outfits = XLSX.utils.sheet_to_json(worksheet);
    
    // Debug: Log the first outfit to see column names
    if (outfits.length > 0) {
      console.log(`🔍 Sample outfit columns:`, Object.keys(outfits[0]));
      console.log(`🔍 Sample outfit:`, outfits[0]);
    }
    
    console.log(`✅ Loaded ${outfits.length} outfits from Excel file`);
    return outfits;
    
  } catch (error) {
    console.error(`❌ Error reading Excel file:`, error.message);
    errors.push({
      type: 'excel_read',
      error: error.message
    });
    return [];
  }
}

function prepareOutfitsForDatabase(outfits) {
  console.log('🔗 Preparing outfits for database insertion...');
  
  // Remove duplicates based on ID
  const uniqueOutfits = [];
  const seenIds = new Set();
  
  outfits.forEach(outfit => {
    if (!seenIds.has(outfit.id)) {
      seenIds.add(outfit.id);
      uniqueOutfits.push(outfit);
    } else {
      console.log(`⚠️  Skipping duplicate outfit ID: ${outfit.id}`);
    }
  });
  
  console.log(`📊 Original outfits: ${outfits.length}`);
  console.log(`📊 Unique outfits after deduplication: ${uniqueOutfits.length}`);
  
  const normalizeProductId = (pid) => {
    if (!pid || typeof pid !== 'string') return null;
    if (genderArg === 'women') return pid.endsWith('_w') ? pid : `${pid}_w`;
    return pid;
  };

  const preparedOutfits = uniqueOutfits.map(outfit => {
    const derivedOccasion = outfit.occasion ?? outfit.occassion ?? outfit.category ?? 'casual-outing';
    return {
      id: outfit.id,
      name: outfit.name,
      category: outfit.category,
      occasion: derivedOccasion,
      background_id: outfit.background_id,
      created_at: outfit.created_at || new Date().toISOString(),
      updated_at: outfit.updated_at || new Date().toISOString(),
      top_id: normalizeProductId(outfit.top_id),
      bottom_id: normalizeProductId(outfit.bottom_id),
      shoes_id: normalizeProductId(outfit.shoes_id),
      gender: (outfit.gender || '').toString().toLowerCase() || genderArg,
      created_by: outfit.created_by,
      fit: outfit.fit,
      feel: outfit.feel,
      description: outfit.description,
      visible_in_feed: outfit.visible_in_feed,
      popularity: outfit.popularity,
      rating: outfit.rating,
      // Optional fields with defaults
      word_association: outfit.word_association || null,
      outfit_match: outfit.outfit_match || null
    };
  });
  
  console.log(`✅ Prepared ${preparedOutfits.length} outfits for database insertion`);
  return preparedOutfits;
}

async function insertOutfitsToDatabase(outfits) {
  console.log('💾 Inserting outfits into database...');
  
  try {
    const { data, error } = await supabase
      .from('outfits')
      .upsert(outfits, { onConflict: 'id', ignoreDuplicates: true });
    
    if (error) throw error;
    
    successCount.outfits = outfits.length;
    console.log(`✅ Successfully inserted ${outfits.length} outfits`);
    
  } catch (error) {
    console.error('❌ Error inserting outfits:', error.message);
    errors.push({
      type: 'database_insert',
      error: error.message
    });
  }
}

function generateErrorReport() {
  if (errors.length === 0) {
    console.log('\n✅ No errors to report!');
    return;
  }
  
  console.log('\n❌ Error Report:');
  console.log('================');
  
  errors.forEach((error, index) => {
    console.log(`${index + 1}. ${error.type}: ${error.folder || 'N/A'}`);
    console.log(`   Error: ${error.error}`);
    console.log('');
  });
  
  // Save error report to file
  const errorReportPath = path.join(__dirname, '../upload-outfits-errors.json');
  fs.writeFileSync(errorReportPath, JSON.stringify(errors, null, 2));
  console.log(`📄 Error report saved to: ${errorReportPath}`);
}

async function main() {
  try {
    console.log('🚀 Starting outfit upload process...\n');
    
    // Step 1: Read Excel file
    const outfits = readExcelFile();
    
    if (outfits.length === 0) {
      console.log('❌ No outfits found in Excel file');
      return;
    }
    
    // Step 2: Prepare outfits for database insertion
    const preparedOutfits = prepareOutfitsForDatabase(outfits);
    
    // Step 3: Insert outfits into database
    await insertOutfitsToDatabase(preparedOutfits);
    
    // Step 4: Generate error report
    generateErrorReport();
    
    // Final summary
    console.log('\n📊 Final Summary:');
    console.log(`✅ Outfits inserted: ${successCount.outfits}`);
    console.log(`❌ Errors encountered: ${errors.length}`);
    
  } catch (error) {
    console.error('💥 Fatal error:', error.message);
    process.exit(1);
  }
}

main(); 