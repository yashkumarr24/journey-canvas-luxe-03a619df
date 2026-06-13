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
      className="group relative overflow-hidden rounded-3xl border border-foreground/10 bg-card"
    >
      <Link to="/destinations/$slug" params={{ slug: p.slug }} className="block">
        <div className="relative aspect-[4/5] w-full overflow-hidden">
          <img
            src={p.img}
            alt={p.name}
            loading="lazy"
            width={1280}
            height={1600}
            className="size-full object-cover transition-transform duration-[1400ms] ease-out group-hover:scale-110"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/60 to-ink/10" />
          <div className="absolute left-5 top-5 rounded-full border border-white/20 bg-black/45 px-3 py-1 text-[10px] uppercase tracking-[0.25em] text-white backdrop-blur-md">
            {p.country}
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 p-6 md:p-7">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h3 className="font-display text-3xl leading-tight text-white md:text-4xl">{p.name}</h3>
              <p className="mt-1 text-sm text-white/70">{p.tagline}</p>
            </div>
            <div className="text-right">
              <div className="font-display text-xl text-gold md:text-2xl">{p.price}</div>
              <div className="text-[10px] uppercase tracking-widest text-white/60">per person</div>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between border-t border-white/15 pt-4 text-xs text-white/70">
            <span>{p.nights} · {p.from}</span>
            <span className="inline-flex items-center gap-1 text-white transition-colors group-hover:text-gold">
              View Itinerary <span className="transition-transform group-hover:translate-x-1">→</span>
            </span>
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
