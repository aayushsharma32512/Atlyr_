import { lazy, Suspense, useEffect } from "react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { heroGarments } from "../constants";
import { prefetchLandingStudio } from "../hooks/useLandingStudioData";

// PIXI rides in this chunk; the page shell paints before it lands.
const LandingStudio = lazy(() =>
  import("./LandingStudio").then((m) => ({ default: m.LandingStudio })),
);

/** The phone frame. Takes whatever height the section leaves it. */
export function HeroPreview() {
  const queryClient = useQueryClient();
  useEffect(() => prefetchLandingStudio(queryClient), [queryClient]);

  return (
    <div className="relative flex min-h-0 w-full max-w-[1200px] flex-1 justify-center">
      {/* Subtle background glow */}
      <div className="pointer-events-none absolute inset-x-4 inset-y-0 -z-10 flex items-center justify-center sm:inset-x-0">
        <div className="h-[400px] w-[400px] rounded-full bg-primary/5 blur-3xl sm:h-[500px] sm:w-[500px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.6, ease: "easeOut" }}
        className="relative z-10 h-full w-full max-w-[430px] overflow-hidden rounded-[38px] border-4 border-primary bg-card/80 shadow-lg backdrop-blur-sm"
      >
        <Suspense fallback={<div className="h-full w-full bg-background" />}>
          <LandingStudio />
        </Suspense>
      </motion.div>

      {/* Floating garment images, desktop only */}
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
  );
}
