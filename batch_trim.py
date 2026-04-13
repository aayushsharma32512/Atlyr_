from PIL import Image, ImageChops
import os
import sys

def trim_image(input_path, output_path, background_color=(0, 0, 0, 0)):
    img = Image.open(input_path)
    # Ensure image has alpha channel
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    bg = Image.new("RGBA", img.size, background_color)
    diff = ImageChops.difference(img, bg)
    bbox = diff.getbbox()
    if bbox:
        cropped = img.crop(bbox)
        # Always save as PNG to preserve transparency
        cropped.save(output_path, format="PNG")
        print(f"Trimmed: {input_path} -> {output_path}")
    else:
        img.save(output_path, format="PNG")
        print(f"No trim needed: {input_path}")

def batch_trim_images(input_folder, output_folder, background_color=(0, 0, 0, 0)):
    os.makedirs(output_folder, exist_ok=True)
    for filename in os.listdir(input_folder):
        if filename.lower().endswith(('.png', '.jpg', '.jpeg')):
            in_path = os.path.join(input_folder, filename)
            out_path = os.path.join(output_folder, os.path.splitext(filename)[0] + '.png')
            trim_image(in_path, out_path, background_color)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python batch_trim.py input_folder output_folder [r g b a]")
        sys.exit(1)
    input_folder = sys.argv[1]
    output_folder = sys.argv[2]
    if len(sys.argv) == 7:
        bg_color = tuple(map(int, sys.argv[3:7]))
    else:
        bg_color = (0, 0, 0, 0)  # Default: transparent black
    batch_trim_images(input_folder, output_folder, bg_color) 