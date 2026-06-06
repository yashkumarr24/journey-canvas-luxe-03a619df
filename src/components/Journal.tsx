import { motion } from "framer-motion";
import { SectionTitle } from "./Section";
import kerala from "@/assets/kerala.jpg";
import vietnam from "@/assets/vietnam.jpg";
import swiss from "@/assets/swiss.jpg";

const posts = [
  { t: "When to visit Kashmir for the perfect snow", img: kerala, cat: "Field notes", read: "6 min" },
  { t: "Halong Bay at dawn — a slow‑travel guide", img: vietnam, cat: "Itineraries", read: "9 min" },
  { t: "The case for shoulder season in the Alps", img: swiss, cat: "Editorials", read: "5 min" },
];

export function Journal() {
  return (
    <section id="journal" className="mx-auto max-w-7xl px-6 py-28 md:py-40">
      <div className="flex flex-wrap items-end justify-between gap-8">
        <SectionTitle
          eyebrow="The Journal"
          title={<>Stories from <span className="italic gold-gradient">the road.</span></>}
        />
        <a href="#" className="text-sm text-muted-foreground transition-colors hover:text-gold">View all entries →</a>
      </div>

      <div className="mt-14 grid gap-7 md:grid-cols-3">
        {posts.map((p, i) => (
          <motion.a
            key={p.t}
            href="#"
            initial={{ y: 50, opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.9, delay: i * 0.1 }}
            className="group block"
          >
            <div className="aspect-[4/3] overflow-hidden rounded-2xl border border-white/10">
              <img src={p.img} alt={p.t} loading="lazy" width={1280} height={960} className="size-full object-cover transition-transform duration-[1400ms] ease-out group-hover:scale-110" />
            </div>
            <div className="mt-5 flex items-center justify-between text-xs uppercase tracking-[0.25em] text-muted-foreground">
              <span className="text-gold">{p.cat}</span>
              <span>{p.read}</span>
            </div>
            <h3 className="mt-3 font-display text-2xl leading-snug transition-colors group-hover:text-gold">{p.t}</h3>
          </motion.a>
        ))}
      </div>
    </section>
  );
}
