import { useMemo, useState, useEffect } from "react";
import CircularGallery from "../reactbits-components/CircularGallery";

// Helper function to get CSS variable value as hex color
function getCSSVariableAsHex(variable: string): string {
  if (typeof window === "undefined") return "#ffffff";
  
  const root = document.documentElement;
  const value = getComputedStyle(root).getPropertyValue(variable).trim();
  
  if (!value) return "#ffffff";
  
  // If it's in HSL format (e.g., "12 6.4935% 15.0980%"), convert to hex
  if (value.includes(" ")) {
    const hslMatch = value.match(/(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/);
    if (hslMatch) {
      const h = parseFloat(hslMatch[1]);
      const s = parseFloat(hslMatch[2]) / 100;
      const l = parseFloat(hslMatch[3]) / 100;
      
      // Convert HSL to RGB
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
      const m = l - c / 2;
      
      let r = 0, g = 0, b = 0;
      
      if (h >= 0 && h < 60) {
        r = c; g = x; b = 0;
      } else if (h >= 60 && h < 120) {
        r = x; g = c; b = 0;
      } else if (h >= 120 && h < 180) {
        r = 0; g = c; b = x;
      } else if (h >= 180 && h < 240) {
        r = 0; g = x; b = c;
      } else if (h >= 240 && h < 300) {
        r = x; g = 0; b = c;
      } else if (h >= 300 && h < 360) {
        r = c; g = 0; b = x;
      }
      
      const rgb = {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255),
      };
      
      return `#${rgb.r.toString(16).padStart(2, "0")}${rgb.g.toString(16).padStart(2, "0")}${rgb.b.toString(16).padStart(2, "0")}`;
    }
  }
  
  return value;
}

// Gallery items for CircularGallery
const galleryItems = [
  { image: "/products/tops/4.png", text: "Ivory Silk" },
  { image: "/products/tops/11.png", text: "Leather Jacket" },
  { image: "/products/bottoms/20.png", text: "Wrap Skirt" },
  { image: "/products/shoes/21.png", text: "Neutral Sneakers" },
  { image: "/products/tops/9.png", text: "Contrast Collar" },
  { image: "/products/tops/13.png", text: "Chestnut Blazer" },
  { image: "/products/shoes/22.png", text: "Leather Loafers" },
  { image: "/products/tops/8.png", text: "Powder Blue" },
];

export function GallerySection() {
  const textColor = useMemo(() => getCSSVariableAsHex("--foreground"), []);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640);
    };
    
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  return (
    <section className="relative py-6 sm:py-12 lg:py-16">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-12">
        <div className="flex flex-col items-center gap-6 sm:gap-8 lg:gap-12">
          <div className="text-center px-2 sm:px-4">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl">
              Discover Your Style
            </h2>
            <p className="mt-2 text-sm text-muted-foreground sm:mt-3 sm:text-base md:text-lg lg:text-xl">
              Explore curated collections that match your unique aesthetic
            </p>
          </div>

          <div 
            className="relative w-full overflow-hidden -mx-4 sm:mx-0" 
            style={{ 
              height: isMobile ? "350px" : "600px",
              minHeight: isMobile ? "350px" : "600px"
            }}
          >
            <CircularGallery
              items={galleryItems}
              bend={isMobile ? 1 : 1}
              textColor={textColor}
              borderRadius={0.05}
              scrollEase={isMobile ? .2 : 0.05} // increased easing to make scroll smoother
            />
          </div>
        </div>
      </div>
    </section>
  );
}

