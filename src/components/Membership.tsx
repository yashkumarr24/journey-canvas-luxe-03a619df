import { motion } from "framer-motion";
import { SectionTitle } from "./Section";

const tiers = [
  {
    name: "Voyager",
    price: "Complimentary",
    blurb: "For the curious traveller starting their story with us.",
    features: ["Members‑only fare alerts", "Priority itinerary drafts", "24/7 concierge chat", "Personalised wishlist"],
  },
  {
    name: "Sojourner",
    price: "₹ 19,000 / year",
    blurb: "Frequent escapes with elevated service and access.",
    featured: true,
    features: ["Everything in Voyager", "Negotiated hotel & flight rates", "Private airport transfers", "Free trip insurance up to ₹5L", "Dedicated travel designer"],
  },
  {
    name: "Continental",
    price: "On request",
    blurb: "For private groups and high‑touch global travel.",
    features: ["Everything in Sojourner", "Bespoke charter & jet planning", "On‑ground experience director", "Press‑level access at hotels", "White‑glove visa support"],
  },
];

export function Membership() {
  return (
    <section id="membership" className="relative overflow-hidden px-6 py-28 md:py-40">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,oklch(0.82_0.13_85/0.10),transparent_60%)]" />
      <div className="mx-auto max-w-7xl">
        <SectionTitle
          align="center"
          eyebrow="The Members Club"
          title={<>Three ways to travel <span className="italic gold-gradient">in our world.</span></>}
          subtitle="A modern membership built around access — to people, prices, and places that aren't on the open market."
        />

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          {tiers.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ y: 60, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.9, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
              className={`group relative flex flex-col rounded-3xl border p-8 transition-all ${
                t.featured
                  ? "border-gold/40 bg-gradient-to-b from-card to-card/40 shadow-[var(--shadow-luxe)]"
                  : "border-white/10 bg-card/60 hover:border-white/20"
              }`}
            >
              {t.featured && (
                <span className="absolute -top-3 left-8 rounded-full bg-gold px-3 py-1 text-[10px] uppercase tracking-[0.25em] text-primary-foreground">
                  Most chosen
                </span>
              )}
              <div className="mb-6 flex items-baseline justify-between">
                <h3 className="font-display text-3xl">{t.name}</h3>
              </div>
              <div className="mb-2 font-display text-4xl text-gold">{t.price}</div>
              <p className="mb-8 text-sm text-muted-foreground">{t.blurb}</p>

              <ul className="mb-10 space-y-3 text-sm">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-3 text-foreground/85">
                    <span className="mt-1 inline-block size-1.5 shrink-0 rounded-full bg-gold" />
                    {f}
                  </li>
                ))}
              </ul>

              <a
                href="#contact"
                className={`mt-auto inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-medium transition-transform hover:scale-[1.02] ${
                  t.featured
                    ? "bg-gold text-primary-foreground"
                    : "border border-white/15 text-foreground hover:bg-white/5"
                }`}
              >
                Begin Membership →
              </a>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
