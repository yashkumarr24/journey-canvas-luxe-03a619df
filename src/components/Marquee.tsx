const tags = [
  "Kashmir", "Maldives", "Dubai", "Vietnam", "Bhutan", "Switzerland",
  "Goa", "Kerala", "Bali", "Baku", "Singapore", "Thailand",
];

export function Marquee() {
  const items = [...tags, ...tags];
  return (
    <section className="border-y border-foreground/5 bg-card/40 py-4 overflow-hidden">
      <div className="flex marquee marquee-track whitespace-nowrap">
        {items.map((t, i) => (
          <span
            key={i}
            className="group mx-4 inline-flex items-center gap-4 font-display text-base md:text-xl text-muted-foreground transition-colors duration-300 hover:text-gold cursor-default"
          >
            <span className="transition-transform duration-300 group-hover:-translate-y-0.5">{t}</span>
            <span className="size-1 rounded-full bg-gold/70 transition-transform duration-300 group-hover:scale-150" />
          </span>
        ))}
      </div>
    </section>
  );
}
