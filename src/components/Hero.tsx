import { motion } from "framer-motion";
import { HomeSearch } from "@/components/HomeSearch";
import type { listInternationalCatalogue } from "@/lib/packages/packages.functions";
import logo from "@/assets/flynfeel-logo.webp";

export function Hero({ catalogue }: { catalogue: Awaited<ReturnType<typeof listInternationalCatalogue>> }) {
  return (
    <section id="top" className="relative overflow-hidden border-b border-foreground/10 bg-background">
      {/* very subtle dot texture */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:radial-gradient(color-mix(in_oklab,var(--foreground)_10%,transparent)_1px,transparent_1px)] [background-size:22px_22px]"
      />

      {/* faded logo pills (reference placeholders) */}
      <div aria-hidden="true" className="pointer-events-none absolute right-3 top-20 hidden lg:block lg:right-[max(1.5rem,calc(50vw-40rem))]">
        <motion.div
          animate={{ y: [0, -14, 0] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
          className="hero-logo-pill grid h-60 w-40 place-items-center overflow-hidden rounded-full bg-muted"
        >
          <img src={logo} alt="" className="w-20 opacity-80 sm:w-28 lg:w-32" />
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

        <motion.div initial={{ y: 22, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.7, delay: 0.15 }} className="relative z-10 mt-8 lg:mt-12">
          <HomeSearch catalogue={catalogue} />
        </motion.div>
      </div>
    </section>
  );
}
