#!/usr/bin/env python3
import base64
import os
import sys
import json
import asyncio
from pathlib import Path

# Setup paths
BASE_DIR = Path(__file__).resolve().parent
SEGMENTATION_DIR = BASE_DIR.parent
OUTPUT_ROOT = BASE_DIR / "output"
PDF_PATH = BASE_DIR / "sam_matting_report.pdf"

def img_to_b64(path: Path) -> str:
    """Read an image file and return a base64-encoded data URI."""
    if not path.exists():
        return ""
    data = path.read_bytes()
    ext = path.suffix.lower().replace(".", "")
    mime = f"image/{ext}" if ext != "jpg" else "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"

def build_gallery_rows() -> str:
    """Build HTML table rows for all processed cases."""
    if not OUTPUT_ROOT.exists():
        return "<tr><td colspan='10'>No outputs found. Run test_hybrid_matting.py first.</td></tr>"
    
    # Get all subdirectories (cases)
    cases = sorted([d.name for d in OUTPUT_ROOT.iterdir() if d.is_dir()])
    
    rows = ""
    for case in cases:
        case_dir = OUTPUT_ROOT / case
        
        # Load paths
        orig_p = SEGMENTATION_DIR / "scratch" / "different_model_testing" / "comparison_test" / case / "original.png"
        fashn_p = SEGMENTATION_DIR / "scratch" / "different_model_testing" / "comparison_test" / case / "fashn_seg.png"
        schp_p = SEGMENTATION_DIR / "scratch" / "different_model_testing" / "comparison_test" / case / "schp_seg.png"
        dino_p = SEGMENTATION_DIR / "scratch" / "different_model_testing" / "comparison_test" / case / "dino_detected_boxes.png"
        sam_p = SEGMENTATION_DIR / "scratch" / "different_model_testing" / "comparison_test" / case / "grounded_sam2_transparent.png"
        vitmatte_p = case_dir / f"{case}_vitmatte_refined.png"
        biref_p = case_dir / f"{case}_biref_gated.png"
        hybrid_p = case_dir / f"{case}_hybrid_refined.png"
        
        cells = f'<td class="row-label"><strong>{case}</strong></td>'
        
        for name, p in [
            ("Original", orig_p), 
            ("FASHN Seg", fashn_p),
            ("SCHP Seg", schp_p),
            ("DINO Boxes", dino_p),
            ("Grounded-SAM-2", sam_p), 
            ("ViTMatte", vitmatte_p), 
            ("BiRefNet", biref_p),
            ("Hybrid", hybrid_p)
        ]:
            src = img_to_b64(p)
            is_trans = name in ["Grounded-SAM-2", "ViTMatte", "BiRefNet", "Hybrid"]
            td_class = "img-cell transparent-black-bg" if is_trans else "img-cell"
            if src:
                cells += f'<td class="{td_class}"><img src="{src}" /></td>'
            else:
                cells += f'<td class="{td_class}"><em>N/A</em></td>'
        rows += f"<tr>{cells}</tr>\n"
    return rows

def build_html() -> str:
    gallery_rows = build_gallery_rows()
    
    # Load base64 for N1 progression flow
    n1_orig = img_to_b64(SEGMENTATION_DIR / "scratch" / "different_model_testing" / "comparison_test" / "N1" / "original.png")
    n1_fashn = img_to_b64(SEGMENTATION_DIR / "scratch" / "different_model_testing" / "comparison_test" / "N1" / "fashn_seg.png")
    n1_sam = img_to_b64(SEGMENTATION_DIR / "scratch" / "different_model_testing" / "comparison_test" / "N1" / "grounded_sam2_transparent.png")
    n1_trimap = img_to_b64(OUTPUT_ROOT / "N1" / "N1_trimap.png")
    n1_vitmatte = img_to_b64(OUTPUT_ROOT / "N1" / "N1_vitmatte_refined.png")
    n1_biref = img_to_b64(OUTPUT_ROOT / "N1" / "N1_biref_gated.png")
    n1_hybrid = img_to_b64(OUTPUT_ROOT / "N1" / "N1_hybrid_refined.png")
    
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>SAM-Guided Matting Report</title>
<!-- Include Mermaid CDN -->
<script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
<script>
  mermaid.initialize({{
    startOnLoad: true,
    theme: 'neutral',
    flowchart: {{ useMaxWidth: true, htmlLabels: true }}
  }});
</script>
<style>
  *, *::before, *::after {{ box-sizing: border-box; }}
  html {{ font-size: 11px; }}
  body {{
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1e293b;
    background: #fff;
    margin: 0;
    padding: 15px 20px;
    line-height: 1.4;
  }}
  h1 {{
    font-size: 1.5rem;
    font-weight: 700;
    margin: 0 0 6px;
    color: #0f172a;
    border-bottom: 2px solid #4f46e5;
    padding-bottom: 6px;
  }}
  h2 {{
    font-size: 1.15rem;
    font-weight: 600;
    margin: 15px 0 8px;
    color: #0f172a;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 4px;
    page-break-after: avoid;
  }}
  p {{ margin: 0 0 8px; color: #475569; }}
  ul {{ margin: 0 0 8px; padding-left: 20px; }}
  li {{ margin-bottom: 3px; color: #475569; }}
  
  table {{
    width: 100%;
    border-collapse: collapse;
    margin: 10px 0 12px;
    font-size: 0.72rem;
  }}
  th, td {{
    border: 1px solid #e2e8f0;
    padding: 4px 6px;
    text-align: center;
    vertical-align: middle;
  }}
  th {{
    background: #1e293b;
    font-weight: 600;
    color: #fff;
  }}
  td.row-label {{
    text-align: left;
    white-space: nowrap;
    background: #f8fafc;
    font-weight: bold;
    color: #0f172a;
  }}
  
  /* Fixed layout for comparison gallery table to prevent horizontal overflow/breaking */
  .gallery-table {{
    table-layout: fixed;
    width: 100%;
  }}
  .gallery-table th, .gallery-table td {{
    padding: 3px;
    overflow: hidden;
  }}
  
  /* Alternate row shading for data tables */
  .data-table tbody tr:nth-child(even) {{
    background-color: #f8fafc;
  }}

  td.img-cell img {{
    max-width: 58px;
    max-height: 78px;
    width: auto;
    height: auto;
    display: block;
    margin: 0 auto;
    border: 1px solid #cbd5e1;
    border-radius: 2px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
  }}

  td.transparent-black-bg {{
    background-color: #0f172a;
    background-image: conic-gradient(#1e293b 25%, transparent 25% 50%, #1e293b 50% 75%, transparent 75%);
    background-size: 6px 6px;
  }}
  
  /* ---- Mermaid chart ---- */
  .flowchart-container {{
    text-align: center;
    margin: 8px 0;
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }}
  .mermaid {{
    display: inline-block;
    margin: 0 auto;
    width: 100%;
    max-width: 460px;
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }}
  .validation-image-caption {{
    font-size: 0.75rem;
    margin-top: 2px;
    color: #64748b;
  }}
  
  /* Visual Mask Progression Flow CSS */
  .flow-row {{
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin: 6px 0;
  }}
  .flow-step {{
    text-align: center;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    padding: 6px 8px;
    width: 110px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
  }}
  .flow-step-wide {{
    text-align: center;
    background: #eef2ff;
    border: 2px solid #4f46e5;
    border-radius: 4px;
    padding: 6px 8px;
    width: 130px;
    box-shadow: 0 1px 3px rgba(79,70,229,0.15);
  }}
  .flow-label {{
    font-size: 0.7rem;
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 3px;
  }}
  .flow-img {{
    max-width: 75px;
    max-height: 100px;
    width: auto;
    height: auto;
    display: block;
    margin: 0 auto 4px;
    border: 1px solid #cbd5e1;
    border-radius: 3px;
  }}
  .flow-desc {{
    font-size: 0.6rem;
    color: #64748b;
    line-height: 1.2;
  }}
  .flow-arrow {{
    font-size: 1.3rem;
    font-weight: 700;
    color: #4f46e5;
    user-select: none;
  }}
  .flow-arrow-down {{
    font-size: 1.3rem;
    font-weight: 700;
    color: #4f46e5;
    text-align: center;
    margin: 2px 0;
  }}
  .flow-branches {{
    display: flex;
    justify-content: center;
    gap: 40px;
    margin: 4px 0;
  }}
  .flow-branch {{
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }}
  .branch-label {{
    font-size: 0.65rem;
    font-weight: 600;
    color: #4f46e5;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }}
  .flow-merge-row {{
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin: 4px 0;
  }}
  
  .page-break {{
    page-break-before: always;
    break-before: page;
  }}
  
  @page {{
    size: A4 landscape;
    margin: 6mm 6mm;
  }}
  @media print {{
    body {{ padding: 0; }}
    h2 {{ page-break-after: avoid; }}
    tr, img, .flowchart-container, .mermaid {{ page-break-inside: avoid !important; break-inside: avoid !important; }}
  }}
</style>
</head>
<body>

<h1>SAM-Guided Matting Pipeline Report</h1>
<p>This report presents the comparative results of applying advanced matting algorithms on top of the <strong>Grounded-SAM-2 (Grounding DINO + SAM)</strong> mask outputs, which are guided by <strong>FASHN Human Parser</strong> and <strong>SCHP</strong> coarse segments. By using Grounded-SAM-2 as a region gate/trimap prior, we successfully resolve boundary staircase (aliasing) artifacts using <strong>ViTMatte</strong> and <strong>BiRefNet</strong>.</p>

<h2>1. End-to-End Hybrid Refinement Pipeline</h2>
<div class="flowchart-container">
  <div class="mermaid">
    graph TD
        Input[Input Image: Model Shot] --> Stage1[Stage 1: FASHN & SCHP Coarse Parsing]
        Stage1 -->|Coarse Mask & Exclusion| Stage2[Stage 2: Grounded-SAM-2 Mask Refinement]
        Stage2 -->|Grounded-SAM-2 Mask| Stage3[Stage 3: Trimap Generation]
        Stage2 -->|Safe Mask Exclusion| Stage3
        Stage3 -->|SAM Trimap Prior| Stage4[Stage 4: ViTMatte Guided Refinement]
        Stage2 -->|SAM Gate Mask| Stage5[Stage 5: BiRefNet Gated Matting]
        Stage4 -->|Soft Sub-pixel Alpha| Stage6[Stage 6: Hybrid Blended Transparent RGBA]
        Stage5 -->|Sharp Alpha Clean| Stage6
  </div>
  <div class="validation-image-caption">Figure 1: SAM-Guided Matting Pipeline Flowchart</div>
</div>

<h2 class="page-break">2. Model Inputs and Output Usage Summary</h2>
<p>The table below details the specific inputs and usage patterns for each algorithm within the pipeline:</p>
<table class="data-table">
  <thead>
    <tr>
      <th style="text-align:left; width:20%">Model / Stage</th>
      <th style="text-align:left; width:40%">Inputs Provided</th>
      <th style="text-align:left; width:40%">Outputs and Usage</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="text-align:left"><strong>FASHN Human Parser (SegFormer-B4) & SCHP</strong></td>
      <td style="text-align:left">Original model shot image (RGB)</td>
      <td style="text-align:left">Outputs semantic class segmentation maps. Used to isolate coarse garment boundaries, neckline cutouts, and body part exclusion coordinates (hands, face, hair, etc.).</td>
    </tr>
    <tr>
      <td style="text-align:left"><strong>Grounded-SAM-2</strong></td>
      <td style="text-align:left">Original image + Grounding DINO text prompts + FASHN/SCHP exclusion coordinates for SAM2 point prompts</td>
      <td style="text-align:left">Outputs a precise binary semantic garment mask and neck cutout. Used as the region gate for BiRefNet and to generate the trimap for ViTMatte.</td>
    </tr>
    <tr>
      <td style="text-align:left"><strong>Trimap Generation</strong></td>
      <td style="text-align:left">Grounded-SAM-2 binary mask</td>
      <td style="text-align:left">Outputs a three-state trimap (foreground, background, unknown edge band). Used to guide ViTMatte's local boundary alpha prediction.</td>
    </tr>
    <tr>
      <td style="text-align:left"><strong>ViTMatte</strong></td>
      <td style="text-align:left">Original image + generated trimap</td>
      <td style="text-align:left">Outputs soft, sub-pixel alpha transparency values. Used to resolve fine fabric edges and anti-alias boundaries in final blending.</td>
    </tr>
    <tr>
      <td style="text-align:left"><strong>BiRefNet</strong></td>
      <td style="text-align:left">Original image + dilated Grounded-SAM-2 gate mask</td>
      <td style="text-align:left">Outputs a sharp alpha matte restricted to the gated region. Used to ensure solid interior opacity and prevent skin/background leaks.</td>
    </tr>
    <tr>
      <td style="text-align:left"><strong>Hybrid Blending</strong></td>
      <td style="text-align:left">ViTMatte soft alpha + BiRefNet sharp alpha + blending weight matrix (Gaussian blur of SAM mask interior)</td>
      <td style="text-align:left">Outputs the final blended hybrid alpha matte. Used to extract the final transparent RGBA garment.</td>
    </tr>
  </tbody>
</table>

<p>The coarse parsers (FASHN, SCHP) provide the initial garment region and body part exclusion zones. Grounded-SAM-2 uses those coordinates along with Grounding DINO text prompts to produce a high-precision binary garment mask. This SAM mask is the single source of truth that feeds both refinement branches. The trimap branch erodes and dilates the SAM mask to create an unknown-edge band, which ViTMatte uses to predict sub-pixel alpha at fabric boundaries. The BiRefNet branch runs salient-object matting on the full image but gates the output with a dilated SAM mask, so only the garment region survives. In the final hybrid step, a Gaussian-blurred interior weight map selects BiRefNet alpha for the solid garment interior and ViTMatte alpha for the soft boundary edges, producing a clean transparent RGBA garment.</p>

<h2 class="page-break">3. Visual Mask Progression Flow (Example Case: N1)</h2>
<p>The flow below shows the actual intermediate masks for case N1 as they move through each stage. Note the two parallel branches after the SAM mask, which merge into the final hybrid result.</p>

<!-- Row 1: Linear flow from Original to SAM -->
<div class="flow-row">
  <div class="flow-step">
    <div class="flow-label">Original Image</div>
    <img src="{n1_orig}" class="flow-img" />
    <div class="flow-desc">Input model shot (RGB).</div>
  </div>
  <div class="flow-arrow">&rarr;</div>
  <div class="flow-step">
    <div class="flow-label">FASHN/SCHP Parsing</div>
    <img src="{n1_fashn}" class="flow-img" />
    <div class="flow-desc">Coarse garment mask and body part exclusion zones.</div>
  </div>
  <div class="flow-arrow">&rarr;</div>
  <div class="flow-step">
    <div class="flow-label">Grounded-SAM-2</div>
    <img src="{n1_sam}" class="flow-img transparent-black-bg" />
    <div class="flow-desc">Precise binary garment mask with SAM point prompts.</div>
  </div>
</div>

<!-- Arrow down to branches -->
<div class="flow-arrow-down">&darr; SAM mask feeds both branches &darr;</div>

<!-- Row 2: Two parallel branches -->
<div class="flow-branches">
  <div class="flow-branch">
    <div class="branch-label">Branch A: Soft Edges</div>
    <div class="flow-step">
      <div class="flow-label">Trimap</div>
      <img src="{n1_trimap}" class="flow-img" />
      <div class="flow-desc">Erode/dilate SAM mask to create unknown boundary band.</div>
    </div>
    <div class="flow-arrow-down">&darr;</div>
    <div class="flow-step">
      <div class="flow-label">ViTMatte</div>
      <img src="{n1_vitmatte}" class="flow-img transparent-black-bg" />
      <div class="flow-desc">Predicts soft sub-pixel alpha at fabric edges.</div>
    </div>
  </div>
  <div class="flow-branch">
    <div class="branch-label">Branch B: Sharp Interior</div>
    <div class="flow-step">
      <div class="flow-label">BiRefNet (Gated)</div>
      <img src="{n1_biref}" class="flow-img transparent-black-bg" />
      <div class="flow-desc">Salient-object matting gated by dilated SAM mask. Solid interior opacity.</div>
    </div>
  </div>
</div>

<!-- Arrow down to merge -->
<div class="flow-arrow-down">&darr; Gaussian-weighted blend &darr;</div>

<!-- Row 3: Final hybrid -->
<div class="flow-merge-row">
  <div class="flow-step-wide">
    <div class="flow-label">Hybrid Result</div>
    <img src="{n1_hybrid}" class="flow-img transparent-black-bg" />
    <div class="flow-desc">BiRefNet interior + ViTMatte edges blended via Gaussian weight map. Final transparent RGBA.</div>
  </div>
</div>

<h2 class="page-break">4. Visual Comparison Gallery</h2>
<table class="gallery-table">
  <thead>
    <tr>
      <th style="width: 8%; text-align:left">Item ID</th>
      <th style="width: 11.5%">01. Original</th>
      <th style="width: 11.5%">02. FASHN Seg</th>
      <th style="width: 11.5%">03. SCHP Seg</th>
      <th style="width: 11.5%">04. DINO Boxes</th>
      <th style="width: 11.5%">05. Grounded-SAM-2</th>
      <th style="width: 11.5%">06. ViTMatte (Soft)</th>
      <th style="width: 11.5%">07. BiRefNet (Sharp)</th>
      <th style="width: 11.5%">08. Hybrid (Blended)</th>
    </tr>
  </thead>
  <tbody>
    {gallery_rows}
  </tbody>
</table>

</body>
</html>"""

async def generate_pdf():
    from playwright.async_api import async_playwright

    html_content = build_html()
    tmp_html = BASE_DIR / "_report_tmp.html"
    tmp_html.write_text(html_content, encoding="utf-8")

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto(f"file:///{tmp_html.as_posix()}", wait_until="networkidle")
        
        # Give Mermaid JS time to load and render into SVG
        await asyncio.sleep(3)
        
        await page.pdf(
            path=str(PDF_PATH),
            format="A4",
            print_background=True,
            display_header_footer=False,
            margin={
                "top": "10mm",
                "bottom": "10mm",
                "left": "10mm",
                "right": "10mm",
            },
        )
        await browser.close()

    tmp_html.unlink(missing_ok=True)
    print(f"[OK] PDF generated: {PDF_PATH}")
    print(f"     Size: {PDF_PATH.stat().st_size / 1024:.0f} KB")

if __name__ == "__main__":
    asyncio.run(generate_pdf())
