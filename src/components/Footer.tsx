import { Link } from "@tanstack/react-router";

export function Footer() {
  return (
    <footer className="border-t border-foreground/10 bg-card/40 px-6 pb-10 pt-20">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 font-display text-2xl">
              <span className="inline-block size-2 rounded-full bg-gold shadow-[0_0_18px_var(--gold)]" />
              Fly <span className="italic text-gold">n</span> Feel
            </div>
            <p className="mt-5 max-w-md text-sm text-muted-foreground">
              A small studio of travel designers crafting bespoke, considered journeys
              for those who travel often — and travel well. Serving since 2012.
            </p>
            <div className="mt-6 space-y-1 text-sm text-muted-foreground">
              <div>For Domestic trips · <span className="text-foreground">+91 XXXXX XXXXX</span></div>
              <div>For International trips · <span className="text-foreground">+91 XXXXX XXXXX</span></div>
              <div>Email · <span className="text-foreground">hello@example.com</span></div>
            </div>
          </div>

          <div>
            <div className="mb-5 text-xs uppercase tracking-[0.25em] text-gold">Explore</div>
            <ul className="space-y-3 text-sm">
              <li><Link to="/domestic" className="text-muted-foreground transition-colors hover:text-gold">Domestic Tours</Link></li>
              <li><Link to="/international" className="text-muted-foreground transition-colors hover:text-gold">International Tours</Link></li>
              <li><Link to="/blog" className="text-muted-foreground transition-colors hover:text-gold">Blog</Link></li>
              <li><Link to="/about" className="text-muted-foreground transition-colors hover:text-gold">About</Link></li>
              <li><Link to="/contact" className="text-muted-foreground transition-colors hover:text-gold">Contact</Link></li>
            </ul>
          </div>

          <div>
            <div className="mb-5 text-xs uppercase tracking-[0.25em] text-gold">Legal & Social</div>
            <ul className="space-y-3 text-sm">
              <li><Link to="/terms" className="text-muted-foreground transition-colors hover:text-gold">Terms & Conditions</Link></li>
              <li><Link to="/privacy" className="text-muted-foreground transition-colors hover:text-gold">Privacy Policy</Link></li>
              {["Instagram", "LinkedIn", "Facebook", "YouTube"].map((s) => (
                <li key={s}>
                  <a href="#" className="text-muted-foreground transition-colors hover:text-gold">{s}</a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="hairline mt-16" />

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
          <div>© {new Date().getFullYear()} Fly n Feel Holidays — Crafted with care.</div>
          <div>Ahmedabad · Dubai · Bangkok</div>
        </div>
      </div>
    </footer>
  );
}
