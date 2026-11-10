import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import goa from "@/assets/goa.webp";
import kashmir from "@/assets/kashmir.webp";
import dubai from "@/assets/dubai.webp";
import maldives from "@/assets/maldives.webp";
import kerala from "@/assets/kerala.webp";

/**
 * "Discover your new favourite stay" — compact stay-style tiles that lead into
 * the existing hotel search. Images reuse the site's licensed library.
 */

const styles = [
  { label: "Beach resorts", img: goa, alt: "Beach resort shoreline in Goa" },
  { label: "Mountain stays", img: kashmir, alt: "Mountain valley stay in Kashmir" },
  { label: "City hotels", img: dubai, alt: "City skyline hotels in Dubai" },
  { label: "Island escapes", img: maldives, alt: "Overwater villa in the Maldives" },
  { label: "Wellness & spa", img: kerala, alt: "Wellness retreat in Kerala" },
];

export function StayStyles() {
  return (
    <section aria-labelledby="stay-styles-heading" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 md:py-16">
      <p className="text-xs uppercase tracking-[0.25em] text-gold">Stays</p>
      <h2 id="stay-styles-heading" className="mt-2 font-display text-3xl leading-tight sm:text-4xl">
        Discover your new favourite stay
      </h2>

      <div className="-mx-4 mt-6 overflow-x-auto px-4 pb-2 sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0">
        <ul className="flex gap-4 sm:grid sm:grid-cols-3 lg:grid-cols-5">
          {styles.map((style, i) => (
            <li key={style.label} className="w-40 shrink-0 sm:w-auto">
              <motion.div
                initial={{ y: 24, opacity: 0 }}
                whileInView={{ y: 0, opacity: 1 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.6, delay: i * 0.06 }}
              >
                <Link
                  to="/hotels"
                  className="group block overflow-hidden rounded-xl border border-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2"
                >
                  <div className="relative aspect-[4/3] overflow-hidden">
                    <img
                      src={style.img}
                      alt={style.alt}
                      loading="lazy"
                      className="size-full object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-primary/80 to-transparent px-3 pb-2.5 pt-8 text-sm font-medium text-primary-foreground">
                      {style.label}
                    </span>
                  </div>
                </Link>
              </motion.div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
