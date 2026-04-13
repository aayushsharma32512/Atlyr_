from PIL import Image, ImageChops
import os

def crop_image(img, bg_color=(0,0,0,0)):
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    bg = Image.new("RGBA", img.size, bg_color)
    diff = ImageChops.difference(img, bg)
    bbox = diff.getbbox()
    if bbox:
        return img.crop(bbox)
    return img

def get_waist_width(img):
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    width, height = img.size
    for y in range(height):
        row = [img.getpixel((x, y))[3] for x in range(width)]
        if any(a > 0 for a in row):
            left = next((x for x in range(width) if img.getpixel((x, y))[3] > 0), None)
            right = next((x for x in range(width-1, -1, -1) if img.getpixel((x, y))[3] > 0), None)
            if left is not None and right is not None and right >= left:
                return right - left + 1
    return None  # No non-transparent row found

def resize_and_save(img, width, out_path, label=None):
    w, h = img.size
    new_h = int(h * (width / w))
    if label:
        print(f"  Resizing {label}: {w}x{h} -> {width}x{new_h}")
    # img = img.resize((width, new_h), Image.LANCZOS)  # COMMENTED OUT
    img.save(out_path, format="PNG")
    return img

# def process_tops(input_folder, output_folder, target_width):
#     os.makedirs(output_folder, exist_ok=True)
#     widths = []
#     print(f"\nProcessing TOPS in {input_folder} -> {output_folder} (target width: {target_width})")
#     for fname in os.listdir(input_folder):
#         if fname.lower().endswith(('.png', '.jpg', '.jpeg')):
#             img = crop_image(Image.open(os.path.join(input_folder, fname)))
#             print(f"- Top: {fname} | Original size: {img.width}x{img.height}")
#             # img_resized = resize_and_save(img, target_width, os.path.join(output_folder, fname.split('.')[0]+'.png'), label='top')
#             # waist_width = get_waist_width(img_resized)
#             # if waist_width and waist_width > 0:
#             #     print(f"    Waist width after resize: {waist_width}")
#             #     widths.append(waist_width)
#             # Instead, just save cropped image
#             img.save(os.path.join(output_folder, fname.split('.')[0]+'.png'), format="PNG")
#     avg_width = int(sum(widths) / len(widths)) if widths else target_width
#     print(f"  [TOPS] Average waist width after resize: {avg_width}")
#     return avg_width

def process_bottoms(input_folder, output_folder):
    os.makedirs(output_folder, exist_ok=True)
    print(f"\nProcessing BOTTOMS in {input_folder} -> {output_folder} (scaling 1.1x)")
    for fname in os.listdir(input_folder):
        if fname.lower().endswith(('.png', '.jpg', '.jpeg')):
            img = crop_image(Image.open(os.path.join(input_folder, fname)))
            print(f"- Bottom: {fname} | Original size: {img.width}x{img.height}")
            # Scale to 1.1x
            new_w = int(img.width * 1.1)
            new_h = int(img.height * 1.1)
            img = img.resize((new_w, new_h), Image.LANCZOS)
            img.save(os.path.join(output_folder, fname.split('.')[0]+'.png'), format="PNG")
            print(f"    Saved scaled bottom: {new_w}x{new_h}")

def process_heads(input_folder, output_folder):
    os.makedirs(output_folder, exist_ok=True)
    print(f"\nProcessing HEADS in {input_folder} -> {output_folder} (scaling 0.9x)")
    for fname in os.listdir(input_folder):
        if fname.lower().endswith(('.png', '.jpg', '.jpeg')):
            img = crop_image(Image.open(os.path.join(input_folder, fname)))
            print(f"- Head: {fname} | Original size: {img.width}x{img.height}")
            # Scale to 0.9x
            new_w = int(img.width * 0.95)
            new_h = int(img.height * 0.95)
            img = img.resize((new_w, new_h), Image.LANCZOS)
            img.save(os.path.join(output_folder, fname.split('.')[0]+'.png'), format="PNG")
            print(f"    Saved scaled head: {new_w}x{new_h}")

# def process_shoes(input_folder, output_folder, target_width):
#     os.makedirs(output_folder, exist_ok=True)
#     print(f"\nProcessing SHOES in {input_folder} -> {output_folder} (target width: {target_width})")
#     for fname in os.listdir(input_folder):
#         if fname.lower().endswith(('.png', '.jpg', '.jpeg')):
#             img = crop_image(Image.open(os.path.join(input_folder, fname)))
#             print(f"- Shoes: {fname} | Original size: {img.width}x{img.height}")
#             # resize_and_save(img, target_width, os.path.join(output_folder, fname.split('.')[0]+'.png'), label='shoes')
#             img.save(os.path.join(output_folder, fname.split('.')[0]+'.png'), format="PNG")

if __name__ == "__main__":
    # Folders
    base = "public/base_photos"
    out = "public"
    # tops_in = f"{base}/products/tops"
    # tops_out = f"{out}/products/tops"
    # bottoms_in = f"{base}/products/bottoms"
    # bottoms_out = f"{out}/products/bottoms"
    heads_in = f"{base}/avatars"
    heads_out = f"{out}/avatars"
    # shoes_in = f"{base}/products/shoes"
    # shoes_out = f"{out}/products/shoes"

    # 1. Process tops to uniform width (150px)
    # TARGET_TOP_WIDTH = 150
    # avg_top_width = process_tops(tops_in, tops_out, TARGET_TOP_WIDTH)
    # print(f"Average top width: {avg_top_width}")

    # 2. Process bottoms to uniform width (150px)
    # TARGET_BOTTOM_WIDTH = 80
    # process_bottoms(bottoms_in, bottoms_out)

    # 3. Process heads to 0.9x scale
    process_heads(heads_in, heads_out)

    # 4. Process shoes to 80% of top width (120px)
    # TARGET_SHOES_WIDTH = int(0.8 * TARGET_BOTTOM_WIDTH)
    # process_shoes(shoes_in, shoes_out, TARGET_SHOES_WIDTH)

    print("Bottoms and heads processed and saved to their respective folders.") 