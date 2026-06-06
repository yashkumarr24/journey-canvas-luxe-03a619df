import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import hero from "@/assets/hero.jpg";

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.5 } },
};
const rise = {
  hidden: { y: 40, opacity: 0 },
  show: { y: 0, opacity: 1, transition: { duration: 1, ease: [0.22, 1, 0.36, 1] as const } },
};

export function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["0%", "30%"]);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.15]);
  const opacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  return (
    <section id="top" ref={ref} className="relative h-[100svh] min-h-[680px] w-full overflow-hidden">
      <motion.div style={{ y, scale }} className="absolute inset-0">
        <img
          src={hero}
          alt="Cinematic mountain village at sunrise"
          className="size-full object-cover"
          width={1920}
          height={1280}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-ink/40 via-ink/30 to-ink" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,oklch(0.08_0.02_260/0.6)_100%)]" />
      </motion.div>

      <motion.div
        style={{ opacity }}
        variants={stagger}
        initial="hidden"
        animate="show"
        className="relative z-10 mx-auto flex h-full max-w-7xl flex-col justify-end px-6 pb-24 md:pb-32"
      >
        <motion.div variants={rise} className="mb-6 flex items-center gap-3 text-xs uppercase tracking-[0.3em] text-gold">
          <span className="block h-px w-10 bg-gold" />
          Crafting Journeys Since 2012
        </motion.div>

        <motion.h1
          variants={rise}
          className="text-balance font-display text-[clamp(2.75rem,7vw,6.5rem)] leading-[0.95] tracking-tight"
        >
          Where the world<br />
          becomes <span className="italic gold-gradient">unforgettable.</span>
        </motion.h1>

        <motion.p variants={rise} className="mt-8 max-w-xl text-pretty text-base text-muted-foreground md:text-lg">
          Bespoke voyages curated by trusted experts. Sun-soaked coastlines, snow-laced
          summits, and quiet luxuries — designed entirely around you.
        </motion.p>

        <motion.div variants={rise} className="mt-10 flex flex-wrap items-center gap-4">
          <a
            href="#destinations"
            className="group inline-flex items-center gap-3 rounded-full bg-gold px-7 py-4 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.03]"
          >
            Explore International
            <span className="transition-transform group-hover:translate-x-1">→</span>
          </a>
          <a
            href="#destinations"
            className="inline-flex items-center gap-3 rounded-full border border-white/20 px-7 py-4 text-sm font-medium text-foreground/90 backdrop-blur-md transition-colors hover:bg-white/5"
          >
            Discover Domestic
          </a>
        </motion.div>

        <motion.div variants={rise} className="mt-16 grid max-w-3xl grid-cols-3 gap-8 border-t border-white/10 pt-8">
          {[
            { k: "12+", v: "Years curating" },
            { k: "60+", v: "Destinations" },
            { k: "98%", v: "Repeat travellers" },
          ].map((s) => (
            <div key={s.v}>
              <div className="font-display text-3xl text-gold md:text-4xl">{s.k}</div>
              <div className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">{s.v}</div>
            </div>
          ))}
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.6, duration: 1 }}
        className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 text-xs uppercase tracking-[0.3em] text-muted-foreground"
      >
        <span className="float-slow inline-block">Scroll</span>
      </motion.div>
    </section>
  );
}
