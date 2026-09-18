import { Fragment } from "react";
import { motion } from "framer-motion";

const featuredItem = {
    video: "/sumakesh_video.mp4",
    alt: "Model showcasing sumakesh collection",
};

// Each line renders as `prefix + italic accent + suffix`; edit the strings, not the JSX below.
const showcaseCopyLines: { prefix?: string; accent: string; suffix?: string }[] = [
    { prefix: "try on ", accent: "any outfit", suffix: " on your likeness" },
    { prefix: "shop the look ", accent: "from any inspiration" },
];

export function ShowcaseSection() {
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
                    >
                        {/* Big Main Content with VariableProximity */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.6, delay: 0.2 }}
                            className="relative max-w-auto mx-auto text-lg sm:text-xl lg:text-2xl lg:max-w-none md:text-left text-center text-muted-foreground"
                        >
                            {showcaseCopyLines.map((line, index) => (
                                <Fragment key={line.accent}>
                                    {line.prefix}
                                    <span className="px-1 font-display italic text-violet">{line.accent}</span>
                                    {line.suffix}
                                    {index < showcaseCopyLines.length - 1 && <br />}
                                </Fragment>
                            ))}
                        </motion.div>
                    </motion.div>

                    {/* Right Side - Video Card */}
                    <motion.div
                        initial={{ opacity: 0, x: 30 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true, margin: "-100px" }}
                        transition={{ duration: 0.6, delay: 0.2 }}
                        className="flex justify-center lg:justify-end"
                    >
                        <div className="relative w-full max-w-[min(100%,calc(70dvh*9/16))]">
                            <div className="relative overflow-hidden w-full h-[min(70dvh,720px)] rounded-2xl ">
                                <div className="relative flex h-full w-full items-center justify-center bg-background p-4">
                                    <video
                                        className="max-h-full max-w-auto aspect-[3/5.4] h-auto w-auto object-cover rounded-2xl shadow-lg bg-black/70"
                                        autoPlay
                                        loop
                                        muted
                                        playsInline
                                        style={{
                                            background: "#fff",
                                        }}
                                    >
                                        <source src={featuredItem.video} type="video/mp4" />
                                        {featuredItem.alt}
                                    </video>
                                </div>
                            </div>
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
