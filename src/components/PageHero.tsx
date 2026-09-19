import { motion, useScroll, useTransform } from "framer-motion";
import { useRef, type ReactNode } from "react";

export function PageHero({
  image,
  eyebrow,
  title,
  subtitle,
  height = "70svh",
  lightText = false,
}: {
  image: string;
  eyebrow?: string;
  title: ReactNode;
  subtitle?: string;
  height?: string;
  lightText?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["0%", "25%"]);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.1]);
  const opacity = useTransform(scrollYProgress, [0, 0.9], [1, 0.2]);

  return (
    <section
      ref={ref}
      className="relative w-full overflow-hidden"
      style={{ height, minHeight: 520 }}
    >
      <motion.div style={{ y, scale }} className="absolute inset-0">
        <img src={image} alt="" className="size-full object-cover" />
        <div className="absolute inset-0 bg-foreground/35" />
      </motion.div>
      <motion.div
        style={{ opacity }}
        className="relative z-10 mx-auto flex h-full max-w-7xl flex-col justify-end px-6 pb-16 md:pb-20"
      >
        {eyebrow && (
          <div className={`mb-5 flex items-center gap-3 text-xs uppercase tracking-[0.3em] ${lightText ? "text-white" : "text-gold"}`}>
            <span className={`block h-px w-10 ${lightText ? "bg-white" : "bg-gold"}`} /> {eyebrow}
          </div>
        )}
        <motion.h1
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          className="text-balance font-display text-[clamp(2.5rem,6vw,5.5rem)] leading-[0.95] text-white [text-shadow:0_2px_18px_rgba(0,0,0,0.55)]"
        >
          {title}
        </motion.h1>
        {subtitle && (
          <motion.p
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 1, delay: 0.15 }}
            className={`mt-6 max-w-2xl text-pretty text-base md:text-lg ${lightText ? "text-white/90" : "text-muted-foreground"}`}
          >
            {subtitle}
          </motion.p>
        )}
      </motion.div>
    </section>
  );
}
