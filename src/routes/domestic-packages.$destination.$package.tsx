import { useState } from "react";
import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SmoothScroll } from "@/components/SmoothScroll";
import { ScrollProgress } from "@/components/ScrollProgress";
import { PageHero } from "@/components/PageHero";
import { findDomesticPackageDestination } from "@/data/domestic-packages";

export const Route = createFileRoute("/domestic-packages/$destination/$package")({
  loader: ({ params }) => {
    const d = findDomesticPackageDestination(params.destination);
    const p = d?.packages.find((x) => x.slug === params.package);
    if (!d || !p) throw notFound();
    return { d: { slug: d.slug, name: d.name, region: d.region, img: d.img }, p };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Unavailable | Fly n Feel Holidays" }, { name: "robots", content: "noindex" }] };
    const { d, p } = loaderData;
    const t = `${p.name} — ${p.duration} | Fly n Feel Holidays`;
    const desc = `${d.name} holiday package, ${p.duration}: tour details, hotels, day-wise itinerary, inclusions and exclusions.`;
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
      <Link to="/domestic" className="text-gold">Package not found — see all India packages →</Link>
    </div>
  ),
  component: DomesticPackagePage,
});

function Dot({ muted }: { muted?: boolean }) {
  return <span className={`mt-2 inline-block size-1 shrink-0 rounded-full ${muted ? "bg-muted-foreground/40" : "bg-gold"}`} />;
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <>
      <h2 className="font-display text-3xl md:text-5xl">{children}</h2>
      <div className="hairline mt-6" />
    </>
  );
}

function DomesticPackagePage() {
  const { d, p } = Route.useLoaderData();
  const [sel, setSel] = useState(0);
  const opt = p.options[sel] ?? p.options[0];
  const multi = p.options.length > 1;

  return (
    <main className="relative bg-background text-foreground">
      <ScrollProgress />
      <SmoothScroll />
      <Nav />
      <PageHero
        image={d.img}
        eyebrow={`India · ${d.region}`}
        title={<>{p.name}<br /><span className="italic gold-gradient">{p.duration}</span></>}
        height="80svh"
        lightText
      />

      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-12 lg:grid-cols-3">
          <div className="space-y-12 lg:col-span-2">
            <div>
              <Heading>Tour Details</Heading>
              <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                {p.tour.map((f) => (
                  <div key={f.label} className="rounded-2xl border border-foreground/10 bg-card/60 p-5">
                    <dt className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{f.label}</dt>
                    <dd className="mt-2 text-foreground/90">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div>
              <Heading>Hotel Details</Heading>
              {multi && (
                <div role="tablist" aria-label="Package options" className="mt-6 flex flex-wrap gap-2">
                  {p.options.map((o, i) => (
                    <button
                      key={o.name}
                      role="tab"
                      aria-selected={i === sel}
                      onClick={() => setSel(i)}
                      className={`rounded-full border px-5 py-2 text-xs font-medium uppercase tracking-[0.18em] transition-colors ${
                        i === sel ? "border-gold bg-gold text-primary-foreground" : "border-foreground/15 text-foreground/80 hover:border-gold/50"
                      }`}
                    >
                      Option {i + 1}
                    </button>
                  ))}
                </div>
              )}
              <div key={sel} className="mt-6 rounded-2xl border border-foreground/10 bg-card/60 p-6 md:p-8">
                {multi && <h3 className="font-display text-2xl">{opt.name}</h3>}
                {opt.price && opt.price.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {opt.price.map((line) => (
                      <li key={line} className="font-display text-lg text-gold">{line}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      <tr className="border-b border-foreground/10">
                        {opt.columns.map((c) => <th key={c} className="py-2 pr-4 font-normal">{c}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {opt.hotels.map((row, j) => (
                        <tr key={j} className="border-b border-foreground/5 align-top text-foreground/85">
                          {row.map((cell, k) => <td key={k} className="py-2 pr-4">{cell}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {opt.details && (
                  <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
                    {opt.details.map((t) => <li key={t}>{t}</li>)}
                  </ul>
                )}
              </div>
            </div>

            <div>
              <Heading>Day‑Wise Itinerary</Heading>
              <div className="mt-8 space-y-6">
                {p.itinerary.map((day, i) => (
                  <motion.div
                    key={day.day}
                    initial={{ x: -20, opacity: 0 }}
                    whileInView={{ x: 0, opacity: 1 }}
                    viewport={{ once: true, margin: "-60px" }}
                    transition={{ duration: 0.7, delay: Math.min(i, 6) * 0.05 }}
                    className="rounded-2xl border border-foreground/10 bg-card/60 p-6 md:p-8"
                  >
                    <div className="text-[10px] uppercase tracking-[0.25em] text-gold">{day.day}</div>
                    {day.title && <h3 className="mt-2 font-display text-xl md:text-2xl">{day.title}</h3>}
                    <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">{day.text}</p>
                  </motion.div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-foreground/10 bg-card/60 p-7">
              <h2 className="font-display text-2xl text-gold">Inclusions</h2>
              <ul className="mt-4 space-y-2 text-sm text-foreground/85">
                {p.inclusions.map((t) => <li key={t} className="flex gap-3"><Dot />{t}</li>)}
              </ul>
            </div>

            <div className="rounded-2xl border border-foreground/10 bg-card/60 p-7">
              <h2 className="font-display text-2xl text-gold">Exclusions</h2>
              <ul className="mt-4 space-y-2 text-sm text-foreground/85">
                {p.exclusions.map((t) => <li key={t} className="flex gap-3"><Dot muted />{t}</li>)}
              </ul>
            </div>

            {p.notes.length > 0 && (
              <div>
                <Heading>Important Notes</Heading>
                {p.notes.map((g, i) => (
                  <div key={i} className="mt-6">
                    {g.title && <h3 className="font-display text-xl text-gold">{g.title}</h3>}
                    <ul className="mt-3 space-y-3 text-sm text-foreground/85">
                      {g.items.map((t) => <li key={t} className="flex gap-3"><Dot />{t}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          <aside className="space-y-6 lg:sticky lg:top-28 lg:self-start">
            <div className="rounded-3xl border border-gold/30 bg-gradient-to-b from-card to-card/40 p-7 shadow-[var(--shadow-luxe)]">
              <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                {multi ? `Price · ${opt.name}` : "Price"}
              </div>
              <div className="mt-1 font-display text-2xl text-gold">
                {opt.price?.length ? opt.price[opt.price.length - 1] : p.priceFrom ?? "On request"}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">Subject to availability. Not a confirmed booking price.</div>
              <Link to="/contact" className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-gold px-6 py-3 text-sm font-medium text-primary-foreground">
                Enquire for a quote →
              </Link>
            </div>
            <Link to="/domestic-packages/$destination" params={{ destination: d.slug }} className="block text-center text-xs uppercase tracking-[0.25em] text-gold">
              More {d.name} packages →
            </Link>
          </aside>
        </div>
      </section>
      <Footer />
    </main>
  );
}
