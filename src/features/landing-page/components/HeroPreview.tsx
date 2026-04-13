import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { deviceGallery, heroGarments } from "../constants";
import { LandingMiniStudio } from "./LandingMiniStudio";

export function HeroPreview() {
  return (
    <div className="relative mt-2 w-full sm:mt-12 lg:mt-8">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.7, ease: "easeOut" }}
        className="relative flex w-full justify-center"
      >
        <div className="relative flex w-full max-w-[1200px] justify-center px-0 sm:px-0">
          {/* Subtle background glow */}
          <div className="pointer-events-none absolute inset-x-4 inset-y-0 -z-10 flex items-center justify-center sm:inset-x-0">
            <div className="h-[400px] w-[400px] rounded-full bg-primary/5 blur-3xl sm:h-[500px] sm:w-[500px]" />
          </div>

          <div className="relative flex w-full items-center justify-center">
            {/* Main preview card */}
            <div className="relative z-10 mx-auto w-full max-w-[430px] rounded-[38px] border-4 border-primary shadow-lg bg-card/80 p-0 backdrop-blur-sm overflow-hidden sm:max-w-[430px] sm:p-0">
              <LandingMiniStudio />
            </div>

            {/* Floating garment images */}
            {heroGarments.map((item, index) => (
              <motion.img
                key={item.src}
                src={item.src}
                alt={item.alt}
                className={`pointer-events-none select-none drop-shadow-lg ${item.className ?? ""}`}
                style={{
                  position: "absolute",
                  ...item.style,
                  transform: "translate(-50%, -50%)",
                  zIndex: 1,
                }}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + index * 0.06, duration: 0.5, ease: "easeOut" }}
              />
            ))}
          </div>
        </div>
      </motion.div>
      
      {/* Disclaimer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.5 }}
        className="mt-6 text-center w-full"
      >
        <p className="text-xs text-muted-foreground/60">
        This demo uses AI-generated imagery for showcasing styling capabilities only.
        </p>
      </motion.div>
    </div>
  );
}

