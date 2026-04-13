import { useMemo } from "react";
import { motion } from "framer-motion";
import ScrollReveal from "../reactbits-components/ScrollReveal";
import ScrollVelocity from "../reactbits-components/ScrollVelocity";
import BlurText from "../reactbits-components/BlurText";
import { Separator } from "@radix-ui/react-select";

// Helper function to get CSS variable value as hex color
function getCSSVariableAsHex(variable: string): string {
  if (typeof window === "undefined") return "#000000";

  const root = document.documentElement;
  const value = getComputedStyle(root).getPropertyValue(variable).trim();

  if (!value) return "#000000";

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

export function AboutSection() {
  const foregroundColor = useMemo(() => getCSSVariableAsHex("--foreground"), []);

  return (
    <section className="relative py-28 sm:py-36 lg:py-44 min-h-[100vh]">
      <div className="mx-auto w-full max-w-7xl px-6 sm:px-8">
        <div className="flex flex-col items-center text-center">
          <div className="max-w-5xl">
            <div className="mb-8 sm:mb-10 mt-[200px]">
              <ScrollReveal
                enableBlur={true}
                baseOpacity={0.12}
                baseRotation={2}
                blurStrength={2}
                containerClassName="w-full flex justify-center"
                textClassName="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground tracking-tight leading-tight"
                rotationEnd="center center"
                wordAnimationEnd="center center"
              >
                About ATLYR
              </ScrollReveal>
            </div>
            <ScrollReveal
              enableBlur={true}
              baseOpacity={0.12}
              baseRotation={2}
              blurStrength={2}
              containerClassName="w-full"
              textClassName="text-lg sm:text-xl text-foreground font-normal tracking-tight leading-[1.3] "
              rotationEnd="center center"
              wordAnimationEnd="center center"
            >
              Atlyr understands your style 🎨, learns your preferences 🧠, and curates outfits that match your vibe ✨—every single time. From streetwear to smart casual, our smart platform analyzes your favorite pieces, follows your evolving taste, and helps you discover looks you never knew you needed—all personalized for your lifestyle. 
            </ScrollReveal>
          </div>
        </div>

        {/* ScrollVelocity at the bottom */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-12 lg:mt-16 -mx-0 overflow-hidden absolute bottom-24 left-0 right-0"
        >
          <ScrollVelocity
            texts={[
              "Understand Your Style • Learn Your Preferences",
              "Curate Perfect Outfits • Match Your Vibe",
            ]}
            velocity={38}
            className="text-sm text-foreground"
            damping={60}
            stiffness={500}
            numCopies={8}
            parallaxClassName=""
            scrollerClassName="text-foreground"
            scrollerStyle={{
              fontSize: "0.95rem",
              fontWeight: 500,
              lineHeight: 1.2,
              color: foregroundColor,
            }}
          />
        </motion.div>
      </div>
    </section>
  );
}

