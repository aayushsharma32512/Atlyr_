import { motion } from "framer-motion";
import Orb from "../reactbits-components/Orb";

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

export function AISection() {
  const backgroundColor = getCSSVariableAsHex("--background");

  return (
    <section className="relative py-28 sm:py-36 lg:py-44">
      <div className="mx-auto w-full max-w-7xl px-6 sm:px-8">
        <div className="grid gap-16 lg:grid-cols-2 lg:items-center lg:gap-20">
          {/* Left side - Content */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="flex flex-col gap-6 text-center lg:text-left"
          >
            <div className="inline-flex items-center gap-2 self-center rounded-full border border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground lg:self-start">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary"></span>
              </span>
              Powered by AI
            </div>
            
            <h2 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              Your personal style assistant
            </h2>
            
            <p className="text-lg text-muted-foreground sm:text-xl">
              ATLYR AI understands your unique style preferences and curates outfits that match your vibe, occasion, and mood—all powered by advanced machine learning.
            </p>
            
            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:gap-6 lg:justify-start">
              <div className="flex flex-col gap-1">
                <span className="text-2xl font-semibold text-foreground">Smart Matching</span>
                <span className="text-sm text-muted-foreground">
                  AI analyzes your wardrobe and suggests perfect combinations
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-2xl font-semibold text-foreground">Style Learning</span>
                <span className="text-sm text-muted-foreground">
                  Gets better at understanding your preferences over time
                </span>
              </div>
            </div>
          </motion.div>

           {/* Right side - Orb */}
           <motion.div
             initial={{ opacity: 0, x: 30 }}
             whileInView={{ opacity: 1, x: 0 }}
             viewport={{ once: true, margin: "-100px" }}
             transition={{ duration: 0.6, delay: 0.2 }}
             className="relative flex items-center justify-center"
           >
             <div className="relative aspect-square w-full max-w-md">
               <div className="absolute inset-0 flex items-center justify-center">
                 <div className="relative h-full w-full max-w-sm">
                   <Orb
                     hue={220}
                     hoverIntensity={0.3}
                     rotateOnHover={true}
                     backgroundColor={backgroundColor}
                   />
                 </div>
               </div>
               
               {/* Text inside orb - positioned absolutely with pointer-events-none to not interfere with hover */}
               <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-6">
                 <motion.div
                   initial={{ opacity: 0, scale: 0.95 }}
                   whileInView={{ opacity: 1, scale: 1 }}
                   viewport={{ once: true }}
                   transition={{ duration: 0.6, delay: 0.4 }}
                   className="flex flex-col items-center gap-2"
                 >
                   <div className="inline-flex items-center gap-1.5 rounded-full border border-foreground/20 bg-background/80 px-3 py-1 backdrop-blur-sm">
                     <span className="h-1.5 w-1.5 rounded-full bg-primary"></span>
                     <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground/80">
                       AI Style Engine
                     </span>
                   </div>
                   <p className="text-center text-xs font-medium leading-tight text-foreground/70 sm:text-sm">
                     Discover your perfect
                   </p>
                   <p className="text-center text-xs font-semibold leading-tight text-foreground sm:text-sm">
                     outfit combinations
                   </p>
                 </motion.div>
               </div>
               
               {/* Decorative gradient rings */}
               <div className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center">
                 <div className="h-[120%] w-[120%] rounded-full bg-primary/5 blur-3xl"></div>
               </div>
             </div>
           </motion.div>
        </div>
      </div>
    </section>
  );
}

