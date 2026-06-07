const tags = [
  "Kashmir", "Maldives", "Dubai", "Vietnam", "Bhutan", "Switzerland",
  "Goa", "Kerala", "Bali", "Baku", "Singapore", "Thailand",
];

export function Marquee() {
  const items = [...tags, ...tags];
  return (
    <section className="border-y border-foreground/5 bg-card/40 py-8 overflow-hidden">
      <div className="flex marquee whitespace-nowrap">
        {items.map((t, i) => (
          <span key={i} className="mx-8 inline-flex items-center gap-8 font-display text-2xl text-muted-foreground md:text-4xl">
            {t}
            <span className="size-1.5 rounded-full bg-gold/70" />
          </span>
        ))}
      </div>
    </section>
  );
}
