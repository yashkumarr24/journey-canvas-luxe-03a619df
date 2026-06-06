import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "@tanstack/react-router";

const links = [
  { label: "Domestic", to: "/domestic" },
  { label: "International", to: "/international" },
  { label: "Blog", to: "/blog" },
  { label: "About", to: "/about" },
  { label: "Contact", to: "/contact" },
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
      transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4 md:pt-6"
    >
      <nav
        className={`flex w-full max-w-6xl items-center justify-between gap-4 rounded-full border border-white/10 px-4 py-2.5 transition-all duration-500 sm:px-5 sm:py-3 md:px-6 lg:px-7 ${
          scrolled ? "glass shadow-[var(--shadow-soft)]" : "bg-transparent backdrop-blur-sm"
        }`}
      >
        <Link to="/" className="flex shrink-0 items-center gap-2 font-display text-lg tracking-tight sm:text-xl">
          <span className="inline-block size-2 rounded-full bg-gold shadow-[0_0_18px_var(--gold)]" />
          <span className="text-foreground">Fly <span className="italic text-gold">n</span> Feel</span>
        </Link>

        <ul className="hidden min-w-0 items-center gap-5 text-sm text-muted-foreground lg:flex xl:gap-8">
          {links.map((l) => (
            <li key={l.label}>
              <Link
                to={l.to}
                className="relative whitespace-nowrap transition-colors hover:text-foreground"
                activeProps={{ className: "text-foreground" }}
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Link
            to="/contact"
            className="hidden whitespace-nowrap rounded-full bg-gold px-4 py-2 text-xs font-medium text-primary-foreground transition-transform hover:scale-[1.03] sm:px-5 sm:text-sm md:inline-block"
          >
            Plan a Journey
          </Link>
          <button
            aria-label="Menu"
            onClick={() => setOpen((v) => !v)}
            className="grid size-9 place-items-center rounded-full border border-white/15 text-foreground sm:size-10 lg:hidden"
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
                  <Link onClick={() => setOpen(false)} to={l.to} className="block">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
