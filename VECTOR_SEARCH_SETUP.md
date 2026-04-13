# Vector Search Setup Guide

This guide will help you set up vector embeddings based search functionality for your fashion app.

## Prerequisites

1. **OpenAI API Key**: You need an OpenAI API key to generate text embeddings
2. **Supabase Project**: Your Supabase project needs to support the `pgvector` extension
3. **Node.js**: Version 16 or higher

## Step 1: Environment Setup

Create a `.env.local` file in your project root with the following variables:

```bash
# OpenAI API Configuration
OPENAI_API_KEY=your_openai_api_key_here

# Supabase Configuration
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here

# Supabase Service Role Key (for admin operations)
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

### Getting the Required Keys:

1. **OpenAI API Key**: 
   - Go to [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)
   - Create a new API key
   - Copy the key to your `.env.local` file

2. **Supabase Keys**:
   - Go to your Supabase project dashboard
   - Navigate to Settings > API
   - Copy the Project URL and anon key
   - Copy the service_role key (this has admin privileges)

## Step 2: Database Migration

Run the migration to add vector columns to your database:

```bash
# If using Supabase CLI
supabase db push

# Or manually run the migration file:
# supabase/migrations/20250101000000_add_vector_embeddings.sql
```

This migration will:
- Add `description_text` and `vector_embedding` columns to both `outfits` and `products` tables
- Create vector indexes for efficient similarity search
- Add vector search functions

## Step 3: Install Dependencies

Install the required packages:

```bash
npm install openai
# or
bun add openai
```

## Step 4: Generate Embeddings

Run the script to generate descriptions and embeddings for all existing outfits and products:

```bash
npm run generate:embeddings
# or
bun run generate:embeddings
```

This script will:
- Generate natural language descriptions for each outfit and product
- Create vector embeddings using OpenAI's text-embedding-3-small model
- Store the embeddings in your database

**Note**: This process may take some time depending on the number of items in your database. The script includes rate limiting to respect OpenAI's API limits.

## Step 5: Test the Functionality

1. Start your development server: `npm run dev`
2. Navigate to the search page
3. Toggle between "Exact Match" and "AI Semantic" search modes
4. Try searching with natural language queries like:
   - "casual weekend outfit"
   - "formal business attire"
   - "summer beach style"

## How It Works

### Search Modes

1. **Exact Match**: Traditional string-based search (existing functionality)
2. **AI Semantic**: Uses vector embeddings to find semantically similar results

### Vector Search Process

1. User enters a search query
2. Query is converted to a vector embedding using OpenAI
3. Database searches for similar vectors using cosine similarity
4. Results are ranked by similarity score
5. Filters are applied to the results
6. Results are displayed to the user

### Performance

- Vector search uses efficient indexes for fast similarity queries
- Embeddings are generated once and stored in the database
- Search queries only require one API call to OpenAI for the query embedding

## Troubleshooting

### Common Issues

1. **"OPENAI_API_KEY not found"**
   - Ensure your `.env.local` file exists and contains the correct API key
   - Restart your development server after adding environment variables

2. **"SUPABASE_SERVICE_ROLE_KEY not found"**
   - Check that you have the service role key in your `.env.local`
   - This key is required for the embedding generation script

3. **Vector search functions not found**
   - Ensure the migration has been run successfully
   - Check that the `pgvector` extension is enabled in your Supabase project

4. **Poor search results**
   - The quality of results depends on the generated descriptions
   - You can modify the description generation logic in the script
   - Consider retraining with better prompts

### Cost Considerations

- OpenAI charges per token for embeddings
- The text-embedding-3-small model is the most cost-effective option
- Embeddings are generated once per item, not per search
- Monitor your OpenAI usage to control costs

## Customization

### Modifying Descriptions

Edit the description generation functions in `scripts/generate-vector-embeddings.js`:

- `generateOutfitDescription()`: Customize how outfit descriptions are generated
- `generateProductDescription()`: Customize how product descriptions are generated

### Adjusting Search Parameters

Modify the search threshold and limit in `src/hooks/useVectorSearch.ts`:

```typescript
const { data, error: searchError } = await supabase
  .from('outfits')
  .select('*')
  .not('vector_embedding', 'is', null)
  .order(`vector_embedding <-> '[${embedding.join(',')}]'::vector`)
  .limit(limit); // Adjust this value
```

### Adding New Search Types

You can extend the vector search to other entities by:
1. Adding vector columns to new tables
2. Creating description generation functions
3. Adding search functions to the hook

## Security Notes

- Never expose your service role key in client-side code
- The embedding generation script should only be run in secure environments
- Consider implementing rate limiting for the search API
- Monitor API usage to prevent abuse

## Support

If you encounter issues:
1. Check the browser console for error messages
2. Verify your environment variables are set correctly
3. Ensure the database migration has been applied
4. Check that the `pgvector` extension is enabled in Supabase
