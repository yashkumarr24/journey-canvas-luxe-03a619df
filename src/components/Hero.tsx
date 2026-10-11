import { motion } from "framer-motion";
import { HomeSearch } from "@/components/HomeSearch";
import logo from "@/assets/flynfeel-logo.webp";

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden border-b border-foreground/10 bg-background">
      {/* very subtle dot texture */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:radial-gradient(color-mix(in_oklab,var(--foreground)_10%,transparent)_1px,transparent_1px)] [background-size:22px_22px]"
      />

      {/* single brand logo with gentle motion */}
      <div aria-hidden="true" className="pointer-events-none absolute right-[-5rem] top-20 sm:right-0 sm:top-24 lg:right-[max(1.5rem,calc(50vw-40rem))]">
        <motion.div
          animate={{ y: [0, -16, 0] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
          className="grid h-64 w-64 place-items-center rounded-full bg-card shadow-[var(--shadow-luxe)] ring-1 ring-foreground/5 sm:h-80 sm:w-80 lg:h-[26rem] lg:w-[26rem]"
        >
          <motion.img
            src={logo}
            alt=""
            animate={{ rotate: [0, 3, -3, 0], scale: [1, 1.03, 1] }}
            transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
            className="w-48 opacity-40 sm:w-60 sm:opacity-80 lg:w-80 lg:opacity-90"
          />
        </motion.div>
      </div>

      <div className="relative mx-auto max-w-7xl px-4 pb-14 pt-28 sm:px-6 sm:pt-36 lg:pb-20">
        <motion.h1
          initial={{ y: 22, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.7 }}
          className="font-editorial relative max-w-xl text-balance text-5xl leading-[0.95] text-foreground sm:text-6xl lg:text-7xl"
        >
          Discover the world, <span className="italic">your way</span> with us.
        </motion.h1>

        <motion.div initial={{ y: 22, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.7, delay: 0.15 }} className="relative z-10 mt-10 lg:mt-16">
          <HomeSearch />
        </motion.div>
      </div>
    </section>
  );
}
