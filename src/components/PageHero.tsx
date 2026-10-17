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
      className="page-hero relative w-full overflow-hidden"
      style={{ minHeight: `max(520px, ${height})` }}
    >
      <motion.div style={{ y, scale }} className="absolute inset-0">
        <img src={image} alt="" width={1920} height={1080} decoding="async" fetchPriority="high" className="size-full object-cover" />
        <div className="absolute inset-0 bg-foreground/35" />
      </motion.div>
      <motion.div
        style={{ opacity }}
        className="relative z-10 mx-auto flex min-h-[inherit] min-w-0 max-w-7xl flex-col justify-end px-6 pb-16 pt-28 md:pb-20"
      >
        {eyebrow && (
          <div className={`mb-5 flex min-w-0 items-center gap-3 text-xs uppercase tracking-[0.3em] ${lightText ? "text-primary-foreground" : "text-gold"}`}>
            <span className={`block h-px w-10 shrink-0 ${lightText ? "bg-primary-foreground" : "bg-gold"}`} /> <span className="min-w-0 [overflow-wrap:anywhere]">{eyebrow}</span>
          </div>
        )}
        <motion.h1
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          className="min-w-0 text-balance font-display text-4xl leading-[1.05] text-primary-foreground [overflow-wrap:anywhere] [text-shadow:var(--shadow-hero-text)] sm:text-6xl lg:text-7xl xl:text-[5.5rem]"
        >
          {title}
        </motion.h1>
        {subtitle && (
          <motion.p
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 1, delay: 0.15 }}
            className={`mt-6 max-w-2xl text-pretty text-base md:text-lg ${lightText ? "text-primary-foreground/90" : "text-muted-foreground"}`}
          >
            {subtitle}
          </motion.p>
        )}
      </motion.div>
    </section>
  );
}
