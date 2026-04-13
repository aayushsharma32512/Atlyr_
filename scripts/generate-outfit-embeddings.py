"""
Generate Fashion-SigLIP embeddings for outfits table.

This script generates:
- text_vector: from search_summary column (768 dimensions)
- image_vector: from outfit_images column (768 dimensions)

Follows the EXACT same flow as generate-fashion-siglip.py for products.

Prerequisites:
1. Run the migration: supabase/migrations/20260202000000_add_multimodal_vectors_to_outfits.sql
2. Set environment variables in .env.local:
   - VITE_SUPABASE_URL or SUPABASE_URL
   - VITE_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY

Usage:
    python scripts/generate-outfit-embeddings.py
"""

import os
import sys
import asyncio
import time
import requests
from io import BytesIO

from dotenv import load_dotenv
from supabase import create_client, Client
from PIL import Image
import torch
import open_clip

# Load environment variables
load_dotenv(".env.local")

# Initialize Supabase client
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL") or os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("VITE_SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Missing Supabase credentials.")
    print("Required: VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Model configuration
MODEL_NAME = "hf-hub:Marqo/marqo-fashionSigLIP"


class FashionEmbedder:
    """Fashion-SigLIP embedding generator using OpenCLIP."""
    
    def __init__(self):
        self.model = None
        self.preprocess_val = None
        self.tokenizer = None
        
    def initialize_models(self):
        """Load Fashion-SigLIP models from HuggingFace Hub."""
        print("📥 Loading models from HuggingFace Hub (this may take a few minutes on first run)...\n")
        try:
            print("  🥶 Loading OpenModel & Transforms...")
            self.model, _, self.preprocess_val = open_clip.create_model_and_transforms(MODEL_NAME)
            
            print("  🔤 Loading Tokenizer...")
            self.tokenizer = open_clip.get_tokenizer(MODEL_NAME)
            
            self.model.eval()
            # Use CUDA if available, else CPU
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            print(f"  ⚙️  Using Device: {self.device}")
            self.model.to(self.device)
            
            print("✅ All models loaded successfully!\n")
        except Exception as e:
            print(f"❌ Error loading models: {e}")
            sys.exit(1)

    def generate_text_embedding(self, text):
        """Generate 768-dim text embedding."""
        try:
            # 1. Show input text
            print(f"     📥 INPUT TEXT ({len(text)} chars):")
            print(f"        {text[:200]}{'...' if len(text) > 200 else ''}")
            
            # Tokenize
            text_tokens = self.tokenizer([text]).to(self.device)
            
            # Log token tensor shape
            print(f"     📐 Token tensor shape: {text_tokens.shape}")
            
            # Get the token IDs
            token_ids = text_tokens[0].cpu().tolist()
            
            # Count actual tokens (excluding padding tokens which are typically 0)
            actual_tokens = [t for t in token_ids if t != 0]
            context_length = self.model.context_length
            print(f"     🔢 Tokenized to {len(actual_tokens)} tokens (max: {context_length})")
            
            with torch.no_grad():
                # Generate embedding
                text_features = self.model.encode_text(text_tokens, normalize=True)
                embedding = text_features[0].tolist()
                
                return embedding
        except Exception as e:
            print(f"Error generating text embedding: {e}")
            return None

    def generate_image_embedding(self, image_url):
        """Generate 768-dim image embedding."""
        try:
            response = requests.get(image_url, timeout=15)
            response.raise_for_status()
            image = Image.open(BytesIO(response.content)).convert("RGB")
            
            # Preprocess
            image_input = self.preprocess_val(image).unsqueeze(0).to(self.device)
            
            with torch.no_grad():
                # Generate embedding
                image_features = self.model.encode_image(image_input, normalize=True)
                return image_features[0].tolist()
        except Exception as e:
            print(f"Error generating image embedding for {image_url[:50]}...: {e}")
            return None


def build_outfit_text(outfit):
    """
    Get search_summary for text embedding.
    Returns None if search_summary is null/empty (text_vector will be null).
    """
    search_sum = outfit.get('search_summary')
    if search_sum and search_sum.strip():
        return search_sum.strip()
    return None


async def process_batch(embedder: FashionEmbedder, outfits, batch_num, total_batches):
    """Process a batch of outfits - EXACT same flow as generate-fashion-siglip.py"""
    print('\n' + '=' * 70)
    print(f"🔄 BATCH {batch_num}/{total_batches} ({len(outfits)} outfits)")
    print('=' * 70)

    success_count = 0
    fail_count = 0
    start_time = time.time()

    for i, outfit in enumerate(outfits):
        global_outfit_num = (batch_num - 1) * 20 + i + 1
        print(f"\n[Global {global_outfit_num}] Processing outfit: {outfit['id']}")
        
        text_vector = None
        image_vector = None
        text_success = False
        image_success = False
        
        # --- Text Embedding ---
        try:
            outfit_text = build_outfit_text(outfit)
            if outfit_text:
                print(f"  📝 Generating text embedding...")
                print(f"     📝 FINAL TEXT ({len(outfit_text)} chars):")
                print(f"        {outfit_text[:150]}{'...' if len(outfit_text) > 150 else ''}")
                text_vector = embedder.generate_text_embedding(outfit_text)
                if text_vector:
                    print(f"  ✅ Text embedding generated ({len(text_vector)} dimensions)")
                    text_success = True
            else:
                print("  ⚠️  No text content available, skipping text embedding")
                text_success = True
        except Exception as e:
            print(f"  ❌ Failed text embedding: {e}")

        # --- Image Embedding ---
        try:
            image_url = outfit.get('outfit_images')
            if image_url:
                print(f"  🖼️  Generating image embedding...")
                image_vector = embedder.generate_image_embedding(image_url)
                if image_vector:
                    print(f"  ✅ Image embedding generated ({len(image_vector)} dimensions)")
                    image_success = True
            else:
                print("  ⚠️  No outfit_images URL available, skipping image embedding")
                image_success = True
        except Exception as e:
            print(f"  ❌ Failed image embedding: {e}")

        # --- Update Database ---
        if text_vector or image_vector:
            try:
                updates = {}
                if text_vector:
                    updates['text_vector'] = text_vector
                if image_vector:
                    updates['image_vector'] = image_vector
                
                print("  💾 Updating database...")
                supabase.table('outfits').update(updates).eq('id', outfit['id']).execute()
                print("  ✅ Database updated successfully")
                success_count += 1
            except Exception as e:
                print(f"  ❌ Failed to update database: {e}")
                fail_count += 1
        else:
            # If no embeddings were generated but inputs existed (error case), count as fail
            if not text_success and not image_success:
                fail_count += 1
            else:
                # If inputs were missing but handled gracefully
                success_count += 1

    elapsed = time.time() - start_time
    print('\n' + '-' * 70)
    print(f"✅ Batch {batch_num} complete in {elapsed:.2f}s")
    print(f"   Success: {success_count} | Failed: {fail_count}")
    print('-' * 70)
    
    return success_count, fail_count


async def main():
    print('\n' + '=' * 70)
    print('🚀 Fashion-SigLIP Outfit Embedding Generation (Python/OpenCLIP)')
    print('=' * 70)
    
    embedder = FashionEmbedder()
    embedder.initialize_models()

    print('📥 Fetching all outfits from database...\n')
    
    # Select all fields needed for build_outfit_text
    response = supabase.table('outfits').select(
        'id, name, category, occasion, gender, description, fit, feel, vibes, word_association, '
        'enriched_fit, enriched_feel, enriched_vibes, enriched_word_association, '
        'search_summary, outfit_images, text_vector, image_vector'
    ).execute()
    
    outfits = response.data
    
    if not outfits:
        print("✅ No outfits found in database.")
        sys.exit(0)

    print(f"📦 Found {len(outfits)} outfits (will regenerate ALL embeddings)\n")
    
    # Process in batches (same as products script)
    BATCH_SIZE = 20
    batches = [outfits[i:i + BATCH_SIZE] for i in range(0, len(outfits), BATCH_SIZE)]
    
    print(f"📊 Processing {len(batches)} batches of up to {BATCH_SIZE} outfits each\n")
    
    total_success = 0
    total_fail = 0
    overall_start = time.time()
    
    for i, batch in enumerate(batches):
        s, f = await process_batch(embedder, batch, i + 1, len(batches))
        total_success += s
        total_fail += f
        
        # Small sleep to be nice
        if i < len(batches) - 1:
            print("\n⏳ Pausing 1 second before next batch...\n")
            time.sleep(1)

    total_time = time.time() - overall_start
    avg_time = total_time / (total_success + total_fail) if (total_success + total_fail) > 0 else 0

    print('\n' + '=' * 70)
    print('🎉 OUTFIT EMBEDDING GENERATION COMPLETE!')
    print('=' * 70)
    print(f"✅ Successful: {total_success}")
    print(f"❌ Failed: {total_fail}")
    print(f"⏱️  Total Time: {total_time:.2f}s")
    print(f"⏱️  Avg Time/Outfit: {avg_time:.2f}s")
    print('=' * 70 + '\n')


if __name__ == "__main__":
    asyncio.run(main())
