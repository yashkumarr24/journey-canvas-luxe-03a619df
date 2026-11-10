import { motion } from "framer-motion";
import { HomeSearch } from "@/components/HomeSearch";
import type { listInternationalCatalogue } from "@/lib/packages/packages.functions";
import heroBackground from "@/assets/hero-background.webp";
import heroBackgroundMobile from "@/assets/hero-background-mobile.webp";

export function Hero({ catalogue }: { catalogue: Awaited<ReturnType<typeof listInternationalCatalogue>> }) {
  return (
    <section id="top" className="relative isolate overflow-hidden bg-primary">
      <picture aria-hidden="true">
        <source media="(max-width: 767px)" srcSet={heroBackgroundMobile} />
        <img
          src={heroBackground}
          alt=""
          fetchPriority="high"
          className="absolute inset-0 -z-20 size-full object-cover object-[60%_40%] md:object-[center_35%]"
        />
      </picture>
      <div aria-hidden="true" className="hero-scrim absolute inset-0 -z-10" />

      <div className="relative mx-auto flex max-w-7xl flex-col px-4 pb-10 pt-24 sm:px-6 sm:pt-28 lg:min-h-[78svh] lg:justify-center lg:pb-14 lg:pt-24">
        <motion.h1
          initial={{ y: 22, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.7 }}
          className="font-editorial text-hero-ink max-w-2xl text-balance text-5xl leading-[0.95] [text-shadow:var(--shadow-hero-text)] sm:text-6xl lg:text-7xl"
        >
          Discover the world, <span className="italic">your way</span> with us.
        </motion.h1>

        <motion.div initial={{ y: 22, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.7, delay: 0.15 }} className="relative z-10 mt-6 lg:mt-8">
          <HomeSearch catalogue={catalogue} />
        </motion.div>
      </div>
    </section>
  );
}
