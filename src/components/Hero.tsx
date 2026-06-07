import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { useRef } from "react";
import mountainBack from "@/assets/hero-mountain.jpg";
import mountainFront from "@/assets/mountain-front.png";

export function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });

  // BACK layer (sky + distant mountains) — slow parallax + slight zoom
  const backScale = useTransform(scrollYProgress, [0, 1], [1.05, 1.2]);
  const backY = useTransform(scrollYProgress, [0, 1], ["0%", "12%"]);

  // FRONT layer (mountain silhouette) — rises up dramatically to swallow the text
  const frontY = useTransform(scrollYProgress, [0, 1], ["8%", "-32%"]);
  const frontScale = useTransform(scrollYProgress, [0, 1], [1, 1.18]);

  // Headline — sits BETWEEN the layers. Drifts up so it slides behind the rising mountain.
  const titleY = useTransform(scrollYProgress, [0, 1], ["0px", "-180px"]);
  const titleScale = useTransform(scrollYProgress, [0, 0.8], [1, 0.88]);
  const leftX = useTransform(scrollYProgress, [0, 0.6], ["0vw", "-10vw"]);
  const rightX = useTransform(scrollYProgress, [0, 0.6], ["0vw", "10vw"]);
  const titleOpacity = useTransform(scrollYProgress, [0.85, 1], [1, 0.4]);

  // Eyebrow — IN FRONT of everything, fades early
  const eyebrowOpacity = useTransform(scrollYProgress, [0, 0.25], [1, 0]);
  const eyebrowY = useTransform(scrollYProgress, [0, 0.4], ["0px", "-40px"]);

  // Sub-copy + CTAs — IN FRONT, sit lower on screen so the mountain rises past them last
  const ctaY = useTransform(scrollYProgress, [0, 1], ["0px", "-260px"]);
  const ctaOpacity = useTransform(scrollYProgress, [0.55, 0.9], [1, 0]);

  // Stats — IN FRONT, fade with CTAs
  const statsOpacity = useTransform(scrollYProgress, [0.45, 0.8], [1, 0]);
  const statsY = useTransform(scrollYProgress, [0, 1], ["0px", "-200px"]);

  // Pearl hand-off at the very end
  const washOpacity = useTransform(scrollYProgress, [0.85, 1], [0, 1]);

  // Scroll cue
  const cueOpacity = useTransform(scrollYProgress, [0, 0.15], [1, 0]);

  return (
    <section
      id="top"
      ref={ref}
      className="relative w-full"
      style={{ height: reduce ? "100svh" : "260svh" }}
    >
      <div className="sticky top-0 h-[100svh] w-full overflow-hidden bg-background">
        {/* z-0: BACK — sky + distant mountains */}
        <motion.div
          style={reduce ? undefined : { scale: backScale, y: backY }}
          className="absolute inset-0 z-0 will-change-transform"
        >
          <img
            src={mountainBack}
            alt="Snow-capped mountain range at golden hour"
            className="size-full object-cover"
            width={1920}
            height={1280}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/20 via-transparent to-background/40" />
        </motion.div>

        {/* z-10: HEADLINE — sits between back and front so it passes behind the rising mountain */}
        <div className="pointer-events-none absolute inset-0 z-10 mx-auto flex max-w-7xl items-center justify-center px-6">
          <motion.h1
            style={
              reduce
                ? undefined
                : { y: titleY, scale: titleScale, opacity: titleOpacity }
            }
            className="text-center font-display leading-[0.95] text-[clamp(3rem,11vw+1vh,11rem)] will-change-transform"
          >
            <motion.span
              style={reduce ? undefined : { x: leftX }}
              className="block text-foreground"
            >
              Where the world
            </motion.span>
            <motion.span
              style={reduce ? undefined : { x: rightX }}
              className="block italic text-foreground/90"
            >
              becomes unforgettable.
            </motion.span>
          </motion.h1>
        </div>

        {/* z-20: FRONT mountain — rises up to overlap the text */}
        <motion.div
          style={
            reduce
              ? { y: "0%" }
              : { y: frontY, scale: frontScale }
          }
          className="absolute inset-x-0 bottom-0 z-20 h-[85%] origin-bottom will-change-transform"
        >
          <img
            src={mountainFront}
            alt=""
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-full w-full object-cover object-bottom"
            width={1920}
            height={1080}
          />
          {/* Soft fade from mountain into background so the bottom blends */}
          <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-b from-transparent to-background" />
        </motion.div>

        {/* z-30: FOREGROUND content — eyebrow, CTAs, stats sit ON TOP of the mountain */}
        <div className="relative z-30 mx-auto flex h-full w-full max-w-7xl flex-col px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.4 }}
            style={reduce ? undefined : { opacity: eyebrowOpacity, y: eyebrowY }}
            className="mt-28 flex items-center gap-3 text-[10px] uppercase tracking-[0.3em] text-foreground/80 sm:mt-32 sm:text-xs"
          >
            <span className="block h-px w-8 bg-foreground/60 sm:w-10" />
            Crafting Journeys Since 2012
          </motion.div>

          <div className="mt-auto pb-12 sm:pb-16 md:pb-20">
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 0.7 }}
              style={reduce ? undefined : { opacity: ctaOpacity, y: ctaY }}
              className="max-w-xl text-pretty text-sm text-background/90 drop-shadow-[0_1px_8px_rgba(0,0,0,0.4)] sm:text-base lg:text-lg"
            >
              Bespoke voyages curated by trusted experts. Sun-soaked coastlines,
              snow-laced summits, and quiet luxuries — designed entirely around you.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 0.9 }}
              style={reduce ? undefined : { opacity: ctaOpacity, y: ctaY }}
              className="mt-6 flex flex-wrap items-center gap-3 sm:mt-8 sm:gap-4"
            >
              <a
                href="#destinations"
                className="group inline-flex items-center gap-3 rounded-full bg-background px-6 py-3.5 text-sm font-medium text-foreground transition-transform hover:scale-[1.03] sm:px-7 sm:py-4"
              >
                Explore International
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </a>
              <a
                href="#destinations"
                className="inline-flex items-center gap-3 rounded-full border border-background/50 bg-background/10 px-6 py-3.5 text-sm font-medium text-background backdrop-blur-md transition-colors hover:bg-background/20 sm:px-7 sm:py-4"
              >
                Discover Domestic
              </a>
            </motion.div>

            <motion.div
              style={reduce ? undefined : { opacity: statsOpacity, y: statsY }}
              className="mt-8 grid max-w-3xl grid-cols-3 gap-4 border-t border-background/30 pt-5 sm:mt-12 sm:gap-8 sm:pt-6"
            >
              {[
                { k: "12+", v: "Years curating" },
                { k: "60+", v: "Destinations" },
                { k: "98%", v: "Repeat travellers" },
              ].map((s) => (
                <div key={s.v}>
                  <div className="font-display text-2xl text-background sm:text-3xl md:text-4xl">
                    {s.k}
                  </div>
                  <div className="mt-1 text-[10px] uppercase tracking-widest text-background/70 sm:text-xs">
                    {s.v}
                  </div>
                </div>
              ))}
            </motion.div>
          </div>
        </div>

        {/* z-40: Pearl wash for clean handoff */}
        <motion.div
          style={reduce ? undefined : { opacity: washOpacity }}
          className="pointer-events-none absolute inset-0 z-40 bg-background"
        />

        {/* Scroll cue */}
        <motion.div
          style={reduce ? undefined : { opacity: cueOpacity }}
          className="absolute bottom-6 left-1/2 z-50 -translate-x-1/2 text-[10px] uppercase tracking-[0.3em] text-background/80 sm:text-xs"
        >
          <span className="float-slow inline-block">Scroll</span>
        </motion.div>
      </div>
    </section>
  );
}
