import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SmoothScroll } from "@/components/SmoothScroll";
import { ScrollProgress } from "@/components/ScrollProgress";
import { PageHero } from "@/components/PageHero";
import { getCataloguePackage } from "@/lib/packages/packages.functions";
import { formatDuration, formatPrice } from "@/lib/packages/types";
import fallbackHero from "@/assets/vietnam.webp";

export const Route = createFileRoute("/packages/$destination/$package")({
  loader: async ({ params }) => {
    const p = await getCataloguePackage({ data: { slug: params.package } });
    if (!p || p.destination.slug !== params.destination) throw notFound();
    return p;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Unavailable | Fly n Feel Holidays" }, { name: "robots", content: "noindex" }] };
    const dur = formatDuration(loaderData.duration_nights, loaderData.duration_days);
    const t = `${loaderData.name}${dur ? ` — ${dur}` : ""} | Fly n Feel Holidays`;
    const desc = (loaderData.overview ?? `${loaderData.destination.name} holiday package.`).slice(0, 180);
    return {
      meta: [
        { title: t },
        { name: "description", content: desc },
        { property: "og:title", content: t },
        { property: "og:description", content: desc },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  notFoundComponent: () => (
    <div className="grid min-h-screen place-items-center">
      <Link to="/international" className="text-gold">Package not found — see all international escapes →</Link>
    </div>
  ),
  errorComponent: () => (
    <div className="grid min-h-screen place-items-center">
      <Link to="/international" className="text-gold">Something went wrong — return to international →</Link>
    </div>
  ),
  component: PackagePage,
});

const NOTE_LABEL: Record<string, string> = {
  visa: "Visa",
  gst: "GST",
  tcs: "TCS",
  payment: "Payment",
  cancellation: "Cancellation",
  other: "Note",
};

function Dot({ muted }: { muted?: boolean }) {
  return <span className={`mt-2 inline-block size-1 shrink-0 rounded-full ${muted ? "bg-muted-foreground/40" : "bg-gold"}`} />;
}

function PackagePage() {
  const d = Route.useLoaderData();
  const duration = formatDuration(d.duration_nights, d.duration_days);
  const fromPrice = formatPrice(d.indicative_price_from, d.currency);
  const hero = d.images[0]?.url ?? fallbackHero;
  const gallery = d.images.slice(1);

  const facts = [
    { l: "Duration", v: duration },
    { l: "Departs", v: d.departure_city },
    { l: "Options", v: d.options.length ? String(d.options.length) : null },
    { l: "Indicative From", v: fromPrice },
  ].filter((m) => m.v);

  return (
    <main className="relative bg-background text-foreground">
      <ScrollProgress />
      <SmoothScroll />
      <Nav />

      <PageHero
        image={hero}
        eyebrow={`International · ${d.destination.country}`}
        title={<>{d.name}{duration && <><br /><span className="italic gold-gradient">{duration}</span></>}</>}
        height="80svh"
        lightText
      />

      {facts.length > 0 && (
        <section className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {facts.map((m, i) => (
              <motion.div
                key={m.l}
                initial={{ y: 30, opacity: 0 }}
                whileInView={{ y: 0, opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: i * 0.05 }}
                className="rounded-2xl border border-foreground/10 bg-card/60 p-6"
              >
                <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{m.l}</div>
                <div className="mt-2 font-display text-2xl text-gold">{m.v}</div>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-6xl px-6 pb-12">
        <div className="grid gap-12 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-12">
            {d.overview && (
              <div>
                <h2 className="font-display text-3xl md:text-5xl">Overview</h2>
                <div className="hairline mt-6" />
                <p className="mt-6 whitespace-pre-line text-pretty text-muted-foreground md:text-lg leading-relaxed">{d.overview}</p>
              </div>
            )}

            {d.highlights.length > 0 && (
              <div>
                <h2 className="font-display text-3xl md:text-5xl">Trip Highlights</h2>
                <div className="hairline mt-6" />
                <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                  {d.highlights.map((f, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm text-foreground/85">
                      <span className="mt-2 inline-block size-1.5 shrink-0 rounded-full bg-gold" /> {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {d.options.length > 0 && (
              <div>
                <h2 className="font-display text-3xl md:text-5xl">Package Options</h2>
                <div className="hairline mt-6" />
                <div className="mt-8 space-y-6">
                  {d.options.map((o, i) => (
                    <div key={i} className="rounded-2xl border border-foreground/10 bg-card/60 p-6 md:p-8">
                      <div className="flex flex-wrap items-baseline justify-between gap-4">
                        <h3 className="font-display text-2xl">{o.option_name}</h3>
                        {o.indicative_price != null && (
                          <div className="text-right">
                            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Indicative</div>
                            <div className="font-display text-2xl text-gold">{formatPrice(o.indicative_price, o.currency)}</div>
                          </div>
                        )}
                      </div>
                      {o.price_basis && <p className="mt-2 text-xs text-muted-foreground">{o.price_basis}</p>}
                      {o.hotels.length > 0 && (
                        <div className="mt-5 overflow-x-auto">
                          <table className="w-full min-w-[480px] text-left text-sm">
                            <thead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                              <tr className="border-b border-foreground/10">
                                <th className="py-2 pr-4 font-normal">City</th>
                                <th className="py-2 pr-4 font-normal">Hotel</th>
                                <th className="py-2 pr-4 font-normal">Room</th>
                                <th className="py-2 pr-4 font-normal">Nights</th>
                                <th className="py-2 font-normal">Meals</th>
                              </tr>
                            </thead>
                            <tbody>
                              {o.hotels.map((h, j) => (
                                <tr key={j} className="border-b border-foreground/5 align-top text-foreground/85">
                                  <td className="py-2 pr-4">{h.city ?? "—"}</td>
                                  <td className="py-2 pr-4">
                                    {h.hotel_name}
                                    {h.star_rating != null && <span className="ml-1 text-gold">{h.star_rating}★</span>}
                                    {h.is_similar && !/similar/i.test(h.hotel_name) && <span className="ml-1 text-muted-foreground">or similar</span>}
                                  </td>
                                  <td className="py-2 pr-4">{h.room_type ?? "—"}</td>
                                  <td className="py-2 pr-4">{h.nights ?? "—"}</td>
                                  <td className="py-2">{h.meal_plan ?? "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
                        {o.child_price_notes && <li>Child: {o.child_price_notes}</li>}
                        {o.single_supplement != null && <li>Single supplement: {formatPrice(o.single_supplement, o.currency)}</li>}
                        {(o.valid_from || o.valid_to) && <li>Valid: {o.valid_from ?? "…"} – {o.valid_to ?? "…"}</li>}
                        {o.notes && <li className="whitespace-pre-line">{o.notes}</li>}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {d.flights.length > 0 && (
              <div>
                <h2 className="font-display text-3xl md:text-5xl">Flights</h2>
                <div className="hairline mt-6" />
                <div className="mt-6 space-y-3">
                  {d.flights.map((f, i) => (
                    <div key={i} className="rounded-2xl border border-foreground/10 bg-card/60 p-5 text-sm text-foreground/85">
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {f.option_name && <span className="text-gold">{f.option_name}</span>}
                        {f.sector && <span>{f.sector}</span>}
                        {f.airline && <span>{f.airline}</span>}
                        {f.flight_no && <span>{f.flight_no}</span>}
                        {(f.depart_time || f.arrive_time) && <span>{f.depart_time ?? ""} → {f.arrive_time ?? ""}</span>}
                        <span className="text-muted-foreground">{f.is_included ? "Included" : "Not included"}</span>
                      </div>
                      {f.notes && <p className="mt-2 whitespace-pre-line text-muted-foreground">{f.notes}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {d.itinerary.length > 0 && (
              <div>
                <h2 className="font-display text-3xl md:text-5xl">Day‑by‑Day Itinerary</h2>
                <div className="hairline mt-6" />
                <div className="mt-8 space-y-6">
                  {d.itinerary.map((day, i) => (
                    <motion.div
                      key={day.day_number}
                      initial={{ x: -20, opacity: 0 }}
                      whileInView={{ x: 0, opacity: 1 }}
                      viewport={{ once: true, margin: "-60px" }}
                      transition={{ duration: 0.7, delay: Math.min(i, 6) * 0.05 }}
                      className="relative rounded-2xl border border-foreground/10 bg-card/60 p-6 md:p-8"
                    >
                      <div className="flex items-baseline gap-4">
                        <span className="font-display text-3xl text-gold">{String(day.day_number).padStart(2, "0")}</span>
                        <h3 className="font-display text-xl md:text-2xl">{day.title}</h3>
                      </div>
                      {day.description && <p className="mt-4 whitespace-pre-line text-sm text-muted-foreground">{day.description}</p>}
                      {(day.meals.length > 0 || day.overnight_city) && (
                        <div className="mt-3 text-xs text-muted-foreground">
                          {day.meals.length > 0 && <span>Meals · {day.meals.join(", ")}</span>}
                          {day.meals.length > 0 && day.overnight_city && <span> · </span>}
                          {day.overnight_city && <span>Overnight · {day.overnight_city}</span>}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {(d.inclusions.length > 0 || d.exclusions.length > 0) && (
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="rounded-2xl border border-foreground/10 bg-card/60 p-7">
                  <h3 className="font-display text-2xl text-gold">Inclusions</h3>
                  <ul className="mt-4 space-y-2 text-sm text-foreground/85">
                    {d.inclusions.map((t, i) => <li key={i} className="flex gap-3"><Dot />{t}</li>)}
                  </ul>
                </div>
                <div className="rounded-2xl border border-foreground/10 bg-card/60 p-7">
                  <h3 className="font-display text-2xl text-gold">Exclusions</h3>
                  <ul className="mt-4 space-y-2 text-sm text-foreground/85">
                    {d.exclusions.map((t, i) => <li key={i} className="flex gap-3"><Dot muted />{t}</li>)}
                  </ul>
                </div>
              </div>
            )}

            {d.notes.length > 0 && (
              <div>
                <h2 className="font-display text-3xl md:text-5xl">Important notes</h2>
                <div className="hairline mt-6" />
                <ul className="mt-6 space-y-3 text-sm text-foreground/85">
                  {d.notes.map((n, i) => (
                    <li key={i} className="flex gap-3">
                      <Dot />
                      <span><span className="text-gold">{NOTE_LABEL[n.kind] ?? n.kind} · </span><span className="whitespace-pre-line">{n.text}</span></span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {gallery.length > 0 && (
              <div>
                <h2 className="font-display text-3xl md:text-5xl">Gallery</h2>
                <div className="hairline mt-6" />
                <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3">
                  {gallery.map((img, i) => (
                    <div key={i} className="aspect-[4/3] overflow-hidden rounded-2xl border border-foreground/10">
                      <img src={img.url} alt={img.alt ?? d.name} loading="lazy" className="size-full object-cover" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-6 lg:sticky lg:top-28 lg:self-start">
            <div className="rounded-3xl border border-gold/30 bg-gradient-to-b from-card to-card/40 p-7 shadow-[var(--shadow-luxe)]">
              <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Indicative starting from</div>
              <div className="mt-1 font-display text-4xl text-gold">{fromPrice ?? "On request"}</div>
              {d.price_basis && <div className="text-xs text-muted-foreground">{d.price_basis}</div>}
              <div className="mt-2 text-xs text-muted-foreground">Subject to availability. Not a confirmed booking price.</div>
              <Link to="/contact" className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-gold px-6 py-3 text-sm font-medium text-primary-foreground">
                Enquire for a quote →
              </Link>
            </div>

            <div className="rounded-3xl border border-foreground/10 bg-card/60 p-7 text-sm">
              <div className="text-[10px] uppercase tracking-[0.25em] text-gold">Trip Facts</div>
              <ul className="mt-3 space-y-2 text-muted-foreground">
                {duration && <li><span className="text-foreground">Duration ·</span> {duration}</li>}
                {d.meal_plan && <li><span className="text-foreground">Meals ·</span> {d.meal_plan}</li>}
                {d.package_code && <li><span className="text-foreground">Code ·</span> {d.package_code}</li>}
                {(d.travel_validity_from || d.travel_validity_to) && (
                  <li><span className="text-foreground">Valid ·</span> {d.travel_validity_from ?? "…"} – {d.travel_validity_to ?? "…"}</li>
                )}
                {d.departures.length > 0 && (
                  <li><span className="text-foreground">Departures ·</span> {d.departures.map((x) => x.departure_date).join(", ")}</li>
                )}
              </ul>
            </div>

            <Link to="/packages/$destination" params={{ destination: d.destination.slug }} className="block text-center text-xs uppercase tracking-[0.25em] text-gold">
              More {d.destination.name} packages →
            </Link>
          </aside>
        </div>
      </section>

      <Footer />
    </main>
  );
}
