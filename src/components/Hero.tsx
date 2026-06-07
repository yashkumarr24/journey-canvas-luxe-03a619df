import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { useRef } from "react";
import mountain from "@/assets/hero-mountain.jpg";

export function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  // Pinned scroll: track progress across the tall outer section
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });

  // Mountain layer — slow parallax + gentle zoom
  const imgScale = useTransform(scrollYProgress, [0, 1], [1.05, 1.35]);
  const imgY = useTransform(scrollYProgress, [0, 1], ["0%", "18%"]);
  const imgOpacity = useTransform(scrollYProgress, [0, 0.75, 1], [1, 0.85, 0.4]);

  // Pearl wash that fades in to hand off to next section
  const washOpacity = useTransform(scrollYProgress, [0.4, 1], [0, 1]);

  // Text — collapses: words drift apart, then everything scales down + fades
  const leftX = useTransform(scrollYProgress, [0, 0.55], ["0vw", "-22vw"]);
  const rightX = useTransform(scrollYProgress, [0, 0.55], ["0vw", "22vw"]);
  const textScale = useTransform(scrollYProgress, [0.3, 0.85], [1, 0.6]);
  const textOpacity = useTransform(scrollYProgress, [0.45, 0.9], [1, 0]);
  const textY = useTransform(scrollYProgress, [0, 0.9], ["0px", "-80px"]);
  const tracking = useTransform(scrollYProgress, [0, 0.6], ["-0.02em", "0.04em"]);

  // Sub copy / CTAs fade earlier
  const subOpacity = useTransform(scrollYProgress, [0, 0.25], [1, 0]);
  const subY = useTransform(scrollYProgress, [0, 0.35], ["0px", "-40px"]);

  // Stats slide up softly
  const statsOpacity = useTransform(scrollYProgress, [0, 0.3], [1, 0]);
  const statsY = useTransform(scrollYProgress, [0, 0.4], ["0px", "-60px"]);

  // Scroll cue
  const cueOpacity = useTransform(scrollYProgress, [0, 0.15], [1, 0]);

  return (
    <section
      id="top"
      ref={ref}
      className="relative w-full"
      style={{ height: reduce ? "100svh" : "220svh" }}
    >
      <div className="sticky top-0 h-[100svh] w-full overflow-hidden">
        {/* Mountain image layer */}
        <motion.div
          style={reduce ? undefined : { scale: imgScale, y: imgY, opacity: imgOpacity }}
          className="absolute inset-0 will-change-transform"
        >
          <img
            src={mountain}
            alt="Snow-capped mountain range at golden hour"
            className="size-full object-cover"
            width={1920}
            height={1280}
          />
          {/* Soft top/bottom vignette for legibility on pearl theme */}
          <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-transparent to-background" />
        </motion.div>

        {/* Pearl wash hand-off */}
        <motion.div
          style={reduce ? undefined : { opacity: washOpacity }}
          className="pointer-events-none absolute inset-0 bg-background"
        />

        {/* Foreground content */}
        <div className="relative z-10 mx-auto flex h-full w-full max-w-7xl flex-col justify-end px-6 pb-12 sm:pb-16 md:pb-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.4 }}
            style={reduce ? undefined : { opacity: subOpacity, y: subY }}
            className="mb-4 flex items-center gap-3 text-[10px] uppercase tracking-[0.3em] text-foreground/70 sm:mb-6 sm:text-xs"
          >
            <span className="block h-px w-8 bg-foreground/60 sm:w-10" />
            Crafting Journeys Since 2012
          </motion.div>

          <motion.h1
            style={
              reduce
                ? undefined
                : { scale: textScale, opacity: textOpacity, y: textY, letterSpacing: tracking }
            }
            className="flex flex-wrap items-baseline gap-x-[0.25em] gap-y-2 font-display leading-[1.02] text-[clamp(2.25rem,7vw+1vh,7rem)] will-change-transform"
          >
            <motion.span
              style={reduce ? undefined : { x: leftX }}
              className="inline-block text-foreground"
            >
              Where the world
            </motion.span>
            <motion.span
              style={reduce ? undefined : { x: rightX }}
              className="inline-block italic text-foreground/80"
            >
              becomes unforgettable.
            </motion.span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.7 }}
            style={reduce ? undefined : { opacity: subOpacity, y: subY }}
            className="mt-5 max-w-xl text-pretty text-sm text-foreground/75 sm:mt-7 md:text-base lg:text-lg"
          >
            Bespoke voyages curated by trusted experts. Sun-soaked coastlines, snow-laced
            summits, and quiet luxuries — designed entirely around you.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.9 }}
            style={reduce ? undefined : { opacity: subOpacity, y: subY }}
            className="mt-6 flex flex-wrap items-center gap-3 sm:mt-8 sm:gap-4"
          >
            <a
              href="#destinations"
              className="group inline-flex items-center gap-3 rounded-full bg-foreground px-6 py-3.5 text-sm font-medium text-background transition-transform hover:scale-[1.03] sm:px-7 sm:py-4"
            >
              Explore International
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </a>
            <a
              href="#destinations"
              className="inline-flex items-center gap-3 rounded-full border border-foreground/25 bg-background/60 px-6 py-3.5 text-sm font-medium text-foreground backdrop-blur-md transition-colors hover:bg-foreground/5 sm:px-7 sm:py-4"
            >
              Discover Domestic
            </a>
          </motion.div>

          <motion.div
            style={reduce ? undefined : { opacity: statsOpacity, y: statsY }}
            className="mt-8 grid max-w-3xl grid-cols-3 gap-4 border-t border-foreground/15 pt-5 sm:mt-12 sm:gap-8 sm:pt-6"
          >
            {[
              { k: "12+", v: "Years curating" },
              { k: "60+", v: "Destinations" },
              { k: "98%", v: "Repeat travellers" },
            ].map((s) => (
              <div key={s.v}>
                <div className="font-display text-2xl text-foreground sm:text-3xl md:text-4xl">
                  {s.k}
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground sm:text-xs">
                  {s.v}
                </div>
              </div>
            ))}
          </motion.div>
        </div>

        {/* Scroll cue */}
        <motion.div
          style={reduce ? undefined : { opacity: cueOpacity }}
          className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 text-[10px] uppercase tracking-[0.3em] text-foreground/60 sm:text-xs"
        >
          <span className="float-slow inline-block">Scroll</span>
        </motion.div>
      </div>
    </section>
  );
}
