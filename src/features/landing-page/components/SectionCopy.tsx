import { Fragment } from "react";
import { motion } from "framer-motion";

/** Two short lines above a card. Wrap a phrase in asterisks to set it in the display italic accent. */
export function SectionCopy({ lines }: { lines: string[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="flex w-full flex-col items-center gap-1 text-center text-[clamp(0.8rem,3.6vw,1.25rem)] leading-snug text-muted-foreground"
    >
      {lines.map((line) => (
        <p key={line} className="whitespace-nowrap">
          {line.split("*").map((part, index) =>
            index % 2 === 1 ? (
              <span key={index} className="px-0.5 font-display italic text-violet">
                {part}
              </span>
            ) : (
              <Fragment key={index}>{part}</Fragment>
            ),
          )}
        </p>
      ))}
    </motion.div>
  );
}
