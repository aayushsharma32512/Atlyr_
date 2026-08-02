import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";

export function HeroSection() {
  const navigate = useNavigate();
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: "easeOut" }}
      className="flex max-w-5xl flex-col items-center gap-2 text-center sm:gap-8 max-h-[90vh] overflow-y-hidden"
    >


      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="max-w-xl text-md text-muted-foreground sm:text-md lg:text-lg mt-8"
      >
        {/* Emphasis is the gate's tagline treatment — Bodoni italic in
            terracotta — so these lines read as the same system as the lockup
            scrolled just above them. This was Pacifico, which predated the
            rebrand and was the last thing holding that font in the page's
            font request. */}
        Personalise outfits in our <span className="px-1 font-display italic text-terracotta">style studio</span> <br />
        <span className="px-1 font-display italic text-terracotta">build virtual looks</span> with lifelike precision <br />
        collaborate with friends & <span className="px-1 font-display italic text-terracotta">co-create fits</span> <br />
        <span className="px-1 font-display italic text-terracotta">experiment</span> and remix your wardrobe <br />
      </motion.p>


    </motion.div>
  );
}

