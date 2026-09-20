import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "@tanstack/react-router";
import logo from "@/assets/flynfeel-logo.png";
import { useAuth } from "@/lib/auth/auth-context";

const links = [
  { label: "Home", to: "/" },
  { label: "Domestic", to: "/domestic" },
  { label: "International", to: "/international" },
  { label: "About", to: "/about" },
  { label: "Contact", to: "/contact" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { isAuthenticated } = useAuth();

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
      className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 sm:px-8 lg:px-16"
    >
      <nav
        style={{ borderRadius: "0 0 22px 22px" }}
        className={`flex w-full max-w-[1120px] items-center justify-between gap-4 rounded-full border border-t-0 border-foreground/10 bg-[#F8F8F6] px-4 py-2 transition-all duration-500 sm:px-6 sm:py-2.5 lg:px-8 ${scrolled ? "shadow-[var(--shadow-soft)]" : ""}`}
      >
        <Link to="/" aria-label="Fly n Feel Holidays — Home" className="flex shrink-0 items-center">
          <img
            src={logo}
            alt="Fly n Feel Holidays"
            className="h-12 w-auto sm:h-14 md:h-16 lg:h-[72px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
            loading="eager"
            decoding="async"
          />
        </Link>


        <ul className="hidden min-w-0 items-center gap-6 lg:flex xl:gap-9">
          {links.map((l) => (
            <li key={l.label}>
              <Link
                to={l.to}
                className="relative whitespace-nowrap font-sans text-xs font-medium uppercase tracking-[0.1em] text-foreground/70 transition-colors hover:text-foreground after:absolute after:-bottom-1.5 after:left-0 after:h-[2px] after:w-full after:bg-gold after:opacity-0 after:transition-opacity"
                activeProps={{ className: "text-foreground after:opacity-100" }}
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Link
            to={isAuthenticated ? "/account" : "/auth/login"}
            className="hidden whitespace-nowrap text-xs font-semibold text-foreground transition-colors hover:text-gold sm:inline-block"
          >
            {isAuthenticated ? "Account" : "Login / Sign Up"}
          </Link>
          <Link
            to="/contact"
            className="hidden whitespace-nowrap rounded-sm bg-gold px-4 py-2 font-sans text-xs font-semibold uppercase tracking-[0.08em] text-primary-foreground transition-transform hover:scale-[1.03] sm:px-5 md:inline-block"
          >
            Plan a Journey
          </Link>
          <button
            aria-label="Menu"
            onClick={() => setOpen((v) => !v)}
            className="grid size-9 place-items-center rounded-sm border border-foreground/15 text-foreground sm:size-10 lg:hidden"
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
            className="glass absolute inset-x-0 top-[68px] border-b border-foreground/10 p-6 lg:hidden"
          >
            <ul className="flex flex-col gap-4 font-sans text-sm font-medium uppercase tracking-[0.08em] text-foreground/80">
              {links.map((l) => (
                <li key={l.label}>
                  <Link onClick={() => setOpen(false)} to={l.to} className="block transition-colors hover:text-foreground">
                    {l.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link onClick={() => setOpen(false)} to={isAuthenticated ? "/account" : "/auth/login"} className="block text-gold">
                  {isAuthenticated ? "Account" : "Login / Sign Up"}
                </Link>
              </li>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
