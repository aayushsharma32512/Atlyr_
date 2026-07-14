import os
import requests
from dotenv import load_dotenv

# Load environment variables
dotenv_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
load_dotenv(dotenv_path)

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
STORAGE_BUCKET = os.environ.get("STORAGE_BUCKET", "ingestion-automated")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError(
        "Missing required environment variables: SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY. "
        "Please ensure they are set in your environment or in a .env file at services/segmentation/.env"
    )

def get_headers(content_type="application/json"):
    return {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "apikey": SUPABASE_KEY,
        "Content-Type": content_type
    }

def upload_file_to_storage(local_path: str, storage_path: str, content_type: str = "image/png") -> str:
    """Uploads local file to Supabase Storage and returns the public access URL."""
    url = f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/{storage_path}"
    
    with open(local_path, "rb") as f:
        binary_data = f.read()
        
    headers = get_headers(content_type)
    response = requests.post(url, headers=headers, data=binary_data)
    
    # Overwrite if exists
    if response.status_code != 200:
        response = requests.put(url, headers=headers, data=binary_data)
        if response.status_code != 200:
            raise Exception(f"Supabase Storage Upload failed: {response.text}")
            
    return f"{SUPABASE_URL}/storage/v1/object/public/{STORAGE_BUCKET}/{storage_path}"
