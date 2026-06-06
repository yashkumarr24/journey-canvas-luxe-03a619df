import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const links = [
  { label: "Destinations", href: "#destinations" },
  { label: "Membership", href: "#membership" },
  { label: "Experiences", href: "#experiences" },
  { label: "Journal", href: "#journal" },
  { label: "Contact", href: "#contact" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.header
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.8, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4 md:pt-6"
    >
      <nav
        className={`flex w-full max-w-6xl items-center justify-between rounded-full border border-white/10 px-5 py-3 transition-all duration-500 md:px-7 ${
          scrolled ? "glass shadow-[var(--shadow-soft)]" : "bg-transparent"
        }`}
      >
        <a href="#top" className="flex items-center gap-2 font-display text-xl tracking-tight">
          <span className="inline-block size-2 rounded-full bg-gold shadow-[0_0_18px_var(--gold)]" />
          <span className="text-foreground">Fly <span className="italic text-gold">n</span> Feel</span>
        </a>

        <ul className="hidden items-center gap-8 text-sm text-muted-foreground lg:flex">
          {links.map((l) => (
            <li key={l.label}>
              <a
                href={l.href}
                className="relative transition-colors hover:text-foreground"
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3">
          <a
            href="#contact"
            className="hidden rounded-full bg-gold px-5 py-2 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.03] md:inline-block"
          >
            Plan a Journey
          </a>
          <button
            aria-label="Menu"
            onClick={() => setOpen((v) => !v)}
            className="grid size-10 place-items-center rounded-full border border-white/15 text-foreground lg:hidden"
          >
            <span className="relative block size-4">
              <span className={`absolute left-0 top-1 h-px w-full bg-current transition-transform ${open ? "translate-y-[6px] rotate-45" : ""}`} />
              <span className={`absolute left-0 top-[14px] h-px w-full bg-current transition-transform ${open ? "-translate-y-[6px] -rotate-45" : ""}`} />
            </span>
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="glass absolute inset-x-4 top-[88px] rounded-3xl p-6 lg:hidden"
          >
            <ul className="flex flex-col gap-4 font-display text-2xl">
              {links.map((l) => (
                <li key={l.label}>
                  <a onClick={() => setOpen(false)} href={l.href} className="block">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
