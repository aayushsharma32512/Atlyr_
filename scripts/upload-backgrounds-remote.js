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

console.log('🔧 Using REMOTE Supabase database for background upload');
console.log('📊 URL:', REMOTE_SUPABASE_URL);
console.log('🔑 Using remote service role key\n');

const supabase = createClient(REMOTE_SUPABASE_URL, REMOTE_SUPABASE_KEY);

// Error tracking
const errors = [];
const successCount = { backgrounds: 0 };

async function createBackgroundsBucket() {
  try {
    console.log('📦 Creating backgrounds storage bucket...');
    
    // Check if bucket exists
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    if (listError) throw listError;
    
    const bucketExists = buckets.some(bucket => bucket.name === 'backgrounds');
    
    if (!bucketExists) {
      const { error } = await supabase.storage.createBucket('backgrounds', {
        public: true,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg'],
        fileSizeLimit: 5242880 // 5MB
      });
      
      if (error) throw error;
      console.log('✅ Storage bucket "backgrounds" created successfully');
    } else {
      console.log('✅ Storage bucket "backgrounds" already exists');
    }
  } catch (error) {
    console.error('❌ Error creating storage bucket:', error.message);
    throw error;
  }
}

async function uploadBackgroundToStorage(imagePath, imageName) {
  try {
    const fileBuffer = fs.readFileSync(imagePath);
    const storagePath = `backgrounds/${imageName}`;
    
    const { data, error } = await supabase.storage
      .from('backgrounds')
      .upload(storagePath, fileBuffer, {
        contentType: 'image/png',
        upsert: true
      });
    
    if (error) throw error;
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from('backgrounds')
      .getPublicUrl(storagePath);
    
    successCount.backgrounds++;
    console.log(`✅ Uploaded: ${imageName}`);
    
    return {
      originalName: imageName,
      storagePath: storagePath,
      publicUrl: urlData.publicUrl,
      success: true
    };
  } catch (error) {
    console.error(`❌ Failed to upload ${imageName}:`, error.message);
    errors.push({
      type: 'background_upload',
      filename: imageName,
      error: error.message
    });
    
    return {
      originalName: imageName,
      success: false,
      error: error.message
    };
  }
}

async function uploadAllBackgrounds() {
  console.log('🖼️  Starting background uploads...');
  
  const backgroundsDir = path.join(__dirname, '../public/Backgrounds');
  
  if (!fs.existsSync(backgroundsDir)) {
    console.error('❌ Backgrounds directory not found:', backgroundsDir);
    return;
  }
  
  const backgroundFiles = fs.readdirSync(backgroundsDir)
    .filter(file => file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg'));
  
  console.log(`📁 Found ${backgroundFiles.length} background files`);
  
  const uploadResults = [];
  
  for (const filename of backgroundFiles) {
    const imagePath = path.join(backgroundsDir, filename);
    const result = await uploadBackgroundToStorage(imagePath, filename);
    uploadResults.push(result);
    
    // Small delay to avoid overwhelming the API
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  return uploadResults;
}

function generateBackgroundMapping(uploadResults) {
  console.log('\n📋 Generating background URL mapping...');
  
  const successfulUploads = uploadResults.filter(result => result.success);
  
  // Prepare data for Excel
  const excelData = successfulUploads.map(result => ({
    'Old Path': `/Backgrounds/${result.originalName}`,
    'New URL': result.publicUrl,
    'Filename': result.originalName,
    'Storage Path': result.storagePath
  }));
  
  // Create workbook and worksheet
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(excelData);
  
  // Set column widths
  const columnWidths = [
    { wch: 20 }, // Old Path
    { wch: 80 }, // New URL
    { wch: 15 }, // Filename
    { wch: 25 }  // Storage Path
  ];
  worksheet['!cols'] = columnWidths;
  
  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Background Mapping');
  
  // Save Excel file
  const excelPath = path.join(__dirname, '../background-url-mapping-remote.xlsx');
  XLSX.writeFile(workbook, excelPath);
  
  console.log('✅ Background URL mapping saved to:', excelPath);
  console.log('\n📊 Mapping Preview:');
  excelData.forEach(row => {
    console.log(`  ${row['Old Path']} → ${row['New URL']}`);
  });
  
  return excelData;
}

function generateErrorReport() {
  if (errors.length === 0) {
    console.log('\n✅ No errors encountered!');
    return;
  }
  
  console.log('\n❌ Error Report:');
  console.log(`Total errors: ${errors.length}`);
  
  const errorPath = path.join(__dirname, '../background-upload-errors-remote.json');
  fs.writeFileSync(errorPath, JSON.stringify(errors, null, 2));
  console.log('📄 Error details saved to:', errorPath);
  
  errors.forEach((error, index) => {
    console.log(`  ${index + 1}. ${error.type}: ${error.filename} - ${error.error}`);
  });
}

async function main() {
  try {
    console.log('🚀 Starting background upload to REMOTE Supabase...\n');
    
    // Step 1: Create storage bucket
    await createBackgroundsBucket();
    
    // Step 2: Upload all backgrounds
    const uploadResults = await uploadAllBackgrounds();
    
    // Step 3: Generate URL mapping
    const mapping = generateBackgroundMapping(uploadResults);
    
    // Step 4: Generate error report
    generateErrorReport();
    
    // Step 5: Summary
    console.log('\n📈 Upload Summary:');
    console.log(`  ✅ Successful uploads: ${successCount.backgrounds}`);
    console.log(`  ❌ Failed uploads: ${errors.length}`);
    console.log(`  📊 Total files processed: ${uploadResults.length}`);
    
    if (successCount.backgrounds > 0) {
      console.log('\n🎉 Background upload to REMOTE completed successfully!');
      console.log('📝 Next steps:');
      console.log('  1. Use the mapping file to update your database');
      console.log('  2. Update your application code to use the new URL format');
      console.log('  3. Test the new background URLs in your application');
      console.log('  4. Deploy the updated database schema');
    }
    
  } catch (error) {
    console.error('💥 Fatal error:', error.message);
    process.exit(1);
  }
}

main(); 