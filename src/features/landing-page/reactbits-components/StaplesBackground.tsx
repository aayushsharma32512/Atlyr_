import { useMemo } from "react";
import { motion } from "framer-motion";

type StaplesBackgroundProps = {
  staplesSequence: string[];
};

export function StaplesBackground({ staplesSequence }: StaplesBackgroundProps) {
  const staplesMotion = useMemo(() => {
    return staplesSequence.map((_, index) => {
      const base = Math.sin(index * 17.37);
      const offsetX = ((base * 1000) % 1) * 20 - 10; // range [-10,10]
      const offsetY = ((Math.cos(index * 11.91) * 1000) % 1) * 16 - 8; // range [-8,8]
      const rotation = ((Math.sin(index * 9.73) + 1) / 2) * 4 - 2; // range [-2,2]
      const delay = (index % 12) * 0.4;
      return { offsetX, offsetY, rotation, delay };
    });
  }, [staplesSequence]);

  return (
    <>
      <div className="pointer-events-none absolute inset-0 -z-20">
        <div className="absolute inset-0 opacity-[0.4]">
          <div className="grid h-full w-full grid-cols-7 grid-rows-[repeat(9,minmax(90px,1fr))] gap-[1px]">
            {staplesSequence.map((src, index) => {
              const animation = staplesMotion[index] ?? { offsetX: 0, offsetY: 0, rotation: 0, delay: 0 };
              return (
                <motion.div
                  key={`${src}-${index}`}
                  className="relative flex items-center justify-center overflow-hidden bg-[#15100d]"
                  animate={{
                    x: [0, animation.offsetX, 0],
                    y: [0, animation.offsetY, 0],
                    rotate: [0, animation.rotation, 0],
                  }}
                  transition={{
                    duration: 18,
                    repeat: Infinity,
                    repeatType: "mirror",
                    ease: "easeInOut",
                    delay: animation.delay,
                  }}
                >
                  <img
                    src={src}
                    alt="Staples collage"
                    className="h-full w-full object-contain mix-blend-screen opacity-55"
                    loading="lazy"
                  />
                </motion.div>
              );
            })}
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-[#0f0a08]/45 via-[#0f0a08]/55 to-[#0f0a08]/80 mix-blend-multiply" />
          <div
            className="absolute inset-0 opacity-40 mix-blend-soft-light"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 200 200'%3E%3Crect width='100%25' height='100%25' fill='%23000000'/%3E%3Cg fill='%23ffffff' fill-opacity='0.08'%3E%3Ccircle cx='125' cy='90' r='1'/%3E%3Ccircle cx='35' cy='20' r='1'/%3E%3Ccircle cx='165' cy='160' r='1'/%3E%3Ccircle cx='70' cy='130' r='1'/%3E%3Ccircle cx='190' cy='40' r='1'/%3E%3Ccircle cx='10' cy='180' r='1'/%3E%3C/g%3E%3C/svg%3E\")",
              backgroundSize: "220px 220px",
            }}
          />
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-52 left-1/2 h-[540px] w-[540px] -translate-x-1/2 rounded-full bg-[#3a2214]/40 blur-[200px]" />
        <div className="absolute bottom-0 left-1/2 h-[640px] w-[760px] -translate-x-1/2 rounded-full bg-[#2a1a12]/50 blur-[250px]" />
        <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
      </div>
    </>
  );
}

