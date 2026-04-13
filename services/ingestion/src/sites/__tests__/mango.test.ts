import { applyMangoDeterministicImageFilter } from '../mango';

describe('mango deterministic image filter', () => {
  it('extracts gallery images from ImageGrid and prefers highest resolution', () => {
    const originalUrl = 'https://shop.mango.com/in/en/p/women/overalls/short/halter-neck-jumpsuit_17084144';
    const html = [
      '<div class="ProductDetail_gallery__UfzyT">',
      '  <ul class="ImageGrid_imageGrid__yHwBP">',
      '    <li class="ImageGrid_twoRowImage__b4_Ug ImageGridItem_imageItem__LYpJP">',
      '      <img class="ImageGridItem_image__VVZxr" srcset="https://shop.mango.com/assets/rcs/pics/static/T1/fotos/S/17084144_99.jpg?imwidth=280&amp;imdensity=1 280w, https://shop.mango.com/assets/rcs/pics/static/T1/fotos/S/17084144_99.jpg?imwidth=2048&amp;imdensity=1 2048w" src="https://shop.mango.com/assets/rcs/pics/static/T1/fotos/S/17084144_99.jpg?imwidth=1024&amp;imdensity=1" />',
      '    </li>',
      '    <li class="ImageGrid_fourRowImage__yoowI ImageGridItem_imageItem__LYpJP">',
      '      <img class="ImageGridItem_image__VVZxr" srcset="https://shop.mango.com/assets/rcs/pics/static/T1/fotos/outfit/S/17084144_99-99999999_01.jpg?imwidth=320&amp;imdensity=1 320w, https://shop.mango.com/assets/rcs/pics/static/T1/fotos/outfit/S/17084144_99-99999999_01.jpg?imwidth=2048&amp;imdensity=1 2048w" />',
      '    </li>',
      '  </ul>',
      '</div>',
    ].join('\n');

    const json = {
      images: [
        { url: 'https://shop.mango.com/assets/rcs/pics/static/T1/fotos/S/17084144_99.jpg?imwidth=768&imdensity=1' },
      ]
    } as Record<string, unknown>;

    const out = applyMangoDeterministicImageFilter({ originalUrl, json, html });
    expect(out.imageUrls).toEqual([
      'https://shop.mango.com/assets/rcs/pics/static/T1/fotos/S/17084144_99.jpg?imwidth=2048&imdensity=1',
      'https://shop.mango.com/assets/rcs/pics/static/T1/fotos/outfit/S/17084144_99-99999999_01.jpg?imwidth=2048&imdensity=1',
    ]);
  });
});
