import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { SectionTitle } from "./Section";
import type { Destination } from "@/data/destinations";

export function DestinationCard({ p, index }: { p: Destination; index: number }) {
  return (
    <motion.article
      initial={{ y: 60, opacity: 0 }}
      whileInView={{ y: 0, opacity: 1 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.9, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      className="group relative overflow-hidden rounded-2xl border border-white/10 bg-ink shadow-[0_20px_60px_-25px_rgba(0,0,0,0.6)] transition-transform duration-500 hover:-translate-y-1 hover:shadow-[0_30px_80px_-25px_rgba(0,0,0,0.8)]"
    >
      <Link to="/destinations/$slug" params={{ slug: p.slug }} className="block">
        <div className="relative aspect-[3/4] w-full overflow-hidden">
          <img
            src={p.img}
            alt={p.name}
            loading="lazy"
            width={1280}
            height={1700}
            className="size-full object-cover transition-transform duration-[1600ms] ease-out group-hover:scale-110"
          />

          {/* Dark gradient overlays for legibility */}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/10" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-transparent" />

          {/* Rating pill — top right */}
          <div className="absolute right-4 top-4 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md ring-1 ring-white/15">
            5★
          </div>

          {/* Content — overlaid bottom */}
          <div className="absolute inset-x-0 bottom-0 p-6 md:p-7">
            <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-gold">
              {p.country}
            </div>
            <h3 className="mt-2 font-display text-3xl leading-[1.05] text-white md:text-4xl">
              {p.name}
            </h3>
            <p className="mt-2 line-clamp-2 text-sm text-white/70">{p.tagline}</p>

            <div className="mt-5 flex items-end justify-between gap-4 border-t border-white/15 pt-4">
              <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-white transition-colors group-hover:text-gold">
                Discover Stays
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </div>
              <div className="text-right">
                <div className="font-display text-lg leading-none text-gold md:text-xl">{p.price}</div>
                <div className="mt-1 text-[9px] uppercase tracking-[0.22em] text-white/55">
                  {p.nights}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Link>
    </motion.article>
  );
}


export function Destinations({
  items,
  eyebrow,
  title,
  subtitle,
  id,
}: {
  items: Destination[];
  eyebrow: string;
  title: React.ReactNode;
  subtitle?: string;
  id?: string;
}) {
  return (
    <section id={id} className="relative mx-auto max-w-7xl px-6 py-24 md:py-36">
      <SectionTitle eyebrow={eyebrow} title={title} subtitle={subtitle} />
      <div className="mt-14 grid gap-7 md:grid-cols-2 lg:grid-cols-3">
        {items.map((p, i) => (
          <DestinationCard key={p.slug} p={p} index={i} />
        ))}
      </div>
    </section>
  );
}
