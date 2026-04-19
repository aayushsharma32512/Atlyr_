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

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

function normalizeList(listStr) {
  if (!listStr || typeof listStr !== 'string') return '';
  // Collapse whitespace around commas and trim
  return listStr
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .join(',');
}

async function run() {
  console.log('🚀 Updating products.similar_items from CSV export');
  console.log(`🧪 Dry run: ${isDryRun ? 'YES' : 'NO'}`);

  // 1) Read CSV via xlsx
  const csvPath = path.join(__dirname, '..', 'products_rows-6.csv');
  const workbook = XLSX.readFile(csvPath, { raw: false });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet);

  console.log(`📄 Rows loaded: ${rows.length}`);

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let notFound = 0;
  const errors = [];

  for (const row of rows) {
    const id = (row.id || '').toString().trim();
    const similarItemsRaw = row.similar_items || row['similar_items'] || '';
    const similarItems = normalizeList(similarItemsRaw);

    if (!id) {
      skipped++;
      continue;
    }

    if (!similarItems) {
      // Nothing to set; skip silently
      skipped++;
      continue;
    }

    processed++;

    try {
      if (isDryRun) {
        console.log(`→ Would update id=${id} similar_items=${similarItems.slice(0, 80)}${similarItems.length > 80 ? '…' : ''}`);
        continue;
      }

      const { data: existing, error: selErr } = await supabase
        .from('products')
        .select('id, similar_items')
        .eq('id', id)
        .limit(1);

      if (selErr) throw selErr;
      if (!existing || existing.length === 0) {
        console.log(`❌ Not found: ${id}`);
        notFound++;
        continue;
      }

      const current = (existing[0].similar_items ?? null);
      const forceBecauseNull = (current === null || current === undefined) && similarItems.length > 0;
      const equalWhenNotNull = (current !== null && current !== undefined) && current.toString() === similarItems;

      if (!forceBecauseNull && equalWhenNotNull) {
        // No change needed
        skipped++;
        continue;
      }

      const { error: updErr } = await supabase
        .from('products')
        .update({ similar_items: similarItems })
        .eq('id', id);

      if (updErr) throw updErr;
      updated++;
      console.log(`✅ Updated: ${id}`);
      
      // Gentle pacing
      await new Promise(r => setTimeout(r, 60));
    } catch (e) {
      console.log(`💥 Error on id=${id}: ${e.message}`);
      errors.push({ id, error: e.message });
    }
  }

  console.log('\n📊 Summary');
  console.log(`Processed: ${processed}`);
  console.log(`Updated:   ${updated}`);
  console.log(`Skipped:   ${skipped}`);
  console.log(`Not found: ${notFound}`);
  if (errors.length) {
    console.log(`Errors:    ${errors.length}`);
  }

  if (isDryRun) {
    console.log('\n🧪 Dry run completed (no changes were made).');
  } else {
    console.log('\n🎉 Update completed.');
  }
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
