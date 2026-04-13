import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function checkEnvironment() {
  console.log('🔍 Checking environment setup...\n');
  
  // Check if .env file exists
  const envPath = path.join(__dirname, '../.env');
  const envExists = fs.existsSync(envPath);
  
  if (!envExists) {
    console.log('📝 Creating .env file...');
    const envTemplate = `# Supabase Configuration
SUPABASE_URL=your_supabase_project_url_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# PostHog Configuration
VITE_PUBLIC_POSTHOG_KEY=your_posthog_api_key_here
VITE_PUBLIC_POSTHOG_HOST=your_posthog_instance_host_url_here

# Examples:
# SUPABASE_URL=https://your-project.supabase.co
# SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
# VITE_PUBLIC_POSTHOG_KEY=phc_abc123yourkeyhere
# VITE_PUBLIC_POSTHOG_HOST=https://app.posthog.com
`;
    
    fs.writeFileSync(envPath, envTemplate);
    console.log('✅ Created .env file');
    console.log('⚠️  Please update .env with your actual Supabase and PostHog credentials');
  } else {
    console.log('✅ .env file exists');
  }
  
  // Check required environment variables
  const requiredVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'VITE_PUBLIC_POSTHOG_KEY',
    'VITE_PUBLIC_POSTHOG_HOST',
  ];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.log('\n❌ Missing environment variables:');
    missingVars.forEach(varName => {
      console.log(`   - ${varName}`);
    });
    console.log('\n📝 Please set these in your .env file or environment');
    return false;
  } else {
    console.log('✅ All required environment variables are set');
    return true;
  }
}

function showUsage() {
  console.log('\n📖 Usage Instructions:');
  console.log('1. Set your Supabase and PostHog credentials in .env file');
  console.log('2. Run: bun run scripts/upload-products.js');
  console.log('3. Check upload-error-report.xlsx for any issues');
  console.log('\n🔧 To set up environment:');
  console.log('   bun run scripts/setup-env.js');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const isReady = checkEnvironment();
  showUsage();
  
  if (!isReady) {
    process.exit(1);
  }
}

export { checkEnvironment };