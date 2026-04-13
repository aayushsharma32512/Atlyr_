# 🚀 Product Images Upload & Database Population Workflow

This guide explains the optimal way to upload product images to Supabase Storage and populate the `product_images` database table.

## 📁 Folder Structure

Your product images should be organized as follows:

```
product_images/
├── male/
│   ├── PRODUCT_NAME_1/
│   │   ├── flatlays/
│   │   │   ├── product_1.jpg
│   │   │   ├── product_2.jpg
│   │   │   └── ...
│   │   └── model/
│   │       ├── product_1.jpg
│   │       ├── product_2.jpg
│   │       └── ...
│   └── PRODUCT_NAME_2/
│       ├── flatlays/
│       └── model/
└── female/
    ├── PRODUCT_NAME_1/
    │   ├── flatlays/
    │   └── model/
    └── PRODUCT_NAME_2/
        ├── flatlays/
        └── model/
```

## 🔧 Prerequisites

1. **Supabase Storage Bucket**: Ensure you have a `product-images` bucket in your Supabase project
2. **Environment Variables**: Make sure your `.env` file contains:
   ```
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```
3. **Database Migration**: Run the migration to create the `product_images` table:
   ```sql
   -- Migration: Add vibes column to products and create product_images table
   ALTER TABLE public.products ADD COLUMN IF NOT EXISTS vibes TEXT;
   
   CREATE TABLE IF NOT EXISTS public.product_images (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
     kind TEXT NOT NULL CHECK (kind IN ('flatlay', 'model', 'detail')),
     sort_order INTEGER NOT NULL DEFAULT 0,
     is_primary BOOLEAN NOT NULL DEFAULT false,
     url TEXT NOT NULL,
     created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
     updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
   );
   ```

## 📤 Step 1: Upload Images to Supabase Storage

### Command
```bash
bun scripts/upload-product-images.js
```

### What This Does
1. **Scans** all product folders in `product_images/male/` and `product_images/female/`
2. **Uploads** each image to Supabase Storage with the path: `product_photos/{gender}/{product_name}/{flatlays|model}/{filename}`
3. **Generates** live URLs for each uploaded image
4. **Creates** an Excel mapping file with the correct database schema format
5. **Saves** a JSON backup of all upload results

### Output Files
- `product-images-upload-mapping_YYYY-MM-DD.xlsx` - Excel file with 3 sheets:
  - **Database_Upload**: Clean data ready for database insertion
  - **Detailed_Mapping**: All information including product names, gender, etc.
  - **Summary**: Upload statistics and metrics
- `product-images-upload-results_YYYY-MM-DD.json` - JSON backup with full details

### Features
- **Rate Limiting**: Built-in delays to avoid API rate limits
- **Error Handling**: Continues processing even if some uploads fail
- **Progress Tracking**: Real-time progress updates
- **Validation**: Checks file types and folder structure
- **Primary Image Detection**: Automatically identifies primary images based on filename patterns

## 📊 Step 2: Populate Database

### Command
```bash
bun scripts/populate-product-images.js product-images-upload-mapping_YYYY-MM-DD.xlsx
```

### What This Does
1. **Reads** the Excel file generated in Step 1
2. **Validates** data structure and constraints
3. **Inserts** data into the `product_images` table in batches
4. **Verifies** successful insertion
5. **Reports** detailed results and any errors

### Validation Checks
- ✅ Required columns present (`product_id`, `kind`, `sort_order`, `is_primary`, `url`, `gender`)
- ✅ Data types correct (strings, numbers, booleans)
- ✅ Valid image kinds (`flatlay`, `model`, `detail`)
- ✅ Valid URLs (start with `http`)
- ✅ Valid gender values (`male`, `female`)
- ✅ Primary image constraint (only one primary per product)
- ✅ Sort order values (non-negative integers)

## 🎯 Optimal Workflow

### 1. **Prepare Your Images**
```
✅ Organize images in the correct folder structure
✅ Ensure image filenames follow the pattern: product_name_number.jpg
✅ Verify all images are in JPG, JPEG, or PNG format
✅ Check that each product has both flatlays and model shots
```

### 2. **Run Upload Script**
```bash
bun scripts/upload-product-images.js
```
- Monitor the console output for any errors
- Check the generated Excel file for accuracy
- Verify a few image URLs are accessible

### 3. **Review and Validate**
- Open the Excel file and review the data
- Check that primary images are correctly identified
- Verify sort orders make sense
- Test a few image URLs in your browser

### 4. **Populate Database**
```bash
bun scripts/populate-product-images.js product-images-upload-mapping_YYYY-MM-DD.xlsx
```
- Monitor the insertion progress
- Check for any validation errors
- Verify the data in your Supabase dashboard

### 5. **Verify Results**
- Check the `product_images` table in Supabase
- Test image URLs from the database
- Verify primary images are correctly set
- Check that all products have the expected number of images

## 📋 Database Schema

The `product_images` table structure:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key (auto-generated) |
| `product_id` | TEXT | Reference to products table |
| `kind` | TEXT | Image type: 'flatlay', 'model', 'detail' |
| `sort_order` | INTEGER | Display order (0, 1, 2, ...) |
| `is_primary` | BOOLEAN | Whether this is the main image |
| `url` | TEXT | Live Supabase Storage URL |
| `gender` | TEXT | Gender category: 'male' or 'female' |
| `created_at` | TIMESTAMP | Auto-generated timestamp |
| `updated_at` | TIMESTAMP | Auto-updated timestamp |

## 🔍 Troubleshooting

### Common Issues

1. **Upload Failures**
   - Check your Supabase credentials
   - Verify the storage bucket exists
   - Check file permissions and sizes

2. **Validation Errors**
   - Ensure Excel file has the correct column names
   - Check that URLs are valid and accessible
   - Verify primary image constraints

3. **Database Insertion Errors**
   - Check that the `product_images` table exists
   - Verify foreign key relationships
   - Check for duplicate primary images

### Debug Commands

```bash
# Check script help
bun scripts/upload-product-images.js --help
bun scripts/populate-product-images.js --help

# Verify Excel file structure
bun scripts/check-product-images-excel.js
```

## 📈 Performance Tips

1. **Batch Processing**: The scripts process images in batches to avoid overwhelming the API
2. **Rate Limiting**: Built-in delays prevent hitting rate limits
3. **Error Recovery**: Scripts continue processing even if some items fail
4. **Progress Tracking**: Real-time updates show upload progress

## 🎉 Success Metrics

After running both scripts, you should have:

- ✅ All images uploaded to Supabase Storage
- ✅ Live URLs generated for each image
- ✅ Excel mapping file with correct schema
- ✅ Database populated with image records
- ✅ Primary images correctly identified
- ✅ Sort orders properly set
- ✅ All validation checks passed

## 📝 Next Steps

After successful upload and database population:

1. **Update Products Table**: Add `vibes` data to your products
2. **Test Frontend**: Verify images load correctly in your app
3. **Optimize Images**: Consider image optimization for better performance
4. **Monitor Usage**: Track storage usage and costs

---

**Need Help?** Check the console output for detailed error messages and validation results.
