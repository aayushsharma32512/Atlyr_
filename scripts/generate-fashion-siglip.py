import os
import sys
import asyncio
import json
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
    def __init__(self):
        self.model = None
        self.preprocess_val = None
        self.tokenizer = None
        
    def initialize_models(self):
        print("📥 Loading models from HuggingFace Hub (this may take a few minutes on first run)...\n")
        try:
            print("  🥶 Loading OpenModel & Transforms...")
            self.model, _, self.preprocess_val = open_clip.create_model_and_transforms(MODEL_NAME)
            
            print("  🔤 Loading Tokenizer...")
            self.tokenizer = open_clip.get_tokenizer(MODEL_NAME)
            
            self.model.eval()
            # Use CUDA if available, else CPU (mps typically not fully supported for all ops in open_clip/torch yet, stick to cpu for safety unless explicitly requested)
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            print(f"  ⚙️  Using Device: {self.device}")
            self.model.to(self.device)
            
            print("✅ All models loaded successfully!\n")
        except Exception as e:
            print(f"❌ Error loading models: {e}")
            sys.exit(1)

    def generate_text_embedding(self, text):
        try:
            # 1. Show input text
            print(f"     📥 INPUT TEXT ({len(text)} chars):")
            print(f"        {text}")
            
            # Tokenize
            text_tokens = self.tokenizer([text]).to(self.device)
            
            # Log token tensor shape
            print(f"     📐 Token tensor shape: {text_tokens.shape}")
            
            # Get the token IDs
            token_ids = text_tokens[0].cpu().tolist()
            
            # Count actual tokens (excluding padding tokens which are typically 0 or end token)
            # For CLIP models, 0 is usually padding, and there's usually a start/end token
            actual_tokens = [t for t in token_ids if t != 0]
            context_length = self.model.context_length
            print(f"     🔢 Tokenized to {len(actual_tokens)} tokens (max: {context_length})")
            
            # 2. Try to decode tokens to show what model actually sees
            try:
                # Access the underlying SimpleTokenizer if available
                if hasattr(self.tokenizer, 'tokenizer'):
                    decoder = self.tokenizer.tokenizer
                    # Decode the actual tokens (non-zero ones)
                    decoded_text = decoder.decode(actual_tokens)
                    print(f"     📤 AFTER TOKENIZATION (FULL DECODED TEXT - {len(decoded_text)} chars):")
                    print(f"        {decoded_text}")
                    print(f"     --- END OF DECODED TEXT ---")
                    
                else:
                    if len(actual_tokens) >= context_length:
                        print(f"     ⚠️  TRUNCATED to {context_length} tokens (decoder not available to show truncated text)")
                    else:
                        print(f"     ✅ No truncation (used {len(actual_tokens)}/{context_length} tokens)")
            except Exception as e:
                print(f"     ℹ️  Could not decode tokens: {e}")
            
            with torch.no_grad():
                # Generate embedding
                text_features = self.model.encode_text(text_tokens, normalize=True)
                embedding = text_features[0].tolist()
                
                return embedding
        except Exception as e:
            print(f"Error generating text embedding: {e}")
            return None

    def generate_image_embedding(self, image_url):
        try:
            response = requests.get(image_url, timeout=10)
            response.raise_for_status()
            image = Image.open(BytesIO(response.content))
            
            # Preprocess
            image_input = self.preprocess_val(image).unsqueeze(0).to(self.device)
            
            with torch.no_grad():
                # Generate embedding
                image_features = self.model.encode_image(image_input, normalize=True)
                return image_features[0].tolist()
        except Exception as e:
            print(f"Error generating image embedding for {image_url}: {e}")
            return None

def build_product_text(product):
    """
    Build concatenated text from product fields.
    Replicates the 'Double-Tapping' logic from JS: Raw Keywords + Labeled Context.
    """
    def add(prefix, val):
        return f"{prefix}: {val}" if val else None

    # Helper for simple value check
    def just_val(val):
        return val if val else None

    # Construct the descriptive attributes string
    attrs = [
        product.get('fit'), 
        product.get('feel'), 
        product.get('vibes'), 
        product.get('occasion'), 
        product.get('material_type')
    ]
    descriptive_group = ", ".join([str(v) for v in attrs if v])

    # Handle product specifications
    specs = product.get('product_specifications')
    specs_str = None
    if specs:
        if isinstance(specs, str):
            specs_str = specs
        elif isinstance(specs, dict):
            specs_str = ", ".join([f"{k}: {v}" for k, v in specs.items()])

    # Match JS buildProductText exactly (no raw keywords duplication)
    parts = [
        add('Brand', product.get('brand')),
        add('Category', product.get('type_category')),
        add('Product Name', product.get('product_name')),
        add('Gender', product.get('gender')),
        add('Color', product.get('color_group') or product.get('color')),
        
        # Descriptive attributes group
        descriptive_group if descriptive_group else None,
        
        # Main description
        just_val(product.get('description_text')),
        
        # Technical specs
        specs_str
    ]

    # Filter out None/Empty strings and join
    clean_parts = [str(p).strip() for p in parts if p is not None and str(p).strip() != '']
    return ". ".join(clean_parts).strip()

async def process_batch(embedder: FashionEmbedder, products, batch_num, total_batches):
    print('\n' + '=' * 70)
    print(f"🔄 BATCH {batch_num}/{total_batches} ({len(products)} products)")
    print('=' * 70)

    success_count = 0
    fail_count = 0
    start_time = time.time()

    for i, product in enumerate(products):
        global_prod_num = (batch_num - 1) * 20 + i + 1
        print(f"\n[Global {global_prod_num}] Processing product: {product['id']}")
        
        text_vector = None
        image_vector = None
        text_success = False
        image_success = False
        
        # --- Text Embedding ---
        try:
            product_text = build_product_text(product)
            if product_text:
                print(f"  📝 Generating text embedding...")
                print(f"     📝 FINAL TEXT ({len(product_text)} chars):")
                print(f"        {product_text}")
                # print(f"     (Text: {product_text[:50]}...)")
                text_vector = embedder.generate_text_embedding(product_text)
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
            image_url = product.get('image_url')
            if image_url:
                print(f"  🖼️  Generating image embedding...")
                image_vector = embedder.generate_image_embedding(image_url)
                if image_vector:
                    print(f"  ✅ Image embedding generated ({len(image_vector)} dimensions)")
                    image_success = True
            else:
                print("  ⚠️  No image URL available, skipping image embedding")
                image_success = True
        except Exception as e:
            print(f"  ❌ Failed image embedding: {e}")

        # --- Update Database ---
        if text_vector or image_vector:
            try:
                updates = {}
                if text_vector: updates['text_vector'] = text_vector
                if image_vector: updates['image_vector'] = image_vector
                
                print("  💾 Updating database...")
                supabase.table('products').update(updates).eq('id', product['id']).execute()
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
                # If inputs were missing but handled gracefully, maybe success? keeping simple
                success_count += 1

    elapsed = time.time() - start_time
    print('\n' + '-' * 70)
    print(f"✅ Batch {batch_num} complete in {elapsed:.2f}s")
    print(f"   Success: {success_count} | Failed: {fail_count}")
    print('-' * 70)
    
    return success_count, fail_count

async def main():
    print('\n' + '=' * 70)
    print('🚀 Fashion-SigLIP Local Embedding Generation (Python/OpenCLIP)')
    print('=' * 70)
    
    embedder = FashionEmbedder()
    embedder.initialize_models()

    print('📥 Fetching all products from database...\n')
    
    # Select all fields needed specifically for build_product_text
    response = supabase.table('products').select(
        'id, brand, product_name, description, description_text, fit, feel, gender, color, color_group, vibes, type_category, product_specifications, occasion, material_type, image_url, text_vector, image_vector'
    ).execute()
    
    products = response.data
    
    if not products:
        print("✅ No products found in database.")
        sys.exit(0)

    print(f"📦 Found {len(products)} products (will regenerate ALL embeddings)\n")
    
    # Process in batches
    BATCH_SIZE = 20
    batches = [products[i:i + BATCH_SIZE] for i in range(0, len(products), BATCH_SIZE)]
    
    print(f"📊 Processing {len(batches)} batches of up to {BATCH_SIZE} products each\n")
    
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
    print('🎉 EMBEDDING GENERATION COMPLETE!')
    print('=' * 70)
    print(f"✅ Successful: {total_success}")
    print(f"❌ Failed: {total_fail}")
    print(f"⏱️  Total Time: {total_time:.2f}s")
    print(f"⏱️  Avg Time/Product: {avg_time:.2f}s")
    print('=' * 70 + '\n')

if __name__ == "__main__":
    asyncio.run(main())
