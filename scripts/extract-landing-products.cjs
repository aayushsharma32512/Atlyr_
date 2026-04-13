/**
 * Script to parse CSV and extract product data for landing page mock
 * Run: node scripts/extract-landing-products.js
 */

const fs = require('fs');
const path = require('path');

// Simple CSV parser that handles quoted fields
function parseCSV(csvText) {
  const lines = [];
  let currentLine = [];
  let currentField = '';
  let inQuotes = false;
  
  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++; // Skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentLine.push(currentField);
      currentField = '';
    } else if ((char === '\r' && nextChar === '\n') && !inQuotes) {
      currentLine.push(currentField);
      lines.push(currentLine);
      currentLine = [];
      currentField = '';
      i++; // Skip \n
    } else if (char === '\n' && !inQuotes) {
      currentLine.push(currentField);
      lines.push(currentLine);
      currentLine = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }
  
  // Push last line
  if (currentField || currentLine.length > 0) {
    currentLine.push(currentField);
    lines.push(currentLine);
  }
  
  return lines;
}

// Main
const csvPath = path.join(__dirname, '../docs/Supabase Snippet Product Table Columns.csv');
const csvText = fs.readFileSync(csvPath, 'utf-8');
const rows = parseCSV(csvText);

// Get header indices
const headers = rows[0];
const indices = {
  id: headers.indexOf('id'),
  type: headers.indexOf('type'),
  brand: headers.indexOf('brand'),
  price: headers.indexOf('price'),
  currency: headers.indexOf('currency'),
  image_url: headers.indexOf('image_url'),
  product_name: headers.indexOf('product_name'),
  placement_x: headers.indexOf('placement_x'),
  placement_y: headers.indexOf('placement_y'),
  image_length: headers.indexOf('image_length'),
  gender: headers.indexOf('gender'),
  body_parts_visible: headers.indexOf('body_parts_visible'),
};

console.log('Column indices:', indices);

// Parse products with placement data
const products = [];
for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  if (row.length < 10) continue;
  
  const type = row[indices.type];
  const placementY = parseFloat(row[indices.placement_y]);
  const placementX = parseFloat(row[indices.placement_x]);
  const imageLength = parseFloat(row[indices.image_length]);
  
  // Only include items with placement data
  if (!type || isNaN(placementY) || isNaN(imageLength)) continue;
  
  // Parse body_parts_visible - can be comma-separated, pipe-separated, or JSON array
  let bodyPartsVisible = null;
  const bpvRaw = row[indices.body_parts_visible];
  if (bpvRaw && bpvRaw.trim()) {
    const cleanBpv = bpvRaw.trim();
    // Try to parse as JSON array first
    if (cleanBpv.startsWith('[')) {
      try {
        bodyPartsVisible = JSON.parse(cleanBpv);
      } catch (e) {
        // If JSON parse fails, try manual parsing
        bodyPartsVisible = cleanBpv.replace(/[\[\]"'{}]/g, '').split(/[,|]/).map(s => s.trim()).filter(Boolean);
      }
    } else if (cleanBpv.startsWith('{')) {
      // PostgreSQL array format: {head,torso,arm_left}
      bodyPartsVisible = cleanBpv.replace(/[{}]/g, '').split(',').map(s => s.trim()).filter(Boolean);
    } else {
      // Comma or pipe separated
      bodyPartsVisible = cleanBpv.split(/[,|]/).map(s => s.trim()).filter(Boolean);
    }
    // Filter out empty arrays
    if (bodyPartsVisible && bodyPartsVisible.length === 0) {
      bodyPartsVisible = null;
    }
  }
  
  products.push({
    id: row[indices.id],
    type: type,
    brand: row[indices.brand],
    price: parseFloat(row[indices.price]) || 0,
    currency: row[indices.currency],
    imageUrl: row[indices.image_url],
    productName: row[indices.product_name] || row[indices.id],
    placementX: isNaN(placementX) ? 0 : placementX,
    placementY: placementY,
    imageLengthCm: imageLength,
    gender: row[indices.gender],
    bodyPartsVisible: bodyPartsVisible,
  });
}

console.log(`\nFound ${products.length} products with placement data\n`);

// Group by type
const tops = products.filter(p => p.type === 'top').slice(0, 50);
const bottoms = products.filter(p => p.type === 'bottom').slice(0, 50);
const shoes = products.filter(p => p.type === 'shoes').slice(0, 50);

console.log(`Tops: ${tops.length}`);
console.log(`Bottoms: ${bottoms.length}`);
console.log(`Shoes: ${shoes.length}`);

// Helper to format bodyPartsVisible array for TypeScript output
const formatBodyPartsVisible = (bpv) => {
  if (!bpv || !Array.isArray(bpv) || bpv.length === 0) return 'null';
  return `[${bpv.map(s => `"${s}"`).join(', ')}]`;
};

// Generate a single product entry
const generateProductEntry = (p) => `  {
    id: "${p.id}",
    type: "${p.type}" as const,
    brand: "${p.brand}",
    price: ${p.price},
    currency: "${p.currency}",
    imageUrl: "${p.imageUrl}",
    productName: "${p.productName.replace(/"/g, '\\"')}",
    placementX: ${p.placementX},
    placementY: ${p.placementY},
    imageLengthCm: ${p.imageLengthCm},
    gender: ${p.gender ? `"${p.gender}"` : 'undefined'},
    bodyPartsVisible: ${formatBodyPartsVisible(p.bodyPartsVisible)},
  }`;

// Read the existing file to preserve static exports
const outputPath = path.join(__dirname, '../src/features/landing-page/landingMockProducts.ts');
const existingContent = fs.readFileSync(outputPath, 'utf-8');

// Find where MOCK_ALTERNATIVES starts and ends
const alternativesStartMarker = 'export const MOCK_ALTERNATIVES: LandingMockProduct[] = [';
const alternativesEndRegex = /^];$/m;

const startIndex = existingContent.indexOf(alternativesStartMarker);
if (startIndex === -1) {
  console.error('❌ Could not find MOCK_ALTERNATIVES in existing file');
  process.exit(1);
}

// Find the closing bracket of the array - look for "]" on its own line after the start
const afterStart = existingContent.substring(startIndex);
const endMatch = afterStart.match(/\n\]/);
if (!endMatch) {
  console.error('❌ Could not find end of MOCK_ALTERNATIVES array');
  process.exit(1);
}

const endOffset = startIndex + endMatch.index + endMatch[0].length;

// Build the new MOCK_ALTERNATIVES array
const newAlternatives = `export const MOCK_ALTERNATIVES: LandingMockProduct[] = [
  // Tops
${tops.map(p => generateProductEntry(p)).join(',\n')},

  // Bottoms
${bottoms.map(p => generateProductEntry(p)).join(',\n')},

  // Shoes
${shoes.map(p => generateProductEntry(p)).join(',\n')},
]`;

// Reconstruct the file: everything before MOCK_ALTERNATIVES + new array + everything after
const beforeAlternatives = existingContent.substring(0, startIndex);
const afterAlternatives = existingContent.substring(endOffset);

const newContent = beforeAlternatives + newAlternatives + afterAlternatives;

// Write the updated file
fs.writeFileSync(outputPath, newContent, 'utf-8');

console.log(`✅ Successfully updated MOCK_ALTERNATIVES in landingMockProducts.ts`);
console.log(`   - Tops: ${tops.length}`);
console.log(`   - Bottoms: ${bottoms.length}`);
console.log(`   - Shoes: ${shoes.length}`);
console.log(`   - Total: ${tops.length + bottoms.length + shoes.length} products`);
console.log(`   (Static exports preserved: MOCK_OUTFIT_ITEMS_*, LOCAL_MANNEQUIN_CONFIG_*, etc.)`);

