import os
import sys
import asyncio
import json
import time
import requests
import argparse
import traceback
from datetime import datetime
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
CURRENT_VECTOR_VERSION = 1

class FashionEmbedder:
    def __init__(self):
        self.model = None
        self.preprocess_val = None
        self.tokenizer = None
        self.device = "cpu"
        
    def initialize_models(self):
        print("🔧 Loading Fashion-SigLIP models...")
        start_time = time.time()
        try:
            print("  🥶 Loading OpenModel & Transforms...")
            self.model, _, self.preprocess_val = open_clip.create_model_and_transforms(MODEL_NAME)
            
            print("  🔤 Loading Tokenizer...")
            self.tokenizer = open_clip.get_tokenizer(MODEL_NAME)
            
            self.model.eval()
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            print(f"  ⚙️  Using Device: {self.device}")
            self.model.to(self.device)
            
            duration = time.time() - start_time
            print(f"✅ All models loaded ({duration:.1f}s)\n")
        except Exception as e:
            print(f"❌ Error loading models: {e}")
            sys.exit(1)

    def generate_text_embedding(self, text):
        try:
            text_tokens = self.tokenizer([text]).to(self.device)
            with torch.no_grad():
                text_features = self.model.encode_text(text_tokens, normalize=True)
                return text_features[0].tolist()
        except Exception as e:
            print(f"❌ Error generating text embedding: {e}")
            print(f"   Traceback: {traceback.format_exc()}")
            print(f"   Text input (first 100 chars): {text[:100] if text else 'None'}")
            return None

    def generate_image_embedding(self, image_url):
        try:
            response = requests.get(image_url, timeout=10)
            response.raise_for_status()
            image = Image.open(BytesIO(response.content))
            
            image_input = self.preprocess_val(image).unsqueeze(0).to(self.device)
            with torch.no_grad():
                image_features = self.model.encode_image(image_input, normalize=True)
                return image_features[0].tolist()
        except Exception as e:
            print(f"  ⚠️  Image embedding failed: {e}")
            return None

def build_product_text(product):
    """
    Build concatenated text from product fields.
    Matches the logic in generate-fashion-siglip.py (No raw keyword prefix).
    """
    def add(prefix, val):
        return f"{prefix}: {val}" if val else None

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

    parts = [
        add('Brand', product.get('brand')),
        add('Category', product.get('type_category')),
        add('Product Name', product.get('product_name')),
        add('Gender', product.get('gender')),
        add('Color', product.get('color_group') or product.get('color')),
        
        descriptive_group if descriptive_group else None,
        just_val(product.get('description_text')),
        specs_str
    ]

    clean_parts = [str(p).strip() for p in parts if p is not None and str(p).strip() != '']
    return ". ".join(clean_parts).strip()

def fetch_products_from_queue():
    print('📥 Fetching products from embedding queue...')
    try:
        response = supabase.table('embedding_queue').select(
            "id, product_id, needs_text_embedding, needs_image_embedding, products(*)"
        ).order('queued_at', desc=False).limit(100).execute()
        
        raw_data = response.data or []
        products = []
        for item in raw_data:
            if not item.get('products'):
                continue
            
            prod = item['products']
            # Flatten & attach queue metadata
            prod['queue_id'] = item['id']
            prod['needs_text_embedding'] = item['needs_text_embedding']
            prod['needs_image_embedding'] = item['needs_image_embedding']
            prod['from_queue'] = True
            
            products.append(prod)
            
        print(f"Found {len(products)} products in queue")
        return products
    except Exception as e:
        print(f"❌ Error fetching queue: {e}")
        return []

def fetch_products_needing_update():
    print('📥 Fetching all products needing embeddings...')
    try:
        # Note: or filter string format for supabase-py might differ from JS
        # JS: .or('text_vector.is.null,image_vector.is.null')
        # Python: .or_('text_vector.is.null,image_vector.is.null')
        
        response = supabase.table('products').select(
            "id, brand, product_name, description, description_text, type, type_category, fit, feel, gender, vibes, color, color_group, product_specifications, occasion, material_type, image_url, text_vector, image_vector"
        ).or_('text_vector.is.null,image_vector.is.null').execute()
        
        products = response.data or []
        for p in products:
            p['from_queue'] = False
            
        print(f"Found {len(products)} products needing updates")
        return products
    except Exception as e:
        print(f"❌ Error fetching products: {e}")
        return []

def update_product_embeddings(product_id, updates, remove_from_queue=False, queue_id=None, full_scan_mode=False):
    updates['embedded_at'] = datetime.utcnow().isoformat()
    updates['vector_version'] = CURRENT_VECTOR_VERSION
    
    try:
        supabase.table('products').update(updates).eq('id', product_id).execute()
        
        if remove_from_queue and queue_id:
            supabase.table('embedding_queue').delete().eq('id', queue_id).execute()
            
        if not remove_from_queue and full_scan_mode:
            supabase.table('embedding_queue').delete().eq('product_id', product_id).execute()
            
        return True
    except Exception as e:
        print(f"  ❌ Database update failed: {e}")
        return False

async def process_product(embedder, product, index, total, full_scan_mode):
    pid = product['id']
    name = product.get('product_name')
    print(f"\n[{index + 1}/{total}] Processing: {pid}")
    print(f"  Name: {name}")
    
    from_queue = product.get('from_queue', False)
    needs_text = product.get('needs_text_embedding')
    needs_image = product.get('needs_image_embedding')
    text_vec = product.get('text_vector')
    image_vec = product.get('image_vector')
    image_url = product.get('image_url')
    queue_id = product.get('queue_id')
    
    # Determine what to process
    should_process_text = (needs_text and not text_vec) if from_queue else (not text_vec)
    should_process_image = (needs_image and not image_vec) if from_queue else (not image_vec)
    
    if not should_process_text and not should_process_image:
        print('  ✅ All embeddings already exist')
        if from_queue and queue_id:
            try:
                supabase.table('embedding_queue').delete().eq('id', queue_id).execute()
            except: pass
        return {'success': True, 'text': False, 'image': False}
        
    updates = {}
    generated_text = False
    generated_image = False
    
    if should_process_text:
        try:
            txt = build_product_text(product)
            if txt:
                vec = embedder.generate_text_embedding(txt)
                if vec:
                    updates['text_vector'] = vec
                    generated_text = True
                    print('  ✅ Text embedding generated')
        except Exception as e:
            print(f"  ❌ Text embedding failed: {e}")
    else:
        print('  ⏭️  Text embedding exists')
        
    if should_process_image:
        if not image_url:
            print('  ⚠️  No image URL')
        else:
            try:
                vec = embedder.generate_image_embedding(image_url)
                if vec:
                    updates['image_vector'] = vec
                    generated_image = True
                    print('  ✅ Image embedding generated')
            except Exception as e:
                print(f"  ⚠️  Image embedding failed: {e}")
    else:
        print('  ⏭️  Image embedding exists')
        
    success = True
    if updates:
        success = update_product_embeddings(pid, updates, from_queue, queue_id, full_scan_mode)
        if success:
            print('  💾 Database updated')
            
    return {'success': success, 'text': generated_text, 'image': generated_image}

async def main():
    parser = argparse.ArgumentParser(description='Update embeddings')
    parser.add_argument('--full-scan', action='store_true', help='Run in full scan mode')
    args = parser.parse_args()
    
    full_scan_mode = args.full_scan
    mode_str = "FULL-SCAN" if full_scan_mode else "QUEUE"
    
    print('╔════════════════════════════════════════════╗')
    print('║   Fashion Product Embedding Update Tool   ║')
    print('╚════════════════════════════════════════════╝\n')
    print(f"🔍 Mode: {mode_str}")
    print(f"⏰ Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"\n📦 Dependency Versions:")
    print(f"   Python: {sys.version.split()[0]}")
    print(f"   torch: {torch.__version__}")
    print(f"   open_clip: {open_clip.__version__}\n")
    
    embedder = FashionEmbedder()
    embedder.initialize_models()
    
    if full_scan_mode:
        products = fetch_products_needing_update()
    else:
        products = fetch_products_from_queue()
        
    if not products:
        print('✨ No products to process')
        return
        
    print(f"\n📊 Processing {len(products)} products...\n")
    print('─' * 50)
    
    results = {
        'total': len(products),
        'successful': 0,
        'failed': 0,
        'textGenerated': 0,
        'imageGenerated': 0
    }
    
    start_time = time.time()
    
    for i, p in enumerate(products):
        res = await process_product(embedder, p, i, len(products), full_scan_mode)
        if res['success']:
            results['successful'] += 1
            if res['text']: results['textGenerated'] += 1
            if res['image']: results['imageGenerated'] += 1
        else:
            results['failed'] += 1
            
    duration = time.time() - start_time
    
    print('\n' + '─' * 50)
    print('\n📋 Summary:')
    print(f"  Mode: {mode_str}")
    print(f"  Total Products: {results['total']}")
    print(f"  ✅ Successful: {results['successful']}")
    print(f"  ❌ Failed: {results['failed']}")
    print(f"  📝 Text Embeddings: {results['textGenerated']}")
    print(f"  🖼️  Image Embeddings: {results['imageGenerated']}")
    print(f"  ⏱️  Duration: {duration:.1f}s")
    print(f"  ⏰ Finished: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

if __name__ == "__main__":
    asyncio.run(main())
