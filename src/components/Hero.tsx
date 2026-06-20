import { motion, useScroll, useSpring, useTransform } from "framer-motion";
import { useRef } from "react";
import sky from "@/assets/parallax-sky.jpg";
import mountainsFar from "@/assets/parallax-mountains-far.png";
import mountainsMid from "@/assets/parallax-mountains-mid.png";
import mountainsNear from "@/assets/parallax-mountains-near.png";

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.5 } },
};
const wordVariants = {
  hidden: { y: "110%", opacity: 0 },
  show: {
    y: "0%",
    opacity: 1,
    transition: { duration: 1, ease: [0.22, 1, 0.36, 1] as const },
  },
};
const fadeUp = {
  hidden: { y: 24, opacity: 0 },
  show: {
    y: 0,
    opacity: 1,
    transition: { duration: 0.9, ease: [0.22, 1, 0.36, 1] as const },
  },
};

// Snappier spring configs for faster response and less scroll lag.
const SPRING = { stiffness: 350, damping: 35, mass: 0.12, restDelta: 0.001 };
const TIGHT_SPRING = { stiffness: 500, damping: 42, mass: 0.1, restDelta: 0.001 };

function SplitHeading({ lines }: { lines: React.ReactNode[] }) {
  return (
    <h1 className="font-display font-normal leading-[1.02] tracking-[-0.03em] text-[clamp(2.25rem,6.5vw,6rem)] text-white">
      {lines.map((line, li) => (
        <span key={li} className="block overflow-hidden pb-[0.08em]">
          <motion.span variants={wordVariants} className="inline-block will-change-transform">
            {line}
          </motion.span>
        </span>
      ))}
    </h1>
  );
}

export function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });

  const smooth = useSpring(scrollYProgress, SPRING);
  const tight = useSpring(scrollYProgress, TIGHT_SPRING);
  const m = 1;

  // Parallax — rear iced peaks stay almost still; the front black ridge
  // physically slides DOWN off-screen (translateY), revealing the glacier.
  // Percentages here are relative to each layer's own height, so 120%
  // guarantees full exit on every viewport size.
  // All parallax must COMPLETE before the sticky viewport releases (~0.5
  // progress for a 220svh section over a 100svh sticky), otherwise the
  // half-translated foreground stays visible as the hero scrolls away.
  const skyY = useTransform(smooth, [0, 0.5], ["0%", `${2 * m}%`]);
  const skyScale = useTransform(smooth, [0, 0.5], [1.05, 1.08]);
  const farY = useTransform(smooth, [0, 0.5], ["0%", `${-4 * m}%`]);
  const farScale = useTransform(smooth, [0, 0.5], [1, 1.45]);
  const midY = useTransform(smooth, [0, 0.5], ["0%", `${-2 * m}%`]);
  const midScale = useTransform(smooth, [0, 0.5], [1, 1.12]);
  const nearY = useTransform(tight, [0, 0.5], ["0%", `${140 * m}%`]);


  // Fog rises
  // (Fog layer is now static — no scroll-linked transforms.)

  // Content — transform + opacity ONLY (no per-frame blur filter = much smoother)
  const contentY = useTransform(smooth, [0, 0.5], ["0%", `${-25 * m}%`]);
  const contentOpacity = useTransform(smooth, [0, 0.25, 0.45], [1, 0.5, 0]);

  return (
    <section
      id="top"
      ref={ref}
      className="relative h-[130svh] w-full"
      aria-label="Cinematic mountain hero"
    >
      {/* Sticky viewport — virtual camera */}
      <div className="sticky top-0 h-[100svh] w-full overflow-hidden bg-[oklch(0.14_0.01_260)] [transform:translateZ(0)] [backface-visibility:hidden]">
        {/* Sky */}
        <motion.div
          style={{ y: skyY, scale: skyScale }}
          className="absolute inset-0 will-change-transform [transform:translateZ(0)]"
        >
          <img
            src={sky}
            alt=""
            aria-hidden="true"
            className="size-full object-cover"
            width={1920}
            height={1280}
            fetchPriority="high"
            decoding="async"
          />
        </motion.div>

        {/* Distant mountains */}
        <motion.div
          style={{ y: farY, scale: farScale, transformOrigin: "50% 75%" }}
          className="absolute inset-x-0 bottom-0 h-[52svh] lg:-bottom-24 will-change-transform [transform:translateZ(0)] [backface-visibility:hidden]"
        >
          <img
            src={mountainsFar}
            alt=""
            aria-hidden="true"
            loading="eager"
            decoding="async"
            className="absolute inset-x-0 bottom-0 w-full object-cover object-bottom opacity-80"
            style={{ filter: "saturate(0.85) sepia(0.15)" }}
          />
        </motion.div>

        {/* Sun rays */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 mix-blend-screen opacity-60"
          style={{
            background:
              "radial-gradient(ellipse 60% 45% at 65% 28%, oklch(0.95 0.08 75 / 0.55), transparent 60%)",
          }}
        />

        {/* Mid mountains */}
        <motion.div
          style={{ y: midY, scale: midScale, transformOrigin: "50% 80%" }}
          className="absolute inset-x-0 bottom-0 h-[48svh] lg:-bottom-24 will-change-transform [transform:translateZ(0)] [backface-visibility:hidden]"
        >
          <img
            src={mountainsMid}
            alt=""
            aria-hidden="true"
            loading="eager"
            decoding="async"
            className="absolute inset-x-0 bottom-0 w-full object-cover object-bottom"
          />
        </motion.div>

        {/* Near foreground */}
        <motion.div
          style={{ y: nearY }}
          className="absolute inset-x-0 bottom-0 h-[42svh] lg:-bottom-24 will-change-transform"
        >
          <img
            src={mountainsNear}
            alt=""
            aria-hidden="true"
            loading="eager"
            decoding="async"
            className="absolute inset-x-0 bottom-0 w-full object-cover object-bottom"
            style={{ filter: "brightness(0.95) saturate(1.05)" }}
          />
        </motion.div>

        {/* Volumetric fog — dark, locked to the base of the scene */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[70%]"
        >
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to top, oklch(0.12 0.01 260 / 0.96) 0%, oklch(0.18 0.015 260 / 0.7) 45%, transparent 100%)",
            }}
          />
        </div>



        {/* Vignette — static, no per-frame recalc */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 38%, oklch(0.15 0.01 80 / 0.65) 110%)",
          }}
        />

        {/* Content */}
        <motion.div
          style={{ y: contentY, opacity: contentOpacity }}
          className="relative z-10 flex h-full w-full items-end justify-center px-5 pb-[clamp(4.5rem,11svh,8rem)] pt-24 sm:px-6 lg:items-center lg:pb-0 lg:pt-52 will-change-transform"
        >
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="mx-auto w-full max-w-5xl text-center"
          >
            <motion.div
              variants={fadeUp}
              className="mx-auto mb-5 flex items-center justify-center gap-3 text-[10px] uppercase tracking-[0.3em] text-white sm:text-xs sm:mb-6"
            >
              <span className="block h-px w-8 bg-white sm:w-10" />
              Crafting Journeys Since 2012
              <span className="block h-px w-8 bg-white sm:w-10" />
            </motion.div>

            <SplitHeading
              lines={[
                "Where the world",
                <>becomes <span key="u" className="italic gold-gradient">unforgettable.</span></>,
              ]}
            />

            <motion.p
              variants={fadeUp}
              className="mx-auto mt-6 max-w-xl text-pretty text-sm leading-relaxed text-white/95 font-medium sm:mt-8 sm:text-base md:text-lg"
            >
              Bespoke voyages curated by trusted experts. Sun‑soaked coastlines,
              snow‑draped summits and quiet luxury — designed entirely around you.
            </motion.p>

            <motion.div
              variants={fadeUp}
              className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:mt-10 sm:gap-4"
            >
              <a
                href="/international"
                className="group inline-flex items-center gap-2 rounded-full bg-gold px-6 py-3.5 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.03] sm:gap-3 sm:px-7 sm:py-4"
              >
                Explore International
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </a>
              <a
                href="/domestic"
                className="inline-flex items-center gap-3 rounded-full border border-white/30 bg-white/10 px-6 py-3.5 text-sm font-medium text-white backdrop-blur-md transition-colors hover:bg-white/20 sm:px-7 sm:py-4"
              >
                Discover Domestic
              </a>
            </motion.div>

            <motion.div
              variants={fadeUp}
              className="mx-auto mt-10 grid max-w-xl grid-cols-3 gap-4 border-t border-foreground/15 pt-6 text-center sm:mt-14 sm:gap-6 sm:pt-8"
            >
              {[
                { n: "12+", l: "Years Curating" },
                { n: "60+", l: "Destinations" },
                { n: "98%", l: "Repeat Travellers" },
              ].map((s) => (
                <div key={s.l}>
                  <div className="font-display text-2xl text-white sm:text-3xl md:text-4xl">{s.n}</div>
                  <div className="mt-1.5 text-[9px] uppercase tracking-[0.2em] text-white/80 sm:mt-2 sm:text-xs sm:tracking-[0.25em]">
                    {s.l}
                  </div>
                </div>
              ))}
            </motion.div>
          </motion.div>
        </motion.div>

        {/* Scroll cue */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2, duration: 1.2 }}
          style={{ opacity: contentOpacity }}
          className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 text-[10px] uppercase tracking-[0.4em] text-foreground/60 sm:bottom-8"
        >
          <motion.span
            animate={{ y: [0, 6, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            className="inline-block will-change-transform"
          >
            Scroll to explore
          </motion.span>
        </motion.div>
      </div>
    </section>
  );
}
