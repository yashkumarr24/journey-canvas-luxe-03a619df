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
      <div aria-hidden="true" className="pointer-events-none absolute right-[-6rem] top-24 flex gap-4 opacity-60 sm:right-4 sm:top-28 lg:right-[max(1.5rem,calc(50vw-40rem))]">
        <motion.div
          animate={{ y: [0, -14, 0] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
          className="grid h-44 w-24 place-items-center rounded-full bg-muted sm:h-56 sm:w-28 lg:h-64 lg:w-36"
        >
          <img src={logo} alt="" className="w-16 opacity-25 grayscale sm:w-20 lg:w-24" />
        </motion.div>
        <motion.div
          animate={{ y: [0, 14, 0] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
          className="mt-10 grid h-52 w-28 place-items-center rounded-full bg-muted sm:h-64 sm:w-32 lg:h-80 lg:w-48"
        >
          <motion.img
            src={logo}
            alt=""
            animate={{ rotate: [0, 4, -4, 0] }}
            transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
            className="w-20 opacity-30 sm:w-24 lg:w-32"
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
