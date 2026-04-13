import type { HeroGarment, DeviceGalleryItem } from "./types";

export const heroGarments: HeroGarment[] = [
  {
    src: "/products/tops/4.png",
    alt: "Ivory silk blouse",
    className: "hidden lg:block w-[160px] xl:w-[180px]",
    style: { top: "14%", left: "1%" },
  },
  {
    src: "/products/tops/11.png",
    alt: "Cropped leather jacket",
    className: "hidden lg:block w-[140px] xl:w-[160px]",
    style: { top: "58%", left: "2%" },
  },
  {
    src: "/products/bottoms/20.png",
    alt: "Camel wrap skirt",
    className: "hidden xl:block w-[120px]",
    style: { top: "25%", left: "25%" },
  },
  {
    src: "/products/shoes/21.png",
    alt: "Textured neutral sneakers",
    className: "hidden lg:block w-[100px] xl:w-[100px]",
    style: { top: "8%", left: "90%" },
  },
  {
    src: "/products/tops/9.png",
    alt: "Contrast collar jacket",
    className: "hidden lg:block w-[140px] xl:w-[140px]",
    style: { top: "2%", left: "70%" },
  },
  {
    src: "/products/tops/13.png",
    alt: "Chestnut blazer",
    className: "hidden xl:block w-[160px]",
    style: { top: "62%", left: "80%" },
  },
  {
    src: "/products/shoes/22.png",
    alt: "Polished leather loafers",
    className: "hidden xl:block w-[100px]",
    style: { top: "78%", left: "25%" },
  },
  {
    src: "/products/tops/8.png",
    alt: "Powder blue blouse",
    className: "hidden 2xl:block w-[150px]",
    style: { top: "-12%", left: "18%" },
  },
  {
    src: "/products/bottoms/18.png",
    alt: "Tailored black trousers",
    className: "hidden 2xl:block w-[120px]",
    style: { top: "40%", left: "82%" },
  },
];

export const deviceGallery: DeviceGalleryItem[] = [
  { src: "/products/tops/8.png", alt: "Powder blue blouse" },
  { src: "/products/bottoms/17.png", alt: "Pleated charcoal trousers" },
  { src: "/products/shoes/22.png", alt: "Polished leather loafers" },
  { src: "/products/tops/9.png", alt: "Cardigan with contrast trim" },
];

export const STAPLES_BUCKET = "product-images";
export const STAPLES_PREFIXES = ["product-images/staples", "staples"];
export const STAPLES_TARGET_COUNT = 63;

