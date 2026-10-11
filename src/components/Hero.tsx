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

      {/* faded logo pills (reference placeholders) */}
      <div aria-hidden="true" className="pointer-events-none absolute right-[-6rem] top-24 flex gap-4 opacity-[0.78] sm:right-4 sm:top-28 lg:right-[max(1.5rem,calc(50vw-40rem))]">
        <motion.div
          animate={{ y: [0, -14, 0] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
          className="grid h-48 w-28 place-items-center rounded-full bg-muted sm:h-60 sm:w-32 lg:h-72 lg:w-40"
        >
          <img src={logo} alt="" className="w-[4.5rem] opacity-[0.33] grayscale sm:w-24 lg:w-28" />
        </motion.div>
        <motion.div
          animate={{ y: [0, 14, 0] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
          className="mt-10 grid h-56 w-32 place-items-center rounded-full bg-muted sm:h-72 sm:w-36 lg:h-[22rem] lg:w-52"
        >
          <motion.img
            src={logo}
            alt=""
            animate={{ rotate: [0, 4, -4, 0] }}
            transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
            className="w-24 opacity-[0.39] sm:w-28 lg:w-36"
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
