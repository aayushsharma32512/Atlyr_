import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readExcelFile(folderPath, fileName) {
  console.log(`\n📁 Reading ${folderPath}/${fileName}...`);
  
  const excelPath = path.join(__dirname, `../${folderPath}/DB_Ready_Products/${fileName}`);
  
  if (!fs.existsSync(excelPath)) {
    console.log(`❌ File not found: ${excelPath}`);
    return null;
  }
  
  try {
    const workbook = XLSX.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`✅ Loaded ${data.length} rows`);
    console.log(`📋 Column names:`, Object.keys(data[0] || {}));
    
    if (data.length > 0) {
      console.log(`🔍 First row sample:`);
      console.log(JSON.stringify(data[0], null, 2));
    }
    
    return data;
  } catch (error) {
    console.error(`❌ Error reading file:`, error.message);
    return null;
  }
}

console.log('📊 Reading Excel files from both folders...\n');

// Read Men_Outfits Excel file
const menData = readExcelFile('Men_Outfits', 'DB_Ready_List.xlsx');

// Read Women_Outfits Excel file  
const womenData = readExcelFile('Women_Outfits', 'DB_Ready_List.xlsx');

console.log('\n📊 Summary:');
console.log(`Men's products: ${menData ? menData.length : 0}`);
console.log(`Women's products: ${womenData ? womenData.length : 0}`); 