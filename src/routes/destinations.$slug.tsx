import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SmoothScroll } from "@/components/SmoothScroll";
import { ScrollProgress } from "@/components/ScrollProgress";
import { PageHero } from "@/components/PageHero";
import { destinations, getDestination, type Destination } from "@/data/destinations";

export const Route = createFileRoute("/destinations/$slug")({
  loader: ({ params }) => {
    const d = getDestination(params.slug);
    if (!d) throw notFound();
    return d;
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.name} Tour Package — ${loaderData.nights} | Fly n Feel Holidays` },
          { name: "description", content: loaderData.tagline },
          { property: "og:title", content: `${loaderData.name} — ${loaderData.nights}` },
          { property: "og:description", content: loaderData.overview.slice(0, 180) },
          { property: "og:image", content: loaderData.img },
          { property: "og:type", content: "article" },
        ]
      : [],
  }),
  notFoundComponent: () => (
    <div className="grid min-h-screen place-items-center">
      <Link to="/" className="text-gold">Destination not found — return home →</Link>
    </div>
  ),
  errorComponent: () => (
    <div className="grid min-h-screen place-items-center">
      <Link to="/" className="text-gold">Something went wrong — return home →</Link>
    </div>
  ),
  component: DestinationPage,
});

function DestinationPage() {
  const d = Route.useLoaderData() as Destination;
  const others = destinations.filter((x) => x.region === d.region && x.slug !== d.slug);

  return (
    <main className="relative bg-background text-foreground">
      <ScrollProgress />
      <SmoothScroll />
      <Nav />

      <PageHero
        image={d.img}
        eyebrow={`${d.region} · ${d.country}`}
        title={<>{d.name}<br /><span className="italic gold-gradient">{d.nights}</span></>}
        subtitle={d.hero}
        height="80svh"
      />

      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { l: "Duration", v: d.nights },
            { l: "Departs", v: d.from },
            { l: "Best Months", v: d.bestMonths },
            { l: "Starting From", v: d.price },
          ].map((m, i) => (
            <motion.div
              key={m.l}
              initial={{ y: 30, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.05 }}
              className="rounded-2xl border border-white/10 bg-card/60 p-6"
            >
              <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{m.l}</div>
              <div className="mt-2 font-display text-2xl text-gold">{m.v}</div>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-12">
        <div className="grid gap-12 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-12">
            <div>
              <h2 className="font-display text-3xl md:text-5xl">Overview</h2>
              <div className="hairline mt-6" />
              <p className="mt-6 text-pretty text-muted-foreground md:text-lg leading-relaxed">{d.overview}</p>
            </div>

            <div>
              <h2 className="font-display text-3xl md:text-5xl">Trip Highlights</h2>
              <div className="hairline mt-6" />
              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {d.features.map((f) => (
                  <li key={f} className="flex items-start gap-3 text-sm text-foreground/85">
                    <span className="mt-2 inline-block size-1.5 shrink-0 rounded-full bg-gold" /> {f}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h2 className="font-display text-3xl md:text-5xl">Day‑by‑Day Itinerary</h2>
              <div className="hairline mt-6" />
              <div className="mt-8 space-y-6">
                {d.itinerary.map((day, i) => (
                  <motion.div
                    key={day.day}
                    initial={{ x: -20, opacity: 0 }}
                    whileInView={{ x: 0, opacity: 1 }}
                    viewport={{ once: true, margin: "-60px" }}
                    transition={{ duration: 0.7, delay: i * 0.05 }}
                    className="relative rounded-2xl border border-white/10 bg-card/60 p-6 md:p-8"
                  >
                    <div className="flex items-baseline gap-4">
                      <span className="font-display text-3xl text-gold">{day.day}</span>
                      <h3 className="font-display text-xl md:text-2xl">{day.title}</h3>
                    </div>
                    <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                      {day.details.map((det, j) => (
                        <li key={j} className="flex gap-3"><span className="mt-2 inline-block size-1 shrink-0 rounded-full bg-gold/60" />{det}</li>
                      ))}
                    </ul>
                  </motion.div>
                ))}
              </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-card/60 p-7">
                <h3 className="font-display text-2xl text-gold">Inclusions</h3>
                <ul className="mt-4 space-y-2 text-sm text-foreground/85">
                  {d.includes.map((i) => <li key={i} className="flex gap-3"><span className="mt-2 inline-block size-1 shrink-0 rounded-full bg-gold" />{i}</li>)}
                </ul>
              </div>
              <div className="rounded-2xl border border-white/10 bg-card/60 p-7">
                <h3 className="font-display text-2xl text-gold">Exclusions</h3>
                <ul className="mt-4 space-y-2 text-sm text-foreground/85">
                  {d.excludes.map((i) => <li key={i} className="flex gap-3"><span className="mt-2 inline-block size-1 shrink-0 rounded-full bg-muted-foreground/40" />{i}</li>)}
                </ul>
              </div>
            </div>

            <div>
              <h2 className="font-display text-3xl md:text-5xl">Why travel with us</h2>
              <div className="hairline mt-6" />
              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {d.benefits.map((b) => (
                  <li key={b} className="flex items-start gap-3 text-sm text-foreground/85">
                    <span className="mt-2 inline-block size-1.5 shrink-0 rounded-full bg-gold" /> {b}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h2 className="font-display text-3xl md:text-5xl">Frequently asked</h2>
              <div className="hairline mt-6" />
              <div className="mt-6 space-y-3">
                {d.faqs.map((f) => (
                  <details key={f.q} className="group rounded-2xl border border-white/10 bg-card/60 p-6 transition-all open:border-gold/30">
                    <summary className="cursor-pointer list-none font-display text-lg md:text-xl flex items-center justify-between gap-4">
                      {f.q}
                      <span className="text-gold transition-transform group-open:rotate-45">+</span>
                    </summary>
                    <p className="mt-3 text-sm text-muted-foreground">{f.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>

          <aside className="space-y-6 lg:sticky lg:top-28 lg:self-start">
            <div className="rounded-3xl border border-gold/30 bg-gradient-to-b from-card to-card/40 p-7 shadow-[var(--shadow-luxe)]">
              <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Starting from</div>
              <div className="mt-1 font-display text-4xl text-gold">{d.price}</div>
              <div className="text-xs text-muted-foreground">per person · {d.from}</div>
              <Link to="/contact" className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-gold px-6 py-3 text-sm font-medium text-primary-foreground">
                Enquire on WhatsApp →
              </Link>
              <div className="mt-3 text-center text-xs text-muted-foreground">or call · +91 XXXXX XXXXX</div>
            </div>

            {d.packages.map((p) => (
              <div key={p.tier} className="rounded-3xl border border-white/10 bg-card/60 p-7">
                <h3 className="font-display text-2xl">{p.tier}</h3>
                <div className="mt-2 font-display text-3xl text-gold">{p.price}</div>
                <p className="mt-3 text-sm text-muted-foreground">{p.notes}</p>
              </div>
            ))}

            <div className="rounded-3xl border border-white/10 bg-card/60 p-7 text-sm">
              <div className="text-[10px] uppercase tracking-[0.25em] text-gold">Trip Facts</div>
              <ul className="mt-3 space-y-2 text-muted-foreground">
                <li><span className="text-foreground">Duration ·</span> {d.nights}</li>
                <li><span className="text-foreground">Meals ·</span> {d.meals}</li>
                <li><span className="text-foreground">Hotels ·</span> {d.accommodation}</li>
                <li><span className="text-foreground">Best months ·</span> {d.bestMonths}</li>
              </ul>
            </div>
          </aside>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-24">
        <h2 className="font-display text-3xl md:text-5xl">More {d.region.toLowerCase()} escapes</h2>
        <div className="hairline mt-6" />
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {others.slice(0, 3).map((o) => (
            <Link key={o.slug} to="/destinations/$slug" params={{ slug: o.slug }} className="group block overflow-hidden rounded-2xl border border-white/10">
              <div className="aspect-[4/3] overflow-hidden">
                <img src={o.img} alt={o.name} loading="lazy" className="size-full object-cover transition-transform duration-[1400ms] group-hover:scale-110" />
              </div>
              <div className="p-5">
                <div className="font-display text-2xl group-hover:text-gold transition-colors">{o.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">{o.nights} · {o.from}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <Footer />
    </main>
  );
}
