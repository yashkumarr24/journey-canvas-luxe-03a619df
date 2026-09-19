import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { SectionTitle } from "./Section";
import maldives from "@/assets/maldives.jpg";
import bhutan from "@/assets/bhutan.jpg";
import swiss from "@/assets/swiss.jpg";

const pillars = [
  { t: "Always available", d: "A real human on the line — from first idea to final touchdown. Wherever, whenever." },
  { t: "Affordable luxuries", d: "Negotiated rates with hotels, airlines and ground partners passed straight to you." },
  { t: "Designed around you", d: "Multiple drafts, considered detail, and the freedom to change your mind." },
];

export function Experiences() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y1 = useTransform(scrollYProgress, [0, 1], ["-10%", "15%"]);
  const y2 = useTransform(scrollYProgress, [0, 1], ["10%", "-15%"]);

  return (
    <section id="experiences" ref={ref} className="relative overflow-hidden px-6 py-28 md:py-40">
      <div className="mx-auto grid max-w-7xl gap-16 md:grid-cols-2 md:gap-24">
        <div>
          <SectionTitle
            eyebrow="Why Travel With Us"
            title={<>Trust, taste, and the <span className="italic gold-gradient">tiny details.</span></>}
            subtitle="Founded in 2012, we're a small studio of travel designers obsessed with the moments between the moments — the welcome drink, the right window seat, the quiet recommendation."
          />

          <div className="mt-12 space-y-8">
            {pillars.map((p, i) => (
              <motion.div
                key={p.t}
                initial={{ x: -30, opacity: 0 }}
                whileInView={{ x: 0, opacity: 1 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.8, delay: i * 0.1 }}
                className="flex gap-5 border-t border-foreground/10 pt-8"
              >
                <div className="font-display text-2xl text-gold">0{i + 1}</div>
                <div>
                  <h4 className="font-display text-2xl">{p.t}</h4>
                  <p className="mt-2 text-sm text-muted-foreground md:text-base">{p.d}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="relative h-[560px] md:h-[720px]">
          <motion.div style={{ y: y1 }} className="absolute right-0 top-0 h-[58%] w-[72%] overflow-hidden rounded-sm border border-foreground/10">
            <img src={maldives} alt="Maldives overwater villa" loading="lazy" width={1600} height={1200} className="size-full object-cover" />
          </motion.div>
          <motion.div style={{ y: y2 }} className="absolute bottom-0 left-0 h-[55%] w-[60%] overflow-hidden rounded-sm border border-foreground/10">
            <img src={bhutan} alt="Bhutan monastery" loading="lazy" width={1600} height={1200} className="size-full object-cover" />
          </motion.div>
          <motion.div style={{ y: y1 }} className="absolute bottom-[8%] right-[2%] h-[34%] w-[38%] overflow-hidden rounded-sm border border-gold/30 shadow-[var(--shadow-luxe)]">
            <img src={swiss} alt="Swiss alps" loading="lazy" width={1600} height={1200} className="size-full object-cover" />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
