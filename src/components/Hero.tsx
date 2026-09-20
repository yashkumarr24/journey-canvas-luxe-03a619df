import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { ArrowRight, BadgeIndianRupee, Headphones, ShieldCheck, Users } from "lucide-react";
import { HomeSearch } from "@/components/HomeSearch";
import { destinations } from "@/data/destinations";
import heroImage from "@/assets/hero.jpg";

const trustPoints = [
  { icon: BadgeIndianRupee, title: "Best price", detail: "Guaranteed" },
  { icon: Headphones, title: "24/7 customer", detail: "Support" },
  { icon: ShieldCheck, title: "Safe & secure", detail: "Booking" },
  { icon: Users, title: "Trusted travel", detail: "Experts" },
];

const featured = destinations.slice(0, 5);

export function Hero() {
  return (
    <section id="top" className="relative border-b border-foreground/10">
      <div className="absolute inset-0">
        <img src={heroImage} alt="Turquoise coastline seen from a cliff road" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-foreground/55" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 pb-10 pt-28 sm:px-6 sm:pt-36 lg:pb-14">
        <motion.div initial={{ y: 22, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.7 }} className="max-w-3xl text-background">
          <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em]">
            <span className="h-px w-10 bg-gold" />
            Travel designed around you
          </p>
          <h1 className="font-editorial mt-5 text-balance text-5xl leading-[0.95] sm:text-6xl lg:text-7xl">
            Discover the world,
            <br />
            <span className="italic text-gold">your way.</span>
          </h1>
          <p className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-background/85 sm:text-lg">
            Flights, hotels and tailor-made holidays — all in one place, with trusted human support.
          </p>

          <ul className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            {trustPoints.map(({ icon: Icon, title, detail }) => (
              <li key={title} className="flex min-w-0 items-center gap-2.5">
                <Icon className="size-5 shrink-0 text-gold" aria-hidden="true" />
                <span className="min-w-0 text-[11px] font-medium uppercase leading-tight tracking-[0.1em] text-background/90">
                  {title}
                  <br />
                  {detail}
                </span>
              </li>
            ))}
          </ul>
        </motion.div>

        <motion.div initial={{ y: 22, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.7, delay: 0.15 }} className="relative z-10 mt-10 lg:mt-14">
          <HomeSearch />
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.7, delay: 0.25 }} className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {featured.map((item) => (
            <Link
              key={item.slug}
              to="/destinations/$slug"
              params={{ slug: item.slug }}
              className="group relative isolate min-h-24 overflow-hidden border border-background/25"
            >
              <img src={item.img} alt={item.name} className="absolute inset-0 -z-10 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
              <span className="absolute inset-0 -z-10 bg-foreground/45 transition-colors group-hover:bg-foreground/30" />
              <span className="flex h-full flex-col justify-end p-3 text-background">
                <span className="font-editorial text-lg leading-none">{item.name}</span>
                <span className="mt-1 text-[10px] uppercase tracking-[0.14em] text-background/85">{item.nights}</span>
              </span>
            </Link>
          ))}
          <Link
            to="/domestic"
            className="group flex min-h-24 flex-col justify-end border border-background/40 p-3 text-background transition-colors hover:bg-background/10"
          >
            <span className="font-editorial text-lg leading-none">Explore</span>
            <span className="mt-1 flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-background/85">
              All destinations <ArrowRight className="size-3 transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </span>
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
