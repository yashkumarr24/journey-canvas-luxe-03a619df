export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-card/40 px-6 pb-10 pt-20">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 font-display text-2xl">
              <span className="inline-block size-2 rounded-full bg-gold shadow-[0_0_18px_var(--gold)]" />
              Fly <span className="italic text-gold">n</span> Feel
            </div>
            <p className="mt-5 max-w-md text-sm text-muted-foreground">
              A small studio of travel designers crafting bespoke, considered journeys
              for those who travel often — and travel well.
            </p>
          </div>

          <div>
            <div className="mb-5 text-xs uppercase tracking-[0.25em] text-gold">Studios</div>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li>Lorem Ipsum City, India</li>
              <li>Lorem Ipsum, UAE</li>
              <li>Lorem Ipsum, Thailand</li>
            </ul>
          </div>

          <div>
            <div className="mb-5 text-xs uppercase tracking-[0.25em] text-gold">Follow</div>
            <ul className="space-y-3 text-sm">
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
          <div className="flex gap-6">
            <a href="#" className="hover:text-gold">Privacy</a>
            <a href="#" className="hover:text-gold">Terms</a>
            <a href="#contact" className="hover:text-gold">Contact</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
