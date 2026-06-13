import { motion, useScroll, useSpring, useTransform, useReducedMotion } from "framer-motion";
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

// Spring config tuned for buttery smooth high-refresh scrolling.
const SPRING = { stiffness: 220, damping: 38, mass: 0.25, restDelta: 0.001 };
const TIGHT_SPRING = { stiffness: 400, damping: 50, mass: 0.2, restDelta: 0.001 };

function SplitHeading({ lines }: { lines: React.ReactNode[] }) {
  return (
    <h1 className="font-display font-normal leading-[1.02] tracking-[-0.03em] text-[clamp(2.25rem,6.5vw,6rem)] [text-shadow:0_2px_24px_rgba(17,17,17,0.18),0_1px_2px_rgba(17,17,17,0.25)]">
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
  const prefersReduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });

  // Smoothed progress for 120fps-feel motion
  const smooth = useSpring(scrollYProgress, SPRING);
  // Tighter spring for the foreground — must track the scrubber 1:1 with no lag.
  const tight = useSpring(scrollYProgress, TIGHT_SPRING);
  // Parallax is a core part of the hero, so it runs regardless of the
  // OS reduced-motion setting. We only disable the looping dust below.
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
      className="relative h-[220svh] w-full"
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
          className="absolute inset-x-0 bottom-0 h-[55%] will-change-transform [transform:translateZ(0)] [backface-visibility:hidden] sm:h-[52%]"
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
          className="absolute inset-x-0 bottom-0 h-[50%] will-change-transform [transform:translateZ(0)] [backface-visibility:hidden] sm:h-[48%]"
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
          className="absolute inset-x-0 bottom-0 h-[44%] will-change-transform sm:h-[42%]"
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


        {/* Floating dust particles (reduced count, hidden on small screens for perf) */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden overflow-hidden sm:block">
          {[...Array(8)].map((_, i) => (
            <motion.span
              key={i}
              className="absolute block rounded-full bg-white/60 will-change-transform"
              style={{
                width: 2 + (i % 3),
                height: 2 + (i % 3),
                left: `${(i * 137) % 100}%`,
                top: `${(i * 53) % 100}%`,
              }}
              animate={{
                y: [0, -28, 0],
                opacity: [0.2, 0.7, 0.2],
              }}
              transition={{
                duration: 9 + (i % 5),
                repeat: Infinity,
                ease: "easeInOut",
                delay: i * 0.5,
              }}
            />
          ))}
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
          className="relative z-10 flex h-full w-full items-start justify-center px-5 pt-44 sm:px-6 sm:pt-48 md:pt-52 lg:pt-56 xl:pt-44 will-change-transform"
        >
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="mx-auto w-full max-w-5xl text-center"
          >
            <motion.div
              variants={fadeUp}
              className="mx-auto mb-5 flex items-center justify-center gap-3 text-[10px] uppercase tracking-[0.3em] text-gold sm:text-xs sm:mb-6"
            >
              <span className="block h-px w-8 bg-gold sm:w-10" />
              Crafting Journeys Since 2012
              <span className="block h-px w-8 bg-gold sm:w-10" />
            </motion.div>

            <SplitHeading
              lines={[
                "Where the world",
                <>becomes <span key="u" className="italic gold-gradient">unforgettable.</span></>,
              ]}
            />

            <motion.p
              variants={fadeUp}
              className="mx-auto mt-6 max-w-xl text-pretty text-sm leading-relaxed text-foreground/85 font-medium [text-shadow:0_1px_12px_rgba(255,255,255,0.6)] sm:mt-8 sm:text-base md:text-lg"
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
                className="inline-flex items-center gap-3 rounded-full border border-foreground/25 bg-background/40 px-6 py-3.5 text-sm font-medium text-foreground backdrop-blur-md transition-colors hover:bg-background/70 sm:px-7 sm:py-4"
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
                  <div className="font-display text-2xl text-gold sm:text-3xl md:text-4xl">{s.n}</div>
                  <div className="mt-1.5 text-[9px] uppercase tracking-[0.2em] text-foreground/70 sm:mt-2 sm:text-xs sm:tracking-[0.25em]">
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
