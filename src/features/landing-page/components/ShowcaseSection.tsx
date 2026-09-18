import { motion } from "framer-motion";

const VIDEO = { src: "/sumakesh_video.mp4", alt: "Model showcasing an Atlyr look" };

/** The showcase card: one looping video, sized by the height the screen leaves it. */
export function ShowcaseSection() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="flex min-h-0 w-full flex-1 items-center justify-center"
    >
      <div className="h-full max-w-full overflow-hidden rounded-2xl shadow-lg" style={{ aspectRatio: "3 / 5.4" }}>
        <video className="h-full w-full object-cover" autoPlay loop muted playsInline style={{ background: "#fff" }}>
          <source src={VIDEO.src} type="video/mp4" />
          {VIDEO.alt}
        </video>
      </div>
    </motion.div>
  );
}
