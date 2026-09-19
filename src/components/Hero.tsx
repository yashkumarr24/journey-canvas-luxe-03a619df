import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Bot } from "lucide-react";
import { HomeSearch } from "@/components/HomeSearch";
import kashmir from "@/assets/kashmir.jpg";
import maldives from "@/assets/maldives.jpg";
import vietnam from "@/assets/vietnam.jpg";

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden border-b border-foreground/10 bg-background px-5 pb-16 pt-32 sm:px-6 sm:pt-40 lg:pb-24 lg:pt-44">
      <div className="mx-auto max-w-7xl">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-16">
          <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.7 }} className="min-w-0">
            <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-gold"><span className="h-px w-10 bg-gold" />Travel designed around you</p>
            <h1 className="font-editorial mt-6 max-w-4xl text-balance text-5xl leading-[0.98] sm:text-6xl lg:text-7xl xl:text-8xl">
              Search the world. <span className="italic text-gold">Travel beautifully.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              Flights, considered stays and tailor-made holidays, brought together by a travel team you can reach.
            </p>
            <Link to="/assistant" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-foreground transition-colors hover:text-gold">
              <Bot className="size-4 text-gold" aria-hidden="true" /> Prefer to describe your trip? Ask AI <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </motion.div>

          <motion.div initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.8, delay: 0.1 }} className="hidden h-[430px] grid-cols-2 gap-2 lg:grid">
            <img src={kashmir} alt="Snow-covered Kashmir mountains" className="h-full w-full object-cover" />
            <div className="grid gap-2">
              <img src={maldives} alt="Maldives overwater retreat" className="h-full min-h-0 w-full object-cover" />
              <img src={vietnam} alt="Vietnam landscape" className="h-full min-h-0 w-full object-cover" />
            </div>
          </motion.div>
        </div>

        <motion.div initial={{ y: 22, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.7, delay: 0.18 }} className="relative z-10 mt-10 lg:-mt-16 lg:max-w-[calc(100%-220px)]">
          <HomeSearch />
        </motion.div>

        <div className="mt-8 grid grid-cols-3 border-y border-foreground/10 py-5 text-center">
          {[{ n: "Since 2012", l: "Travel expertise" }, { n: "60+", l: "Curated destinations" }, { n: "Human", l: "Support throughout" }].map((item) => (
            <div key={item.l} className="border-r border-foreground/10 px-2 last:border-r-0"><p className="font-editorial text-xl sm:text-2xl">{item.n}</p><p className="mt-1 text-[9px] uppercase tracking-[0.16em] text-muted-foreground sm:text-[10px]">{item.l}</p></div>
          ))}
        </div>
      </div>
    </section>
  );
}
