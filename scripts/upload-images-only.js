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

console.log('🔧 Using REMOTE Supabase database for image upload');
console.log('📊 URL:', REMOTE_SUPABASE_URL);
console.log('🔑 Using remote service role key\n');

const supabase = createClient(REMOTE_SUPABASE_URL, REMOTE_SUPABASE_KEY);

// ---------------- CLI ARG PARSING ----------------
// Usage: bun node scripts/upload-images-only.js --gender women --staples
// Usage: bun node scripts/upload-images-only.js --folder staples
// Usage: bun node scripts/upload-images-only.js --gender women --folder staples
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

let folderFromGender, storageFolder;

if (customFolder) {
  // Use custom folder (e.g., --staples)
  folderFromGender = customFolder.charAt(0).toUpperCase() + customFolder.slice(1) + '_Outfits';
  storageFolder = customFolder.toLowerCase();
  console.log(`🎯 Custom folder detected: ${customFolder}`);
  console.log(`📁 Source folder: ${folderFromGender}`);
  console.log(`🗂️  Storage folder: ${storageFolder}`);
} else if (explicitFolder) {
  // Use explicit folder parameter (e.g., --folder staples)
  folderFromGender = explicitFolder.charAt(0).toUpperCase() + explicitFolder.slice(1) + '_Outfits';
  storageFolder = explicitFolder.toLowerCase();
  console.log(`🎯 Explicit folder: ${explicitFolder}`);
  console.log(`📁 Source folder: ${folderFromGender}`);
  console.log(`🗂️  Storage folder: ${storageFolder}`);
} else {
  // Use default gender-based folders
  folderFromGender = genderArg === 'women' ? 'Women_Outfits' : 'Men_Outfits';
  storageFolder = genderArg.toLowerCase();
  console.log(`🎯 Target gender: ${genderArg} | Folder: ${folderFromGender}`);
}

// Error tracking
const errors = [];
const successCount = { images: 0 };

async function createStorageBucket() {
  try {
    console.log('📦 Creating storage bucket...');
    
    // Check if bucket exists
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    if (listError) throw listError;
    
    const bucketExists = buckets.some(bucket => bucket.name === 'product-images');
    
    if (!bucketExists) {
      const { error } = await supabase.storage.createBucket('product-images', {
        public: true,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg'],
        fileSizeLimit: 5242880 // 5MB
      });
      
      if (error) throw error;
      console.log('✅ Storage bucket "product-images" created successfully');
    } else {
      console.log('✅ Storage bucket "product-images" already exists');
    }
  } catch (error) {
    console.error('❌ Error creating storage bucket:', error.message);
    throw error;
  }
}

async function uploadImageToStorage(imagePath, imageName, storageFolder) {
  try {
    const fileBuffer = fs.readFileSync(imagePath);
    const storagePath = `product-images/${storageFolder}/${imageName}`;
    
    const { data, error } = await supabase.storage
      .from('product-images')
      .upload(storagePath, fileBuffer, {
        contentType: 'image/png',
        upsert: true
      });
    
    if (error) throw error;
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from('product-images')
      .getPublicUrl(storagePath);
    
    successCount.images++;
    console.log(`✅ Uploaded: ${storageFolder}/${imageName}`);
    
    return {
      originalName: imageName,
      storagePath: storagePath,
      publicUrl: urlData.publicUrl,
      storageFolder: storageFolder,
      success: true
    };
  } catch (error) {
    console.error(`❌ Failed to upload ${storageFolder}/${imageName}:`, error.message);
    errors.push({
      type: 'image_upload',
      filename: imageName,
      storageFolder: storageFolder,
      error: error.message
    });
    
    return {
      originalName: imageName,
      storageFolder: storageFolder,
      success: false,
      error: error.message
    };
  }
}

async function uploadAllImages() {
  console.log(`🖼️  Starting image uploads for ${storageFolder}...`);
  
  const uploadResults = [];
  
  console.log(`\n📁 Processing ${folderFromGender}...`);
  
  const imagesDir = path.join(__dirname, `../${folderFromGender}/DB_Ready_Products/DB_Ready_Images`);
  
  // Check if directory exists
  if (!fs.existsSync(imagesDir)) {
    console.log(`⚠️  Directory not found: ${imagesDir}`);
    console.log(`💡 Please ensure the folder structure is: ${folderFromGender}/DB_Ready_Products/DB_Ready_Images/`);
    return uploadResults;
  }
  
  const imageFiles = fs.readdirSync(imagesDir).filter(file => 
    file.toLowerCase().endsWith('.png') || 
    file.toLowerCase().endsWith('.jpg') || 
    file.toLowerCase().endsWith('.jpeg')
  );
  
  console.log(` Found ${imageFiles.length} images in ${folderFromGender}`);
  
  for (const imageFile of imageFiles) {
    const imagePath = path.join(imagesDir, imageFile);
    const result = await uploadImageToStorage(imagePath, imageFile, storageFolder);
    uploadResults.push(result);
    
    // Small delay to avoid overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return uploadResults;
}

function generateUrlMapping(uploadResults) {
  console.log('\n📝 Generating URL mapping...');
  
  const successfulUploads = uploadResults.filter(result => result.success);
  const failedUploads = uploadResults.filter(result => !result.success);
  
  // Create mapping data with storage folder information
  const mappingData = successfulUploads.map(upload => ({
    'Original Filename': upload.originalName,
    'Storage Path': upload.storagePath,
    'Public URL': upload.publicUrl,
    'Storage Folder': upload.storageFolder,
    'Upload Status': 'Success'
  }));
  
  // Create workbook and worksheet
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(mappingData);
  
  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(workbook, worksheet, 'URL Mapping');
  
  // Write to file with folder-specific name
  const mappingPath = path.join(__dirname, `../image-url-mapping-${storageFolder}.xlsx`);
  XLSX.writeFile(workbook, mappingPath);
  
  console.log(`📄 URL mapping saved to: ${mappingPath}`);
  console.log(`✅ Mapped ${successfulUploads.length} images to URLs`);
  console.log(`❌ Failed uploads: ${failedUploads.length}`);
  
  return {
    successful: successfulUploads,
    failed: failedUploads
  };
}

function generateErrorReport() {
  if (errors.length === 0) {
    console.log('\n✅ No errors to report!');
    return;
  }
  
  console.log('\n❌ Error Report:');
  console.log('================');
  
  errors.forEach((error, index) => {
    console.log(`${index + 1}. ${error.type}: ${error.filename} (${error.storageFolder})`);
    console.log(`   Error: ${error.error}`);
    console.log('');
  });
  
  // Save error report to file with folder-specific name
  const errorReportPath = path.join(__dirname, `../upload-errors-${storageFolder}.json`);
  fs.writeFileSync(errorReportPath, JSON.stringify(errors, null, 2));
  console.log(` Error report saved to: ${errorReportPath}`);
}

async function main() {
  try {
    console.log('🚀 Starting image upload process...\n');
    
    // Create storage bucket
    await createStorageBucket();
    
    // Upload all images
    const uploadResults = await uploadAllImages();
    
    // Generate URL mapping
    generateUrlMapping(uploadResults);
    
    // Generate error report
    generateErrorReport();
    
    console.log('\n🎉 Image upload process completed!');
    console.log(`📊 Total images processed: ${uploadResults.length}`);
    console.log(`✅ Successful uploads: ${successCount.images}`);
    console.log(`❌ Failed uploads: ${errors.length}`);
    console.log(`🗂️  Images uploaded to: product-images/${storageFolder}/`);
    
  } catch (error) {
    console.error('💥 Fatal error:', error.message);
    process.exit(1);
  }
}

main(); 