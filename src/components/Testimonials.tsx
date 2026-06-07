import { motion } from "framer-motion";
import { SectionTitle } from "./Section";

const items = [
  { q: "Every detail was handled — the airport pickup, the upgrades, even the dinner reservations. It felt like having a friend in every city.", who: "Aanya R.", trip: "Maldives · Honeymoon" },
  { q: "We've travelled with three other agencies before. None of them came close to this level of care and pricing.", who: "Karan M.", trip: "Vietnam · Family of five" },
  { q: "I sent a one‑line brief and got back a beautifully thought‑out itinerary in under a day. They thought of things we didn't.", who: "Priya & Dev", trip: "Switzerland · Anniversary" },
  { q: "Best trip of our lives. The Kashmir houseboat at sunrise — I'll remember it forever.", who: "Rohit S.", trip: "Kashmir · 6 nights" },
];

export function Testimonials() {
  return (
    <section className="relative overflow-hidden px-6 py-28 md:py-40">
      <div className="mx-auto max-w-7xl">
        <SectionTitle
          align="center"
          eyebrow="Travellers' Voices"
          title={<>Loved by those who <span className="italic gold-gradient">return to us.</span></>}
        />
        <div className="mt-16 grid gap-6 md:grid-cols-2">
          {items.map((t, i) => (
            <motion.figure
              key={i}
              initial={{ y: 40, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.8, delay: i * 0.08 }}
              className="glass rounded-3xl p-8 md:p-10"
            >
              <div className="mb-5 text-gold">★★★★★</div>
              <blockquote className="font-display text-2xl leading-snug text-foreground/95 md:text-3xl">
                "{t.q}"
              </blockquote>
              <figcaption className="mt-8 flex items-center justify-between border-t border-foreground/10 pt-5 text-sm">
                <span className="text-foreground">{t.who}</span>
                <span className="text-muted-foreground">{t.trip}</span>
              </figcaption>
            </motion.figure>
          ))}
        </div>
      </div>
    </section>
  );
}
