import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { useRef } from "react";
import sky from "@/assets/parallax-sky.jpg";
import mountainsFar from "@/assets/parallax-mountains-far.png";
import mountainsMid from "@/assets/parallax-mountains-mid.png";
import mountainsNear from "@/assets/parallax-mountains-near.png";

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.14, delayChildren: 0.6 } },
};
const wordVariants = {
  hidden: { y: "110%", opacity: 0, filter: "blur(12px)" },
  show: {
    y: "0%",
    opacity: 1,
    filter: "blur(0px)",
    transition: { duration: 1.1, ease: [0.22, 1, 0.36, 1] as const },
  },
};
const fadeUp = {
  hidden: { y: 28, opacity: 0, filter: "blur(8px)" },
  show: {
    y: 0,
    opacity: 1,
    filter: "blur(0px)",
    transition: { duration: 1, ease: [0.22, 1, 0.36, 1] as const },
  },
};

function SplitHeading({ lines }: { lines: string[] }) {
  return (
    <h1 className="font-display leading-[0.95] tracking-[-0.02em] text-[clamp(2.5rem,8vw+1vh,9rem)]">
      {lines.map((line, li) => (
        <span key={li} className="block overflow-hidden">
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

  // Parallax depth — sky slowest, foreground fastest. Disabled if reduced motion.
  const m = prefersReduced ? 0 : 1;
  const skyY = useTransform(scrollYProgress, [0, 1], ["0%", `${8 * m}%`]);
  const skyScale = useTransform(scrollYProgress, [0, 1], [1.05, 1.12]);
  const farY = useTransform(scrollYProgress, [0, 1], ["0%", `${18 * m}%`]);
  const midY = useTransform(scrollYProgress, [0, 1], ["0%", `${32 * m}%`]);
  const nearY = useTransform(scrollYProgress, [0, 1], ["0%", `${55 * m}%`]);
  const nearScale = useTransform(scrollYProgress, [0, 1], [1, 1.18]);

  // Fog rises and thickens
  const fogY = useTransform(scrollYProgress, [0, 1], ["20%", `${-25 * m}%`]);
  const fogOpacity = useTransform(scrollYProgress, [0, 0.6, 1], [0.35, 0.7, 1]);

  // Content fades and lifts as camera "moves through"
  const contentY = useTransform(scrollYProgress, [0, 1], ["0%", `${-30 * m}%`]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.55, 0.85], [1, 0.6, 0]);
  const contentBlur = useTransform(scrollYProgress, [0, 0.6, 1], ["0px", "4px", "12px"]);

  // Vignette deepens
  const vignette = useTransform(scrollYProgress, [0, 1], [0.45, 0.85]);

  return (
    <section
      id="top"
      ref={ref}
      className="relative h-[160svh] w-full"
      aria-label="Cinematic mountain hero"
    >
      {/* Sticky viewport — virtual camera */}
      <div className="sticky top-0 h-[100svh] w-full overflow-hidden bg-[oklch(0.97_0.005_85)]">
        {/* Sky */}
        <motion.div
          style={{ y: skyY, scale: skyScale }}
          className="absolute inset-0 will-change-transform"
        >
          <img
            src={sky}
            alt=""
            aria-hidden="true"
            className="size-full object-cover"
            width={1920}
            height={1280}
            fetchPriority="high"
          />
        </motion.div>

        {/* Distant mountains */}
        <motion.div
          style={{ y: farY }}
          className="absolute inset-x-0 bottom-0 h-[52%] will-change-transform"
        >
          <img
            src={mountainsFar}
            alt=""
            aria-hidden="true"
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

        {/* Mid mountains — warm golden hour peaks */}
        <motion.div
          style={{ y: midY }}
          className="absolute inset-x-0 bottom-0 h-[48%] will-change-transform"
        >
          <img
            src={mountainsMid}
            alt=""
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 w-full object-cover object-bottom"
          />
          {/* Warm haze blending the base of mid mountains into the foreground */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%]"
            style={{
              background:
                "linear-gradient(to top, oklch(0.55 0.08 55 / 0.85) 0%, oklch(0.65 0.09 60 / 0.45) 35%, transparent 80%)",
            }}
          />
        </motion.div>

        {/* Near foreground — warm dark ridge with pines */}
        <motion.div
          style={{ y: nearY, scale: nearScale }}
          className="absolute inset-x-0 bottom-0 h-[42%] will-change-transform"
        >
          <img
            src={mountainsNear}
            alt=""
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 w-full object-cover object-bottom"
            style={{ filter: "brightness(0.95) saturate(1.05)" }}
          />
          {/* Soft warm glow on top edge to tie into mid layer light */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[30%]"
            style={{
              background:
                "linear-gradient(to bottom, oklch(0.75 0.12 65 / 0.25), transparent)",
              mixBlendMode: "screen",
            }}
          />
        </motion.div>

        {/* Volumetric fog — CSS based */}
        <motion.div
          aria-hidden="true"
          style={{ y: fogY, opacity: fogOpacity }}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[70%] will-change-transform"
        >
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to top, oklch(0.98 0.005 85 / 0.95) 0%, oklch(0.96 0.01 80 / 0.6) 40%, transparent 100%)",
              filter: "blur(2px)",
            }}
          />
        </motion.div>

        {/* Floating dust particles */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          {[...Array(14)].map((_, i) => (
            <motion.span
              key={i}
              className="absolute block rounded-full bg-white/60"
              style={{
                width: 2 + (i % 3),
                height: 2 + (i % 3),
                left: `${(i * 137) % 100}%`,
                top: `${(i * 53) % 100}%`,
                filter: "blur(1px)",
              }}
              animate={{
                y: [0, -30, 0],
                opacity: [0.2, 0.7, 0.2],
              }}
              transition={{
                duration: 8 + (i % 5),
                repeat: Infinity,
                ease: "easeInOut",
                delay: i * 0.4,
              }}
            />
          ))}
        </div>

        {/* Vignette */}
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background: useTransform(
              vignette,
              (v) => `radial-gradient(ellipse at center, transparent 35%, oklch(0.15 0.01 80 / ${v}) 110%)`,
            ),
          }}
        />

        {/* Content */}
        <motion.div
          style={{ y: contentY, opacity: contentOpacity, filter: useTransform(contentBlur, (b) => `blur(${b})`) }}
          className="relative z-10 flex h-full w-full items-center justify-center px-6 will-change-transform"
        >
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="mx-auto w-full max-w-6xl text-center"
          >
            <motion.div
              variants={fadeUp}
              className="mb-6 flex items-center gap-3 text-[10px] uppercase tracking-[0.3em] text-gold sm:text-xs"
            >
              <span className="block h-px w-10 bg-gold" />
              Crafting Journeys Since 2012
            </motion.div>

            <div className="text-left">
              <SplitHeading lines={["Where the world", <>becomes <span key="u" className="italic gold-gradient">unforgettable.</span></>] as unknown as string[]} />
            </div>

            <motion.p
              variants={fadeUp}
              className="mt-8 max-w-xl text-pretty text-left text-sm leading-relaxed text-foreground/75 sm:text-base md:text-lg"
            >
              Bespoke voyages curated by trusted experts. Sun‑soaked coastlines,
              snow‑draped summits and quiet luxury — designed entirely around you.
            </motion.p>

            <motion.div
              variants={fadeUp}
              className="mt-10 flex flex-wrap items-center gap-3 sm:gap-4"
            >
              <a
                href="/international"
                className="group inline-flex items-center gap-3 rounded-full bg-gold px-7 py-4 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.03]"
              >
                Explore International
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </a>
              <a
                href="/domestic"
                className="inline-flex items-center gap-3 rounded-full border border-foreground/25 bg-background/40 px-7 py-4 text-sm font-medium text-foreground backdrop-blur-md transition-colors hover:bg-background/70"
              >
                Discover Domestic
              </a>
            </motion.div>

            <motion.div
              variants={fadeUp}
              className="mt-14 grid max-w-2xl grid-cols-3 gap-6 border-t border-foreground/15 pt-8 text-left"
            >
              {[
                { n: "12+", l: "Years Curating" },
                { n: "60+", l: "Destinations" },
                { n: "98%", l: "Repeat Travellers" },
              ].map((s) => (
                <div key={s.l}>
                  <div className="font-display text-3xl text-gold sm:text-4xl">{s.n}</div>
                  <div className="mt-2 text-[10px] uppercase tracking-[0.25em] text-foreground/70 sm:text-xs">
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
          className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 text-[10px] uppercase tracking-[0.4em] text-foreground/60"
        >
          <motion.span
            animate={{ y: [0, 6, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            className="inline-block"
          >
            Scroll to explore
          </motion.span>
        </motion.div>
      </div>
    </section>
  );
}
