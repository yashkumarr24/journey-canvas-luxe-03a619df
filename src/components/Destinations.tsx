import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { SectionTitle } from "./Section";
import type { Destination } from "@/data/destinations";

export type CardData = Pick<Destination, "slug" | "name" | "country" | "tagline" | "price" | "nights" | "img">;

export type CardLink =
  | { to: "/destinations/$slug"; params: { slug: string } }
  | { to: "/packages/$destination"; params: { destination: string } }
  | { to: "/packages/$destination/$package"; params: { destination: string; package: string } }
  | { to: "/domestic-packages/$destination"; params: { destination: string } }
  | { to: "/international-packages/$destination"; params: { destination: string } }
  | { to: "/international-packages/$destination/$package"; params: { destination: string; package: string } }
  | { to: "/domestic-packages/$destination/$package"; params: { destination: string; package: string } };

export function DestinationCard({
  p,
  index,
  link,
  badge = "5★",
  cta = "Discover Stays",
  priceNote,
}: {
  p: CardData;
  index: number;
  link?: CardLink;
  badge?: string | null;
  cta?: string;
  priceNote?: string;
}) {
  const target: CardLink = link ?? { to: "/destinations/$slug", params: { slug: p.slug } };
  return (
    <motion.article
      initial={{ y: 60, opacity: 0 }}
      whileInView={{ y: 0, opacity: 1 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.9, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      className="group relative overflow-hidden rounded-sm border border-foreground/10 bg-card shadow-[var(--shadow-card)] transition-all duration-500 hover:-translate-y-1 hover:border-gold/40 hover:shadow-[var(--shadow-luxe)]"
    >
      <Link {...(target as any)} className="block">
        <div className="relative aspect-[4/3] w-full overflow-hidden">
          <img
            src={p.img}
            alt={p.name}
            loading="lazy"
            width={1280}
            height={960}
            className="size-full object-cover transition-transform duration-[1600ms] ease-out group-hover:scale-110"
          />
          {/* Rating pill — top right */}
          {badge && (
            <div className="absolute right-4 top-4 rounded-sm bg-card/85 px-2.5 py-1 text-[11px] font-medium text-foreground backdrop-blur-md ring-1 ring-foreground/10">
              {badge}
            </div>
          )}
        </div>

        <div className="p-6 md:p-7">
          <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-gold">
            {p.country}
          </div>
          <h3 className="mt-2 font-display text-2xl leading-[1.1] text-foreground md:text-3xl">
            {p.name}
          </h3>
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{p.tagline}</p>

          <div className="mt-5 flex items-end justify-between gap-4 border-t border-foreground/10 pt-4">
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-foreground transition-colors group-hover:text-gold">
              {cta}
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </div>
            <div className="text-right">
              {priceNote && (
                <div className="mb-1 text-[9px] uppercase tracking-[0.22em] text-muted-foreground">{priceNote}</div>
              )}
              <div className="font-display text-lg leading-none text-gold md:text-xl">{p.price}</div>
              <div className="mt-1 text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
                {p.nights}
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
    <section id={id} className="relative mx-auto max-w-7xl border-t border-foreground/10 px-6 py-24 md:py-32">
      <SectionTitle eyebrow={eyebrow} title={title} subtitle={subtitle} />
      <div className="mt-14 grid gap-7 md:grid-cols-2 lg:grid-cols-3">
        {items.map((p, i) => (
          <DestinationCard key={p.slug} p={p} index={i} />
        ))}
      </div>
    </section>
  );
}
