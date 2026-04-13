const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

// Load environment variables
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Configuration
const STORAGE_BUCKET = 'product-images';
const UPLOAD_BATCH_SIZE = 10; // Upload 10 images at a time to avoid rate limits
const DELAY_BETWEEN_BATCHES = 1000; // 1 second delay between batches

// Helper function to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to sanitize filename for storage
function sanitizeFilename(filename) {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .toLowerCase();
}

// Helper function to generate product ID from folder name
function generateProductId(folderName, gender) {
  // Use folder name directly as it appears in the products database
  // For female products, append "_w" suffix
  if (gender === 'female') {
    return folderName + '_w';
  }
  return folderName;
}

// Helper function to determine image kind from folder path
function getImageKind(folderPath) {
  if (folderPath.includes('/flatlays/')) return 'flatlay';
  if (folderPath.includes('/model/')) return 'model';
  return 'detail'; // fallback
}

// Helper function to determine if image should be primary
function isPrimaryImage(kind) {
  // Only flatlay images are primary
  return kind === 'flatlay';
}

// Helper function to get sort order based on folder and processing order
function getSortOrder(kind, modelImageIndex = 0) {
  // Flatlay images always get sort_order = 1
  if (kind === 'flatlay') {
    return 1;
  }
  // Model images get sort_order starting from 2, 3, 4, etc.
  if (kind === 'model') {
    return 2 + modelImageIndex;
  }
  return 0; // fallback
}

// Helper function to get content type from file extension
function getContentType(filename) {
  const extension = path.extname(filename).toLowerCase();
  switch (extension) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    default:
      return 'image/jpeg'; // fallback
  }
}

async function uploadImageToStorage(filePath, storagePath) {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const filename = path.basename(filePath);
    const contentType = getContentType(filename);
    
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, fileBuffer, {
        contentType: contentType,
        upsert: false
      });

    if (error) {
      console.error(`❌ Upload failed for ${filePath}:`, error.message);
      return null;
    }

    // Generate public URL
    const { data: urlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(storagePath);

    return urlData.publicUrl;
  } catch (error) {
    console.error(`❌ Error uploading ${filePath}:`, error.message);
    return null;
  }
}

async function processProductFolder(productFolderPath, gender) {
  const productName = path.basename(productFolderPath);
  const productId = generateProductId(productName, gender);
  const results = [];

  console.log(`\n📁 Processing product: ${productName}`);

  try {
    const flatlaysPath = path.join(productFolderPath, 'flatlays');
    const modelPath = path.join(productFolderPath, 'model');

    // Process flatlays
    if (fs.existsSync(flatlaysPath)) {
      const flatlayFiles = await readdir(flatlaysPath);
      const imageFiles = flatlayFiles.filter(file => 
        /\.(jpg|jpeg|png)$/i.test(file)
      );

      for (let i = 0; i < imageFiles.length; i++) {
        const filename = imageFiles[i];
        const filePath = path.join(flatlaysPath, filename);
        const sortOrder = getSortOrder('flatlay');
        const isPrimary = isPrimaryImage('flatlay');
        
        const storagePath = `product_photos/${gender}/${productName}/flatlays/${sanitizeFilename(filename)}`;
        
        console.log(`  📤 Uploading flatlay: ${filename}`);
        const url = await uploadImageToStorage(filePath, storagePath);
        
        if (url) {
          results.push({
            product_id: productId,
            kind: 'flatlay',
            sort_order: sortOrder,
            is_primary: isPrimary,
            url: url,
            product_name: productName,
            gender: gender,
            filename: filename
          });
        }
        
        // Add delay between uploads
        await delay(200);
      }
    }

    // Process model shots
    if (fs.existsSync(modelPath)) {
      const modelFiles = await readdir(modelPath);
      const imageFiles = modelFiles.filter(file => 
        /\.(jpg|jpeg|png)$/i.test(file)
      );

      for (let i = 0; i < imageFiles.length; i++) {
        const filename = imageFiles[i];
        const filePath = path.join(modelPath, filename);
        const sortOrder = getSortOrder('model', i); // Pass index for sequential numbering
        const isPrimary = isPrimaryImage('model');
        
        const storagePath = `product_photos/${gender}/${productName}/model/${sanitizeFilename(filename)}`;
        
        console.log(`  📤 Uploading model: ${filename}`);
        const url = await uploadImageToStorage(filePath, storagePath);
        
        if (url) {
          results.push({
            product_id: productId,
            kind: 'model',
            sort_order: sortOrder,
            is_primary: isPrimary,
            url: url,
            product_name: productName,
            gender: gender,
            filename: filename
          });
        }
        
        // Add delay between uploads
        await delay(200);
      }
    }

    console.log(`  ✅ Completed: ${results.length} images uploaded`);
    return results;

  } catch (error) {
    console.error(`❌ Error processing ${productName}:`, error.message);
    return [];
  }
}

async function uploadAllProductImages() {
  console.log('🚀 Starting Product Images Upload Process\n');
  
  const allResults = [];
  const errors = [];

  // Process male products
  console.log('👔 Processing MALE products...');
  const maleProductsPath = path.join(__dirname, '../product_images/male');
  
  if (fs.existsSync(maleProductsPath)) {
    const maleProductFolders = await readdir(maleProductsPath);
    
    for (let i = 0; i < maleProductFolders.length; i++) {
      const folderName = maleProductFolders[i];
      const folderPath = path.join(maleProductsPath, folderName);
      
      const stats = await stat(folderPath);
      if (stats.isDirectory() && !folderName.startsWith('.')) {
        try {
          const results = await processProductFolder(folderPath, 'male');
          allResults.push(...results);
          
          // Add delay between products
          await delay(500);
        } catch (error) {
          errors.push({ product: folderName, error: error.message });
        }
      }
    }
  }

  // Process female products
  console.log('\n👗 Processing FEMALE products...');
  const femaleProductsPath = path.join(__dirname, '../product_images/female');
  
  if (fs.existsSync(femaleProductsPath)) {
    const femaleProductFolders = await readdir(femaleProductsPath);
    
    for (let i = 0; i < femaleProductFolders.length; i++) {
      const folderName = femaleProductFolders[i];
      const folderPath = path.join(femaleProductsPath, folderName);
      
      const stats = await stat(folderPath);
      if (stats.isDirectory() && !folderName.startsWith('.')) {
        try {
          const results = await processProductFolder(folderPath, 'female');
          allResults.push(...results);
          
          // Add delay between products
          await delay(500);
        } catch (error) {
          errors.push({ product: folderName, error: error.message });
        }
      }
    }
  }

  // Generate Excel file
  console.log('\n📊 Generating Excel mapping file...');
  
  // Create workbook with multiple sheets
  const workbook = XLSX.utils.book_new();
  
  // Main sheet for database upload
  const dbData = allResults.map(item => ({
    product_id: item.product_id,
    kind: item.kind,
    sort_order: item.sort_order,
    is_primary: item.is_primary,
    url: item.url,
    gender: item.gender
  }));
  
  const dbWorksheet = XLSX.utils.json_to_sheet(dbData);
  XLSX.utils.book_append_sheet(workbook, dbWorksheet, 'Database_Upload');
  
  // Detailed sheet with all information
  const detailedWorksheet = XLSX.utils.json_to_sheet(allResults);
  XLSX.utils.book_append_sheet(workbook, detailedWorksheet, 'Detailed_Mapping');
  
  // Summary sheet
  const summaryData = [
    { metric: 'Total Images Uploaded', value: allResults.length },
    { metric: 'Male Products', value: allResults.filter(r => r.gender === 'male').length },
    { metric: 'Female Products', value: allResults.filter(r => r.gender === 'female').length },
    { metric: 'Flatlay Images', value: allResults.filter(r => r.kind === 'flatlay').length },
    { metric: 'Model Images', value: allResults.filter(r => r.kind === 'model').length },
    { metric: 'Primary Images', value: allResults.filter(r => r.is_primary).length },
    { metric: 'Upload Errors', value: errors.length }
  ];
  
  const summaryWorksheet = XLSX.utils.json_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Summary');
  
  // Save Excel file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const excelFilename = `product-images-upload-mapping_${timestamp}.xlsx`;
  const excelPath = path.join(__dirname, '..', excelFilename);
  
  XLSX.writeFile(workbook, excelPath);
  
  // Save JSON backup
  const jsonFilename = `product-images-upload-results_${timestamp}.json`;
  const jsonPath = path.join(__dirname, '..', jsonFilename);
  fs.writeFileSync(jsonPath, JSON.stringify({
    uploadDate: new Date().toISOString(),
    totalImages: allResults.length,
    results: allResults,
    errors: errors
  }, null, 2));

  // Print summary
  console.log('\n📋 UPLOAD SUMMARY:');
  console.log(`  ✅ Total images uploaded: ${allResults.length}`);
  console.log(`  📁 Male products: ${allResults.filter(r => r.gender === 'male').length}`);
  console.log(`  📁 Female products: ${allResults.filter(r => r.gender === 'female').length}`);
  console.log(`  🖼️  Flatlay images: ${allResults.filter(r => r.kind === 'flatlay').length}`);
  console.log(`  👤 Model images: ${allResults.filter(r => r.kind === 'model').length}`);
  console.log(`  ⭐ Primary images: ${allResults.filter(r => r.is_primary).length}`);
  console.log(`  ❌ Errors: ${errors.length}`);
  
  console.log(`\n📄 Files generated:`);
  console.log(`  📊 Excel mapping: ${excelFilename}`);
  console.log(`  📄 JSON backup: ${jsonFilename}`);
  
  if (errors.length > 0) {
    console.log('\n❌ Errors encountered:');
    errors.forEach(error => {
      console.log(`  - ${error.product}: ${error.error}`);
    });
  }
  
  console.log('\n🎉 Upload process completed!');
  console.log('\n📝 Next steps:');
  console.log('  1. Review the Excel file for accuracy');
  console.log('  2. Use the "Database_Upload" sheet to populate product_images table');
  console.log('  3. Verify all images are accessible via the generated URLs');
  
  return {
    success: true,
    totalImages: allResults.length,
    errors: errors.length,
    excelFile: excelFilename,
    jsonFile: jsonFilename
  };
}

// CLI argument parsing
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🚀 Product Images Upload Script

Usage: bun scripts/upload-product-images.js [options]

Options:
  --help, -h     Show this help message
  --dry-run      Show what would be uploaded without actually uploading
  --batch-size   Number of images to upload in parallel (default: 10)
  --delay        Delay between batches in ms (default: 1000)

Example:
  bun scripts/upload-product-images.js --batch-size 5 --delay 2000
    `);
    return;
  }

  if (args.includes('--dry-run')) {
    console.log('🔍 DRY RUN MODE - No actual uploads will be performed');
    // TODO: Implement dry run functionality
    return;
  }

  try {
    await uploadAllProductImages();
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { uploadAllProductImages };
