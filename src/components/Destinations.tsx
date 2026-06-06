import { motion } from "framer-motion";
import { SectionTitle } from "./Section";
import kashmir from "@/assets/kashmir.jpg";
import goa from "@/assets/goa.jpg";
import kerala from "@/assets/kerala.jpg";
import vietnam from "@/assets/vietnam.jpg";
import baku from "@/assets/baku.jpg";
import dubai from "@/assets/dubai.jpg";

type Pkg = {
  name: string; region: string; nights: string; price: string; from: string; img: string; tagline: string;
};

const domestic: Pkg[] = [
  { name: "Kashmir", region: "India", nights: "6N · 7D", price: "₹ 35,999", from: "Ex. Srinagar", img: kashmir, tagline: "Shikara dawns on a mirror lake." },
  { name: "Thrilling Goa", region: "India", nights: "3N · 4D", price: "₹ 8,499", from: "Ex. Goa", img: goa, tagline: "Coastline sunsets, beach‑club nights." },
  { name: "Kerala", region: "India", nights: "6N · 7D", price: "₹ 19,999", from: "Ex. Kochi", img: kerala, tagline: "Houseboat hush in the backwaters." },
];

const international: Pkg[] = [
  { name: "Vietnam", region: "South‑East Asia", nights: "5N · 6D", price: "₹ 35,999", from: "Ex. Hanoi", img: vietnam, tagline: "Halong Bay in golden silence." },
  { name: "Baku, Azerbaijan", region: "Caucasus", nights: "5N · 6D", price: "₹ 24,999", from: "Ex. Baku", img: baku, tagline: "Old town walls, neon skyline." },
  { name: "Dubai", region: "United Arab Emirates", nights: "5N · 6D", price: "₹ 36,999", from: "Ex. Dubai", img: dubai, tagline: "Desert dunes meet sky‑high luxury." },
];

function Card({ p, index }: { p: Pkg; index: number }) {
  return (
    <motion.article
      initial={{ y: 60, opacity: 0 }}
      whileInView={{ y: 0, opacity: 1 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.9, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
      className="group relative overflow-hidden rounded-3xl border border-white/10 bg-card"
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden">
        <img
          src={p.img}
          alt={p.name}
          loading="lazy"
          width={1280}
          height={1600}
          className="size-full object-cover transition-transform duration-[1400ms] ease-out group-hover:scale-110"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-transparent" />
        <div className="absolute left-5 top-5 rounded-full border border-white/20 bg-black/30 px-3 py-1 text-[10px] uppercase tracking-[0.25em] text-foreground/90 backdrop-blur-md">
          {p.region}
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 p-6 md:p-7">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h3 className="font-display text-3xl leading-tight md:text-4xl">{p.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{p.tagline}</p>
          </div>
          <div className="text-right">
            <div className="font-display text-xl text-gold md:text-2xl">{p.price}</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">per person</div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4 text-xs text-muted-foreground">
          <span>{p.nights} · {p.from}</span>
          <a href="#contact" className="inline-flex items-center gap-1 text-foreground transition-colors hover:text-gold">
            View Itinerary <span className="transition-transform group-hover:translate-x-1">→</span>
          </a>
        </div>
      </div>
    </motion.article>
  );
}

export function Destinations() {
  return (
    <section id="destinations" className="relative mx-auto max-w-7xl px-6 py-28 md:py-40">
      <SectionTitle
        eyebrow="Signature Voyages"
        title={<>Hand‑picked escapes <span className="italic gold-gradient">across India</span></>}
        subtitle="From the Himalayas to the Arabian Sea — each itinerary is crafted with private guides, considered hotels, and seamless transfers."
      />

      <div className="mt-16 grid gap-7 md:grid-cols-3">
        {domestic.map((p, i) => <Card key={p.name} p={p} index={i} />)}
      </div>

      <div className="mt-32">
        <SectionTitle
          eyebrow="Far‑Reaching Horizons"
          title={<>The world, <span className="italic gold-gradient">tailored to you.</span></>}
          subtitle="Tell us how you like to travel — solo, with someone, or a private group. We compose itineraries with negotiated rates you won't find online."
        />

        <div className="mt-16 grid gap-7 md:grid-cols-3">
          {international.map((p, i) => <Card key={p.name} p={p} index={i} />)}
        </div>
      </div>
    </section>
  );
}
