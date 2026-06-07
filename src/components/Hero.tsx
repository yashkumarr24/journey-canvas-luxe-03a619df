import { motion, useScroll, useTransform, type MotionValue } from "framer-motion";
import { useRef } from "react";
import sky from "@/assets/hero-sky.jpg";
import mountainsFar from "@/assets/hero-mountains-far.png";
import mountainsMid from "@/assets/hero-mountains-mid.png";
import mountainsNear from "@/assets/hero-mountains-near.png";

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.14, delayChildren: 0.6 } },
};
const rise = {
  hidden: { y: 60, opacity: 0, filter: "blur(12px)" },
  show: {
    y: 0,
    opacity: 1,
    filter: "blur(0px)",
    transition: { duration: 1.4, ease: [0.22, 1, 0.36, 1] as const },
  },
};

function Layer({
  src,
  y,
  scale,
  opacity,
  zIndex,
  className,
  style,
}: {
  src: string;
  y: MotionValue<string> | MotionValue<number>;
  scale?: MotionValue<number>;
  opacity?: MotionValue<number>;
  zIndex: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <motion.img
      src={src}
      alt=""
      aria-hidden
      style={{
        y,
        scale,
        opacity,
        zIndex,
        willChange: "transform, opacity",
        ...style,
      }}
      className={`pointer-events-none absolute inset-x-0 bottom-0 w-full select-none ${className ?? ""}`}
      draggable={false}
    />
  );
}

export function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });

  // Parallax depths — deeper layers move slowest, foreground fastest.
  const skyY = useTransform(scrollYProgress, [0, 1], ["0%", "12%"]);
  const skyScale = useTransform(scrollYProgress, [0, 1], [1.05, 1.18]);

  const farY = useTransform(scrollYProgress, [0, 1], ["0%", "18%"]);
  const midY = useTransform(scrollYProgress, [0, 1], ["0%", "32%"]);
  const nearY = useTransform(scrollYProgress, [0, 1], ["0%", "55%"]);
  const nearScale = useTransform(scrollYProgress, [0, 1], [1, 1.08]);

  // Fog rises and thickens as we scroll — bridges into the next section.
  const fogY = useTransform(scrollYProgress, [0, 1], ["20%", "-20%"]);
  const fogOpacity = useTransform(scrollYProgress, [0, 0.5, 1], [0.35, 0.75, 1]);

  // Content fades + drifts up (camera moves forward into the scene).
  const contentY = useTransform(scrollYProgress, [0, 1], ["0%", "-30%"]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.55, 0.85], [1, 0.6, 0]);
  const contentBlur = useTransform(scrollYProgress, [0, 0.9], ["0px", "10px"]);

  return (
    <section
      id="top"
      ref={ref}
      className="relative flex h-[110svh] min-h-[680px] w-full items-end overflow-hidden bg-[#F5F5F0]"
    >
      {/* Sky — slowest, deepest layer */}
      <motion.div
        style={{ y: skyY, scale: skyScale, willChange: "transform" }}
        className="absolute inset-0 z-0"
      >
        <img
          src={sky}
          alt="Cinematic golden hour sky above the clouds"
          className="size-full object-cover"
          width={1920}
          height={1080}
        />
        {/* Pearl wash on top to keep brand tone */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#F8F8F6]/40 via-transparent to-[#F8F8F6]/30" />
        {/* Sun rays */}
        <div
          className="absolute inset-0 mix-blend-screen"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 55%, rgba(255,236,200,0.55), transparent 60%)",
          }}
        />
      </motion.div>

      {/* Distant mountains */}
      <Layer src={mountainsFar} y={farY} zIndex={10} style={{ opacity: 0.9 }} />

      {/* Mid mountains */}
      <Layer src={mountainsMid} y={midY} zIndex={20} style={{ opacity: 0.95 }} />

      {/* Volumetric fog band — between mid and near */}
      <motion.div
        style={{ y: fogY, opacity: fogOpacity, willChange: "transform, opacity" }}
        aria-hidden
        className="absolute inset-x-0 bottom-0 z-[25] h-[70%]"
      >
        <div
          className="size-full"
          style={{
            background:
              "linear-gradient(to top, rgba(248,248,246,0.95) 0%, rgba(248,248,246,0.55) 35%, rgba(248,248,246,0.15) 65%, transparent 100%)",
            filter: "blur(8px)",
          }}
        />
      </motion.div>

      {/* Foreground mountains — fastest */}
      <Layer src={mountainsNear} y={nearY} scale={nearScale} zIndex={30} />

      {/* Atmospheric dust particles */}
      <div
        aria-hidden
        className="absolute inset-0 z-[35] opacity-30 mix-blend-overlay"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.6) 1px, transparent 1.5px), radial-gradient(circle at 70% 60%, rgba(255,255,255,0.4) 1px, transparent 1.5px), radial-gradient(circle at 40% 80%, rgba(255,255,255,0.5) 1px, transparent 1.5px)",
          backgroundSize: "180px 180px, 240px 240px, 300px 300px",
        }}
      />

      {/* Bottom bleed — pearl bridge into next section */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[40] h-40 bg-gradient-to-b from-transparent to-background"
      />

      {/* CONTENT — sits above everything */}
      <motion.div
        style={{
          y: contentY,
          opacity: contentOpacity,
          filter: contentBlur,
          willChange: "transform, opacity, filter",
        }}
        variants={stagger}
        initial="hidden"
        animate="show"
        className="relative z-50 mx-auto w-full max-w-7xl px-6 pb-16 pt-28 sm:pb-20 sm:pt-32 md:pb-28"
      >
        <motion.div
          variants={rise}
          className="mb-5 flex items-center gap-3 text-[10px] uppercase tracking-[0.4em] text-foreground/70 sm:text-xs"
        >
          <span className="block h-px w-10 bg-foreground/60 sm:w-14" />
          Crafting Journeys Since 2012
        </motion.div>

        <motion.h1
          variants={rise}
          className="text-balance font-display leading-[0.95] tracking-[-0.02em] text-foreground text-[clamp(2.5rem,7vw,7rem)]"
        >
          Where the world<br />
          becomes <span className="italic text-foreground/80">unforgettable.</span>
        </motion.h1>

        <motion.p
          variants={rise}
          className="mt-6 max-w-xl text-pretty text-sm leading-relaxed text-foreground/70 sm:mt-8 md:text-base lg:text-lg"
        >
          Bespoke voyages curated by trusted experts. Sun-soaked coastlines,
          snow-laced summits, and quiet luxuries — designed entirely around you.
        </motion.p>

        <motion.div variants={rise} className="mt-8 flex flex-wrap items-center gap-3 sm:mt-10 sm:gap-4">
          <a
            href="#destinations"
            className="group inline-flex items-center gap-3 rounded-full bg-foreground px-7 py-4 text-sm font-medium text-background transition-all hover:scale-[1.03] hover:shadow-[0_20px_50px_-15px_rgba(17,17,17,0.4)]"
          >
            Explore International
            <span className="transition-transform group-hover:translate-x-1">→</span>
          </a>
          <a
            href="#destinations"
            className="inline-flex items-center gap-3 rounded-full border border-foreground/25 bg-background/40 px-7 py-4 text-sm font-medium text-foreground backdrop-blur-md transition-colors hover:bg-background/70"
          >
            Discover Domestic
          </a>
        </motion.div>

        <motion.div
          variants={rise}
          className="mt-10 grid max-w-3xl grid-cols-3 gap-6 border-t border-foreground/15 pt-6 sm:mt-14 sm:gap-10 sm:pt-8"
        >
          {[
            { k: "12+", v: "Years curating" },
            { k: "60+", v: "Destinations" },
            { k: "98%", v: "Repeat travellers" },
          ].map((s) => (
            <div key={s.v}>
              <div className="font-display text-3xl text-foreground sm:text-4xl md:text-5xl">
                {s.k}
              </div>
              <div className="mt-2 text-[10px] uppercase tracking-[0.3em] text-foreground/55 sm:text-xs">
                {s.v}
              </div>
            </div>
          ))}
        </motion.div>
      </motion.div>

      {/* Scroll cue */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.8, duration: 1.2 }}
        style={{ opacity: contentOpacity }}
        className="absolute bottom-8 left-1/2 z-50 -translate-x-1/2 text-[10px] uppercase tracking-[0.5em] text-foreground/60"
      >
        <span className="float-slow inline-block">Scroll</span>
      </motion.div>
    </section>
  );
}
