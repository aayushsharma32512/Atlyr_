import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";

// TO CHANGE CONTENT IN FUTURE: 
// Replace these items with different video paths, alt text, and captions for each card
const featuredItems = [
    {
        video: "/sumakesh_video.mp4",
        alt: "Model showcasing sumakesh collection",
        caption: "Sumakesh Collection",
        title: "Fall Winter Drop 2",
    },
    {
        video: "/female_video.MP4",
        alt: "Model showcasing female collection",
        caption: "Female Collection",
        title: "Fall Winter Drop 2",
    },
    {
        video: "/male_video.MP4",
        alt: "Model showcasing male collection",
        caption: "Male Collection",
        title: "Fall Winter Drop 2",
    },
];

export function ShowcaseSection() {
    const containerRef = useRef<HTMLDivElement>(null);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [direction, setDirection] = useState(0);

    const slideVariants = {
        enter: (direction: number) => ({
            x: direction > 0 ? 300 : -300,
            opacity: 0,
            scale: 0.9
        }),
        center: {
            zIndex: 1,
            x: 0,
            opacity: 1,
            scale: 1
        },
        exit: (direction: number) => ({
            zIndex: 0,
            x: direction < 0 ? 300 : -300,
            opacity: 0,
            scale: 0.9
        })
    };

    const swipeConfidenceThreshold = 10000;
    const swipePower = (offset: number, velocity: number) => {
        return Math.abs(offset) * velocity;
    };

    const paginate = (newDirection: number) => {
        setDirection(newDirection);
        setCurrentIndex((prevIndex) => {
            let nextIndex = prevIndex + newDirection;
            if (nextIndex < 0) nextIndex = featuredItems.length - 1;
            if (nextIndex >= featuredItems.length) nextIndex = 0;
            return nextIndex;
        });
    };

    const currentItem = featuredItems[currentIndex];

    return (
        <section className="relative max-h-screen min-h-screen overflow-hidden flex items-center justify-center">
            <div className="relative mx-auto flex w-full max-w-7xl flex-col justify-center h-full items-center px-4 py-12 sm:px-8 lg:px-12 lg:py-16">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-20 items-center">
                    {/* Left Side - Animated Text Content */}
                    <motion.div
                        initial={{ opacity: 0, x: -30 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true, margin: "-100px" }}
                        transition={{ duration: 0.6 }}
                        className="flex flex-col gap-8 lg:gap-12"
                        ref={containerRef}
                    >


                        {/* Big Main Content with VariableProximity */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.6, delay: 0.2 }}
                            className="relative max-w-auto mx-auto lg:max-w-none md:text-left text-center text-muted-foreground"
                        >
                            <span className="px-1 " style={{ fontFamily: "'Pacifico', cursive" }}>try-on outfit</span> using your avatar <br />
                            discover styles from <span className="px-1 " style={{ fontFamily: "'Pacifico', cursive" }}>your circle</span> <br />
                            <span className="px-1 " style={{ fontFamily: "'Pacifico', cursive" }}>ask Atlyr agent</span> to search, style, refine <br />
                            find your <span className="px-1 " style={{ fontFamily: "'Pacifico', cursive" }}>personal style</span> with us
                        </motion.div>
                    </motion.div>

                    {/* Right Side - Swipeable Card */}
                    <motion.div
                        initial={{ opacity: 0, x: 30 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true, margin: "-100px" }}
                        transition={{ duration: 0.6, delay: 0.2 }}
                        className="flex justify-center lg:justify-end"
                    >
                        <div className="relative w-full max-w-lg">
                            {/* Navigation Arrows */}
                            <button
                                onClick={() => paginate(-1)}
                                className="absolute left-[-14px] top-1/2 -translate-y-1/2 z-20 bg-primary text-white rounded-full p-[6px] shadow transition-all"
                                aria-label="Previous card"
                            >
                                <ChevronLeft className="w-6 h-6" />
                            </button>
                            <button
                                onClick={() => paginate(1)}
                                className="absolute right-[-14px] top-1/2 -translate-y-1/2 z-20 bg-primary text-white rounded-full p-[6px] shadow transition-all"
                                aria-label="Next card"
                            >
                                <ChevronRight className="w-6 h-6" />
                            </button>

                            {/* Swipeable Card Container (simple carousel, full-height video, auto width) */}
                            <div className="relative overflow-hidden w-full h-[500px] rounded-2xl ">
                                {featuredItems.map((item, index) => (
                                    <motion.div
                                        key={index}
                                        animate={{
                                            x: (index - currentIndex) * 100 + '%',
                                            opacity: index === currentIndex ? 1 : 0,
                                            scale: index === currentIndex ? 1 : 0.9,
                                        }}
                                        transition={{
                                            x: { type: "spring", stiffness: 500, damping: 40 },
                                            opacity: { duration: 0.1 },
                                            scale: { duration: 0.1 }
                                        }}
                                        drag="x"
                                        dragConstraints={{ left: 0, right: 0 }}
                                        dragElastic={0.05}
                                        onDragEnd={(e, { offset, velocity }) => {
                                            const swipe = swipePower(offset.x, velocity.x);

                                            if (swipe < -swipeConfidenceThreshold) {
                                                paginate(1);
                                            } else if (swipe > swipeConfidenceThreshold) {
                                                paginate(-1);
                                            }
                                        }}
                                        className="absolute inset-0 w-full h-full flex items-center justify-center"
                                        style={{ pointerEvents: index === currentIndex ? 'auto' : 'none' }}
                                    >
                                        <div className="relative flex h-full w-full items-center justify-center bg-background p-4">
                                            <video
                                                key={item.video}
                                                className="max-h-full max-w-auto aspect-[3/5.4] h-auto w-auto object-cover rounded-2xl shadow-lg bg-black/70"
                                                autoPlay
                                                loop={true}
                                                muted
                                                playsInline
                                                onEnded={() => paginate(1)}
                                                style={{
                                                    background: "#fff",
                                                }}
                                            >
                                                <source src={item.video} type="video/mp4" />
                                                {item.alt}
                                            </video>
                                            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-foreground/80 px-3 py-1 text-xs font-semibold text-background backdrop-blur-md shadow"
                                            >
                                                curated by Atlyr
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>

                            {/* Dots Indicator */}
                            <div className="flex justify-center gap-2 mt-4">
                                {featuredItems.map((_, index) => (
                                    <button
                                        key={index}
                                        onClick={() => {
                                            setDirection(index > currentIndex ? 1 : -1);
                                            setCurrentIndex(index);
                                        }}
                                        className={`w-2 h-2 rounded-full transition-all ${
                                            index === currentIndex
                                                ? "bg-primary w-8"
                                                : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                                        }`}
                                        aria-label={`Go to card ${index + 1}`}
                                    />
                                ))}
                            </div>

                            {/* Disclaimer */}
                            <motion.div
                                initial={{ opacity: 0 }}
                                whileInView={{ opacity: 1 }}
                                viewport={{ once: true }}
                                transition={{ duration: 0.5, delay: 0.6 }}
                                className="mt-4 text-center"
                            >
                                <p className="text-xs text-muted-foreground/60">
                                Any resemblance to real persons is incidental and does not imply endorsement, partnership, or authorization.
                                </p>
                            </motion.div>
                        </div>
                    </motion.div>
                </div>
                {/* <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, delay: 0.4 }}
                    className="mt-4 lg:mt-8 -mx-6 overflow-hidden"
                >
                    <ScrollVelocity
                        texts={["Curated Collections", "Handpicked pieces that define your unique style and elevate your wardrobe"]}
                        velocity={50}
                        className="text-foreground"
                        damping={50}
                        stiffness={400}
                        numCopies={4}
                        parallaxClassName=""
                        scrollerClassName="text-foreground"
                        scrollerStyle={{
                            fontSize: "clamp(2.5rem, 4vw, 5rem)",
                            fontWeight: 700,
                            color: foregroundColor,
                        }}
                    />
                </motion.div> */}
            </div>

        </section>
    );
}

