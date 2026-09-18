import { motion } from "framer-motion";

type Phrase = [lead: string, accent: string, tail?: string];

// Two phrases a line, so the copy stays two lines on a phone and leaves the frame the screen. Violet is the accent.
const ROWS: Phrase[][] = [
  [
    ["play", "irl dress up", "game"],
    ["search by", "pure vibes"],
  ],
  [
    ["personalise", "any inspiration"],
    ["curate", "your wardrobe"],
  ],
];

export function HeroSection() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="flex w-full flex-col items-center gap-1 pb-3 text-center text-[clamp(0.8rem,3.6vw,1.25rem)] leading-snug text-muted-foreground"
    >
      {ROWS.map((row, index) => (
        <p key={index} className="flex flex-wrap justify-center gap-x-5 whitespace-nowrap">
          {row.map(([lead, accent, tail]) => (
            <span key={accent}>
              {lead} <span className="px-0.5 font-display italic text-violet">{accent}</span>
              {tail ? ` ${tail}` : null}
            </span>
          ))}
        </p>
      ))}
    </motion.div>
  );
}
