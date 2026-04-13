"""
Outfit Embedding Update Tool - Queue-based processing

This script processes outfits from the outfit_embedding_queue table and generates:
- text_vector: from search_summary column (768 dimensions)
- image_vector: from outfit_images column (768 dimensions)

Follows the EXACT same pattern as embedding_update.py for products.

Usage:
    # Process queue (default - for cron job)
    python scripts/outfit_embedding_update.py
    
    # Full scan mode (regenerate all missing embeddings)
    python scripts/outfit_embedding_update.py --full-scan

Prerequisites:
1. Run migrations to create outfit_embedding_queue table
2. Set environment variables in .env.local:
   - VITE_SUPABASE_URL or SUPABASE_URL
   - VITE_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY
"""

import os
import sys
import asyncio
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
    """Fashion-SigLIP embedding generator using OpenCLIP."""
    
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
        """Generate 768-dim text embedding."""
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
        """Generate 768-dim image embedding."""
        try:
            response = requests.get(image_url, timeout=15)
            response.raise_for_status()
            image = Image.open(BytesIO(response.content)).convert("RGB")
            
            image_input = self.preprocess_val(image).unsqueeze(0).to(self.device)
            with torch.no_grad():
                image_features = self.model.encode_image(image_input, normalize=True)
                return image_features[0].tolist()
        except Exception as e:
            print(f"  ⚠️  Image embedding failed: {e}")
            return None


def build_outfit_text(outfit):
    """
    Get search_summary for text embedding.
    Returns None if search_summary is null/empty (text_vector will remain null).
    No fallback - matches the generate-outfit-embeddings.py behavior.
    """
    search_sum = outfit.get('search_summary')
    if search_sum and search_sum.strip():
        return search_sum.strip()
    return None


def fetch_outfits_from_queue():
    """Fetch outfits from the embedding queue."""
    print('📥 Fetching outfits from embedding queue...')
    try:
        response = supabase.table('outfit_embedding_queue').select(
            "id, outfit_id, needs_text_embedding, needs_image_embedding, outfits(*)"
        ).order('queued_at', desc=False).limit(100).execute()
        
        raw_data = response.data or []
        outfits = []
        for item in raw_data:
            if not item.get('outfits'):
                continue
            
            outfit = item['outfits']
            # Flatten & attach queue metadata
            outfit['queue_id'] = item['id']
            outfit['needs_text_embedding'] = item['needs_text_embedding']
            outfit['needs_image_embedding'] = item['needs_image_embedding']
            outfit['from_queue'] = True
            
            outfits.append(outfit)
            
        print(f"Found {len(outfits)} outfits in queue")
        return outfits
    except Exception as e:
        print(f"❌ Error fetching queue: {e}")
        print(f"   Traceback: {traceback.format_exc()}")
        return []


def fetch_outfits_needing_update():
    """Fetch all outfits that need embeddings (full scan mode)."""
    print('📥 Fetching all outfits needing embeddings...')
    try:
        response = supabase.table('outfits').select(
            "id, name, category, occasion, gender, search_summary, outfit_images, text_vector, image_vector"
        ).or_('text_vector.is.null,image_vector.is.null').execute()
        
        outfits = response.data or []
        for o in outfits:
            o['from_queue'] = False
            
        print(f"Found {len(outfits)} outfits needing updates")
        return outfits
    except Exception as e:
        print(f"❌ Error fetching outfits: {e}")
        print(f"   Traceback: {traceback.format_exc()}")
        return []


def update_outfit_embeddings(outfit_id, updates, remove_from_queue=False, queue_id=None, full_scan_mode=False):
    """Update outfit embeddings in database and optionally remove from queue."""
    updates['embedded_at'] = datetime.utcnow().isoformat()
    updates['vector_version'] = CURRENT_VECTOR_VERSION
    
    try:
        supabase.table('outfits').update(updates).eq('id', outfit_id).execute()
        
        if remove_from_queue and queue_id:
            supabase.table('outfit_embedding_queue').delete().eq('id', queue_id).execute()
            
        if not remove_from_queue and full_scan_mode:
            # Clean up any stale queue entries for this outfit
            supabase.table('outfit_embedding_queue').delete().eq('outfit_id', outfit_id).execute()
            
        return True
    except Exception as e:
        print(f"  ❌ Database update failed: {e}")
        return False


async def process_outfit(embedder, outfit, index, total, full_scan_mode):
    """Process a single outfit - generate embeddings as needed."""
    oid = outfit['id']
    name = outfit.get('name', 'Unknown')
    print(f"\n[{index + 1}/{total}] Processing: {oid}")
    print(f"  Name: {name}")
    
    from_queue = outfit.get('from_queue', False)
    needs_text = outfit.get('needs_text_embedding')
    needs_image = outfit.get('needs_image_embedding')
    text_vec = outfit.get('text_vector')
    image_vec = outfit.get('image_vector')
    image_url = outfit.get('outfit_images')
    queue_id = outfit.get('queue_id')
    
    # Determine what to process
    should_process_text = (needs_text and not text_vec) if from_queue else (not text_vec)
    should_process_image = (needs_image and not image_vec) if from_queue else (not image_vec)
    
    if not should_process_text and not should_process_image:
        print('  ✅ All embeddings already exist')
        if from_queue and queue_id:
            try:
                supabase.table('outfit_embedding_queue').delete().eq('id', queue_id).execute()
            except:
                pass
        return {'success': True, 'text': False, 'image': False}
        
    updates = {}
    generated_text = False
    generated_image = False
    
    # Process text embedding
    if should_process_text:
        try:
            txt = build_outfit_text(outfit)
            if txt:
                print(f"  📝 Generating text embedding...")
                vec = embedder.generate_text_embedding(txt)
                if vec:
                    updates['text_vector'] = vec
                    generated_text = True
                    print('  ✅ Text embedding generated')
            else:
                print('  ⚠️  No search_summary - skipping text embedding')
        except Exception as e:
            print(f"  ❌ Text embedding failed: {e}")
    else:
        print('  ⏭️  Text embedding exists')
        
    # Process image embedding
    if should_process_image:
        if not image_url:
            print('  ⚠️  No outfit_images URL - skipping image embedding')
        else:
            try:
                print(f"  🖼️  Generating image embedding...")
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
        success = update_outfit_embeddings(oid, updates, from_queue, queue_id, full_scan_mode)
        if success:
            print('  💾 Database updated')
            
    return {'success': success, 'text': generated_text, 'image': generated_image}


async def main():
    parser = argparse.ArgumentParser(description='Update outfit embeddings')
    parser.add_argument('--full-scan', action='store_true', help='Run in full scan mode (process all missing embeddings)')
    args = parser.parse_args()
    
    full_scan_mode = args.full_scan
    mode_str = "FULL-SCAN" if full_scan_mode else "QUEUE"
    
    print('╔════════════════════════════════════════════╗')
    print('║    Fashion Outfit Embedding Update Tool    ║')
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
        outfits = fetch_outfits_needing_update()
    else:
        outfits = fetch_outfits_from_queue()
        
    if not outfits:
        print('✨ No outfits to process')
        return
        
    print(f"\n📊 Processing {len(outfits)} outfits...\n")
    print('─' * 50)
    
    results = {
        'total': len(outfits),
        'successful': 0,
        'failed': 0,
        'textGenerated': 0,
        'imageGenerated': 0
    }
    
    start_time = time.time()
    
    for i, outfit in enumerate(outfits):
        res = await process_outfit(embedder, outfit, i, len(outfits), full_scan_mode)
        if res['success']:
            results['successful'] += 1
            if res['text']:
                results['textGenerated'] += 1
            if res['image']:
                results['imageGenerated'] += 1
        else:
            results['failed'] += 1
            
    duration = time.time() - start_time
    
    print('\n' + '─' * 50)
    print('\n📋 Summary:')
    print(f"  Mode: {mode_str}")
    print(f"  Total Outfits: {results['total']}")
    print(f"  ✅ Successful: {results['successful']}")
    print(f"  ❌ Failed: {results['failed']}")
    print(f"  📝 Text Embeddings: {results['textGenerated']}")
    print(f"  🖼️  Image Embeddings: {results['imageGenerated']}")
    print(f"  ⏱️  Duration: {duration:.1f}s")
    print(f"  ⏰ Finished: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")


if __name__ == "__main__":
    asyncio.run(main())
