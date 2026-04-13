import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the Excel mapping file
function readBackgroundMapping() {
  const excelPath = path.join(__dirname, '../background-url-mapping.xlsx');
  
  if (!fs.existsSync(excelPath)) {
    console.error('❌ Excel mapping file not found:', excelPath);
    console.log('Please run the upload-backgrounds.js script first');
    return null;
  }
  
  const workbook = XLSX.readFile(excelPath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet);
  
  console.log('📊 Read mapping data:', data.length, 'entries');
  return data;
}

// Generate SQL update statements
function generateUpdateSQL(mappingData) {
  console.log('\n🔧 Generating SQL update statements...');
  
  const updateStatements = [];
  
  mappingData.forEach(row => {
    const oldPath = row['Old Path'];
    const newUrl = row['New URL'];
    
    const updateSQL = `
-- Update background_id for outfits using ${oldPath}
UPDATE public.outfits 
SET background_id = '${newUrl}'
WHERE background_id = '${oldPath}';`;
    
    updateStatements.push(updateSQL);
  });
  
  return updateStatements;
}

// Create migration file
function createMigrationFile(updateStatements) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
  const migrationName = `20250731190000_update_background_urls.sql`;
  const migrationPath = path.join(__dirname, '../supabase/migrations', migrationName);
  
  const migrationContent = `-- Migration: Update background_id URLs to use Supabase Storage
-- This migration updates outfit background_id values to use Supabase Storage URLs instead of local file paths

${updateStatements.join('\n')}

-- Verify the updates
SELECT 
    id, 
    name, 
    background_id,
    CASE 
        WHEN background_id LIKE 'http://127.0.0.1:54321/storage%' THEN '✅ Updated to Supabase Storage'
        WHEN background_id LIKE '/Backgrounds/%' THEN '❌ Still using local path'
        ELSE '❓ Unknown format'
    END as status
FROM public.outfits 
WHERE background_id IS NOT NULL
ORDER BY id;
`;
  
  fs.writeFileSync(migrationPath, migrationContent);
  console.log('✅ Migration file created:', migrationPath);
  
  return migrationPath;
}

// Main function
function main() {
  try {
    console.log('🚀 Starting background URL update process...\n');
    
    // Step 1: Read the Excel mapping
    const mappingData = readBackgroundMapping();
    if (!mappingData) {
      return;
    }
    
    // Step 2: Generate SQL update statements
    const updateStatements = generateUpdateSQL(mappingData);
    
    // Step 3: Create migration file
    const migrationPath = createMigrationFile(updateStatements);
    
    // Step 4: Show preview
    console.log('\n📋 SQL Update Preview:');
    updateStatements.forEach((sql, index) => {
      console.log(`  ${index + 1}. ${sql.split('\n')[2].trim()}`);
    });
    
    console.log('\n📝 Next steps:');
    console.log('  1. Review the generated migration file');
    console.log('  2. Run the migration: bunx supabase db push --local');
    console.log('  3. Verify the updates in your database');
    console.log('  4. Test the new background URLs in your application');
    
  } catch (error) {
    console.error('💥 Error:', error.message);
    process.exit(1);
  }
}

main(); 