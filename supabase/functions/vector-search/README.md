# Vector Search Edge Function

This Supabase Edge Function handles AI-powered semantic search by:
1. Receiving search queries from the frontend
2. Generating embeddings using OpenAI's API
3. Performing vector similarity search in the database
4. Returning ranked results

## Setup

### 1. Environment Variables
Set these environment variables in your Supabase project:

```bash
# OpenAI API Configuration
OPENAI_API_KEY=your_openai_api_key_here

# Supabase Configuration  
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

### 2. Deploy the Function
```bash
# From your project root
supabase functions deploy vector-search
```

### 3. Test the Function
```bash
# Test locally
supabase functions serve vector-search

# Test deployed function
curl -X POST https://your-project.supabase.co/functions/v1/vector-search \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "casual weekend outfit", "searchType": "outfits", "limit": 5}'
```

## Usage

### Request Format
```json
{
  "query": "your search query here",
  "searchType": "outfits" | "products",
  "limit": 10
}
```

### Response Format
```json
{
  "results": [...],
  "query": "your search query here", 
  "searchType": "outfits",
  "count": 5
}
```

## Benefits

- **No CORS issues** - Backend handles all external API calls
- **Better security** - API keys stay on the server
- **Improved performance** - No embedding generation on every keystroke
- **Rate limiting** - Centralized control over OpenAI API usage
- **Caching potential** - Can cache embeddings for repeated queries

## Error Handling

The function includes comprehensive error handling for:
- Missing or invalid query parameters
- OpenAI API failures
- Database search errors
- Network issues

All errors are returned with appropriate HTTP status codes and error messages.
