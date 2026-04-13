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

console.log('🔧 Using REMOTE Supabase database for product upload');
console.log('📊 URL:', REMOTE_SUPABASE_URL);
console.log('🔑 Using remote service role key\n');

const supabase = createClient(REMOTE_SUPABASE_URL, REMOTE_SUPABASE_KEY);

// ---------------- CLI ARG PARSING ----------------
// Usage: bun node scripts/upload-products.js --gender women
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

const genderArgRaw = (getArg('gender', 'men') || '').toLowerCase();
const genderArg = ['men', 'women'].includes(genderArgRaw) ? genderArgRaw : 'men';
const folderFromGender = genderArg === 'women' ? 'Women_Outfits' : 'Men_Outfits';
console.log(`🎯 Target gender: ${genderArg} | Folder: ${folderFromGender}`);

// Error tracking
const errors = [];
const successCount = { products: 0 };

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

async function uploadImageToStorage(imagePath, imageName) {
  try {
    const fileBuffer = fs.readFileSync(imagePath);
    const storagePath = `product-images/${imageName}`;
    
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
      type: 'image_upload',
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

async function uploadAllImages() {
  console.log('🖼️  Starting image uploads...');
  
  const uploadResults = [];
  const folders = [folderFromGender];
  
  for (const folder of folders) {
    console.log(`\n📁 Processing ${folder}...`);
    
    const imagesDir = path.join(__dirname, `../${folder}/DB_Ready_Products/DB_Ready_Images`);
    
    // Check if directory exists
    if (!fs.existsSync(imagesDir)) {
      console.log(`⚠️  Directory not found: ${imagesDir}`);
      continue;
    }
    
    const imageFiles = fs.readdirSync(imagesDir).filter(file => 
      file.toLowerCase().endsWith('.png') || 
      file.toLowerCase().endsWith('.jpg') || 
      file.toLowerCase().endsWith('.jpeg')
    );
    
    console.log(` Found ${imageFiles.length} images in ${folder}`);
    
    for (const imageFile of imageFiles) {
      const imagePath = path.join(imagesDir, imageFile);
      const result = await uploadImageToStorage(imagePath, imageFile);
      uploadResults.push(result);
      
      // Small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return uploadResults;
}

function readExcelFiles() {
  console.log('📊 Reading Excel files...');
  
  const allProducts = [];
  const folders = [folderFromGender];
  
  for (const folder of folders) {
    console.log(`\n📁 Reading ${folder} Excel file...`);
    
    const excelPath = path.join(__dirname, `../${folder}/DB_Ready_Products/DB_Ready_List.xlsx`);
    
    // Check if file exists
    if (!fs.existsSync(excelPath)) {
      console.log(`⚠️  Excel file not found: ${excelPath}`);
      continue;
    }
    
    try {
      const workbook = XLSX.readFile(excelPath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const products = XLSX.utils.sheet_to_json(worksheet);
      
      // Debug: Log the first product to see column names
      if (products.length > 0) {
        console.log(`🔍 Sample product columns:`, Object.keys(products[0]));
        console.log(`🔍 Sample product:`, products[0]);
      }
      
      allProducts.push(...products);
      console.log(`✅ Loaded ${products.length} products from ${folder}`);
      
    } catch (error) {
      console.error(`❌ Error reading ${folder} Excel file:`, error.message);
      errors.push({
        type: 'excel_read',
        folder: folder,
        error: error.message
      });
    }
  }
  
  console.log(`📊 Total products loaded: ${allProducts.length}`);
  return allProducts;
}

function prepareProductsForDatabase(products) {
  console.log('🔗 Preparing products for database insertion...');
  
  // Simply use the products as they are since image_url is already in Excel
  const preparedProducts = products.map(product => ({
    ...product,
    // Ensure image_url is used from Excel (already contains live URLs)
    image_url: product.image_url
  }));
  
  console.log(`✅ Prepared ${preparedProducts.length} products for database insertion`);
  return preparedProducts;
}

async function insertProductsToDatabase(products) {
  console.log('💾 Inserting products into database...');
  
  // Remove duplicates based on ID
  const uniqueProducts = [];
  const seenIds = new Set();
  
  products.forEach(product => {
    if (!seenIds.has(product.id)) {
      seenIds.add(product.id);
      uniqueProducts.push(product);
    } else {
      console.log(`⚠️  Skipping duplicate product ID: ${product.id}`);
    }
  });
  
  console.log(`📊 Original products: ${products.length}`);
  console.log(`📊 Unique products after deduplication: ${uniqueProducts.length}`);
  
  const productsToInsert = uniqueProducts.map(product => ({
    id: product.id,
    type: product.type,
    brand: product.brand,
    product_name: product.product_name ?? null,
    size: product.size,
    price: product.price,
    currency: product.currency,
    image_url: product.image_url,
    description: product.description,
    color: product.color,
    color_group: product.color_group ?? product.Color_group ?? null,
    created_at: product.created_at || new Date().toISOString(),
    updated_at: product.updated_at || new Date().toISOString(),
    placement_x: product.placement_x ?? null,
    placement_y: product.placement_y,
    fit: product.fit,
    feel: product.feel,
    category_id: product.category_id,
    image_length: product.image_length,
    product_length: product.product_length,
    product_url: product.product_url,
    gender: product.gender
  }));
  
  try {
    const { data, error } = await supabase
      .from('products')
      .upsert(productsToInsert, { onConflict: 'id', ignoreDuplicates: true });
    
    if (error) throw error;
    
    successCount.products = productsToInsert.length;
    console.log(`✅ Successfully inserted ${productsToInsert.length} products`);
    
  } catch (error) {
    console.error('❌ Error inserting products:', error.message);
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
    console.log(`${index + 1}. ${error.type}: ${error.filename || error.folder || 'N/A'}`);
    console.log(`   Error: ${error.error}`);
    console.log('');
  });
  
  // Save error report to file
  const errorReportPath = path.join(__dirname, '../upload-errors.json');
  fs.writeFileSync(errorReportPath, JSON.stringify(errors, null, 2));
  console.log(`📄 Error report saved to: ${errorReportPath}`);
}

function generateUrlMapping(uploadResults) {
  console.log('\n📝 Generating URL mapping...');
  
  const successfulUploads = uploadResults.filter(result => result.success);
  const failedUploads = uploadResults.filter(result => !result.success);
  
  const mapping = {
    successful: successfulUploads.map(result => ({
      originalName: result.originalName,
      storagePath: result.storagePath,
      publicUrl: result.publicUrl
    })),
    failed: failedUploads.map(result => ({
      originalName: result.originalName,
      error: result.error
    }))
  };
  
  // Save to file
  const outputPath = path.join(__dirname, '../image-url-mapping.json');
  fs.writeFileSync(outputPath, JSON.stringify(mapping, null, 2));
  
  console.log(`✅ URL mapping saved to: ${outputPath}`);
  console.log(`✅ Successful uploads: ${successfulUploads.length}`);
  console.log(`❌ Failed uploads: ${failedUploads.length}`);
  
  return mapping;
}

async function main() {
  try {
    console.log('🚀 Starting product data upload process...\n');
    
    // Step 1: Read Excel files
    const products = readExcelFiles();
    
    // Step 2: Prepare products for database insertion
    const preparedProducts = prepareProductsForDatabase(products);
    
    // Step 3: Insert products into database
    await insertProductsToDatabase(preparedProducts);
    
    // Step 4: Generate error report
    generateErrorReport();
    
    // Final summary
    console.log('\n📊 Final Summary:');
    console.log(`✅ Products inserted: ${successCount.products}`);
    console.log(`❌ Errors encountered: ${errors.length}`);
    
  } catch (error) {
    console.error('💥 Fatal error:', error.message);
    process.exit(1);
  }
}

main();