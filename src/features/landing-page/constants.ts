import type { HeroGarment } from "./types";

/**
 * The garments floating around the demo card. Real catalog cut-outs, rebuilt by
 * scripts/build-hero-garments.ts.
 *
 * They were stock Western pieces -- blazer, leather jacket, loafers -- which read oddly orbiting a
 * card demoing ethnic wear. Womenswear and menswear alternate so the ring isn't one-sided, and the
 * two slots that used to hold shoes now hold bottoms: the catalog has no ethnic footwear.
 *
 * Positions, width classes and breakpoints are the pre-rebrand layout VERBATIM -- only the
 * clothes changed. Each image is padded to the aspect ratio of the photo that used to sit in its
 * slot, so every box is exactly the size it was before. That padding is load-bearing: the layout
 * fixes a width and lets height fall out of the aspect ratio, and kurtas are far longer than the
 * near-square flat-shot tops they replaced, so unpadded they rendered about twice as tall and the
 * right-hand garments collided.
 *
 * Safe to trim and pad only because nothing here is composited onto a mannequin -- no placement
 * transform or warp lattice is measured against these pixels, unlike the worn garments in
 * landingMockProducts. 26.9MB of source PNGs became 377KB.
 */
export const heroGarments: HeroGarment[] = [
  {
    src: "/landing-hero/1-top-59811841.webp",
    alt: "Ethnic Motifs Printed V-Neck Pure Cotton Kurti",
    className: "hidden lg:block w-[160px] xl:w-[180px]",
    style: { top: "14%", left: "1%" },
  },
  {
    src: "/landing-hero/2-top-eabf492d.webp",
    alt: "Bandhani Printed Thread Work A-Line Short Kurti",
    className: "hidden lg:block w-[140px] xl:w-[160px]",
    style: { top: "58%", left: "2%" },
  },
  {
    src: "/landing-hero/3-bottom-ca202448.webp",
    alt: "Women Flared Ethnic Sharara with Gotta Patti Detail",
    className: "hidden xl:block w-[120px]",
    style: { top: "25%", left: "25%" },
  },
  {
    src: "/landing-hero/4-top-3db8aec0.webp",
    alt: "Ethnic Motifs Printed Halter Neck Kurti",
    className: "hidden lg:block w-[100px] xl:w-[100px]",
    style: { top: "8%", left: "90%" },
  },
  {
    src: "/landing-hero/5-top-735fe807.webp",
    alt: "Rangsutra Ronav Grey Chikankari Allover Embroidered Short Kurta",
    className: "hidden lg:block w-[140px] xl:w-[140px]",
    style: { top: "2%", left: "70%" },
  },
  {
    src: "/landing-hero/6-top-88edc913.webp",
    alt: "Maroon Cotton Ajrakh Printed Slim Fit Short Kurta",
    className: "hidden xl:block w-[160px]",
    style: { top: "72%", left: "77%" },
  },
  {
    src: "/landing-hero/7-bottom-d82b86d3.webp",
    alt: "Women Floral Hem Design Flared Palazzos",
    className: "hidden xl:block w-[100px]",
    style: { top: "78%", left: "25%" },
  },
  {
    src: "/landing-hero/8-top-b165ba8b.webp",
    alt: "Men Yellow Lyocell Linen Mandarin Collar Straight Fit Kurta",
    className: "hidden 2xl:block w-[150px]",
    style: { top: "-12%", left: "18%" },
  },
  {
    src: "/landing-hero/9-bottom-954c9e43.webp",
    alt: "Cropped Pleated Wide-Leg Trousers",
    className: "hidden 2xl:block w-[120px]",
    style: { top: "34%", left: "87%" },
  },
];

export const STAPLES_BUCKET = "product-images";
export const STAPLES_PREFIXES = ["product-images/staples", "staples"];
export const STAPLES_TARGET_COUNT = 63;

