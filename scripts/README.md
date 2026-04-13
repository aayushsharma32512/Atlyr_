# Product Upload Scripts

This directory contains scripts to upload product images to Supabase Storage and insert product data into the database.

## 📁 Files

- `upload-products.js` - Main script for uploading images and inserting products
- `setup-env.js` - Environment setup and validation
- `README.md` - This documentation

## 🚀 Quick Start

### 1. Set up Environment
```bash
bun run upload:setup
```
This will:
- Create a `.env` file if it doesn't exist
- Check for required environment variables
- Provide setup instructions

### 2. Configure Supabase Credentials
Edit the `.env` file with your Supabase credentials:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

### 3. Run the Upload
```bash
bun run upload:products
```

## 📋 What the Script Does

### Phase 1: Image Upload
1. **Creates Storage Bucket** - "product-images" (if it doesn't exist)
2. **Uploads All Images** - From `DB_Ready_Products/DB_Ready_Images/`
3. **Generates Public URLs** - For each uploaded image

### Phase 2: Data Processing
1. **Reads Excel File** - `DB_Ready_Products/DB_Ready_List.xlsx`
2. **Maps Image URLs** - Links products to their uploaded images
3. **Validates Data** - Checks required fields and data types

### Phase 3: Database Insertion
1. **Inserts Products** - Into the `products` table
2. **Error Handling** - Logs any issues during insertion
3. **Generates Report** - Creates `upload-error-report.xlsx`

## 📊 Expected Excel Structure

Your Excel file should have these columns matching the database schema:

| Column | Type | Required | Example |
|--------|------|----------|---------|
| `id` | TEXT | ✅ | `"top-1"` |
| `type` | ENUM | ✅ | `"top"`, `"bottom"`, `"shoes"` |
| `brand` | TEXT | ✅ | `"Style Co"` |
| `product_name` | TEXT | ❌ | `"Oxford Shirt"` |
| `size` | TEXT | ✅ | `"M"`, `"30"`, `"7"` |
| `price` | INTEGER | ✅ | `2999` (in paise) |
| `currency` | TEXT | ❌ | `"INR"` (defaults to INR) |
| `description` | TEXT | ✅ | `"Classic white shirt"` |
| `color` | TEXT | ✅ | `"White"` |
| `color_group` | TEXT | ❌ | `"Neutrals"`, `"Warm"`, `"Cool"` |
| `placement_y` | INTEGER | ❌ | `-3`, `33`, `80` |
| `placement_x` | INTEGER | ❌ | `-10`, `0`, `25` |

## 🖼️ Image Mapping

The script attempts to match images to products by:
1. **Filename matching** - Looking for product ID or brand in image filename
2. **Fallback** - If no match found, logs an error

**Image Naming Tips:**
- Include product ID in filename: `TOP_1_WHITE_SHIRT.png`
- Include brand name: `STYLE_CO_TOP_1.png`
- Use descriptive names: `CASUAL_WHITE_SHIRT_TOP.png`

## 📄 Output Files

### Success
- Images uploaded to Supabase Storage
- Products inserted into database
- Console summary of results

### Errors
- `upload-error-report.xlsx` - Detailed error log
- Console warnings for each issue
- Continues processing despite individual failures

## 🔧 Troubleshooting

### Common Issues

1. **Missing Environment Variables**
   ```bash
   bun run upload:setup
   # Then edit .env file
   ```

2. **Image Upload Failures**
   - Check file sizes (max 5MB)
   - Ensure images are PNG/JPG
   - Verify Supabase Storage permissions

3. **Database Insertion Errors**
   - Check required fields in Excel
   - Verify data types match schema
   - Check for duplicate product IDs

4. **Image Mapping Issues**
   - Review image filenames
   - Check product IDs in Excel
   - Adjust mapping logic if needed

### Debug Mode
Add `console.log` statements in the script to debug specific issues.

## 📈 Monitoring

The script provides real-time feedback:
- ✅ Success indicators for each step
- ❌ Error messages with details
- 📊 Final summary with counts
- 📄 Error report in Excel format

## 🔄 Re-running

The script is safe to re-run:
- **Images** - Uses `upsert: true` (overwrites existing)
- **Products** - Uses individual inserts (handles duplicates)
- **Error Report** - Overwrites previous report

## 📝 Notes

- **Service Role Key Required** - For storage and database access
- **Public Bucket** - Images will be publicly accessible
- **File Size Limit** - 5MB per image
- **Supported Formats** - PNG, JPG, JPEG
- **Error Logging** - All errors saved to Excel report

---

## 🎨 Fashion-SigLIP Embeddings

### generate-fashion-siglip-embeddings-local.js

Generates multimodal embeddings for products using the `Marqo/marqo-fashionSigLIP` model **locally** with transformers.js (no API required).

#### Purpose
- Creates 768-dimensional text embeddings from product metadata
- Creates 768-dimensional image embeddings from product images
- **Runs entirely locally** - no API keys or external calls needed
- Model weights downloaded and cached automatically from HuggingFace Hub
- Free to use with unlimited requests

#### Requirements
```bash
# Only Supabase credentials needed - NO API key required!
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
```

#### Installation
```bash
# Install transformers.js
bun add @huggingface/transformers

# On first run, models will be downloaded and cached locally
# This may take a few minutes but only happens once
```

#### Usage
```bash
# Run the script
bun run generate:embeddings:fashion
# or
node scripts/generate-fashion-siglip-embeddings-local.js
```

#### How It Works
1. **Model Loading**: Downloads and caches Fashion-SigLIP models locally (first run only)
   - AutoTokenizer for text processing
   - SiglipTextModel for text embeddings
   - AutoProcessor for image preprocessing
   - SiglipVisionModel for image embeddings
2. **Text Processing**: Concatenates product fields and generates embeddings
3. **Image Processing**: Loads images with RawImage and generates visual embeddings
4. **Normalization**: L2 normalizes all vectors to unit length
5. **Batch Processing**: Processes 20 products per batch (optimized for local inference)
6. **Database Update**: Saves embeddings to Supabase

#### Performance
- **Batch Size**: 20 products per batch (smaller for local memory management)
- **First Run**: Slower due to model downloads (~500MB total)
- **Subsequent Runs**: Fast - models loaded from cache
- **No Rate Limits**: Process as many products as needed
- **Cost**: $0 - completely free!

#### Output Example
```
======================================================================
🚀 Fashion-SigLIP Local Embedding Generation
======================================================================
📊 Model: Marqo/marqo-fashionSigLIP
🔗 Supabase URL: http://127.0.0.1:54321
💻 Mode: Local (no API calls)
======================================================================

📥 Loading models from HuggingFace Hub...
  🔤 Loading tokenizer...
  ✅ Tokenizer loaded
  📝 Loading text model...
  ✅ Text model loaded
  🖼️  Loading image processor...
  ✅ Image processor loaded
  🎨 Loading vision model...
  ✅ Vision model loaded

✅ All models loaded successfully!

📥 Fetching products from database...
📦 Found 150 products that need embeddings
   📝 Text embeddings needed: 75
   🖼️  Image embeddings needed: 80

======================================================================
🔄 BATCH 1/8 (20 products)
======================================================================

[1/20] Processing product: top-1
  📝 Generating text embedding...
  ✅ Text embedding generated (768 dimensions)
  🖼️  Generating image embedding...
  ✅ Image embedding generated (768 dimensions)
  💾 Updating database...
  ✅ Database updated successfully
...

----------------------------------------------------------------------
✅ Batch 1 complete in 45.23s
   Success: 19 | Failed: 1
----------------------------------------------------------------------

⏳ Pausing 3 seconds before next batch...

======================================================================
🎉 EMBEDDING GENERATION COMPLETE!
======================================================================
📊 Total Products: 150
✅ Successful: 146
❌ Failed: 4
⏱️  Total Time: 420.15s
⏱️  Avg Time per Product: 2.80s
======================================================================
```

#### Troubleshooting
- **Model Download Fails**: Check internet connection on first run
- **Out of Memory**: Reduce `BATCH_SIZE` from 20 to 10 in the script
- **Slow Performance**: Normal on first run; subsequent runs use cached models
- **Image Load Errors**: Ensure `image_url` values are accessible
- **Node.js Version**: Requires Node.js 18+ for transformers.js 