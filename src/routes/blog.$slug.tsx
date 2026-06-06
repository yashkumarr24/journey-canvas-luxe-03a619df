import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SmoothScroll } from "@/components/SmoothScroll";
import { ScrollProgress } from "@/components/ScrollProgress";
import { PageHero } from "@/components/PageHero";
import { getPost } from "@/data/posts";

export const Route = createFileRoute("/blog/$slug")({
  loader: ({ params }) => {
    const p = getPost(params.slug);
    if (!p) throw notFound();
    return p;
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.title} — Fly n Feel Journal` },
          { name: "description", content: loaderData.excerpt },
          { property: "og:title", content: loaderData.title },
          { property: "og:description", content: loaderData.excerpt },
          { property: "og:image", content: loaderData.cover },
          { property: "og:type", content: "article" },
        ]
      : [],
  }),
  notFoundComponent: () => (
    <div className="grid min-h-screen place-items-center">
      <Link to="/blog" className="text-gold">Post not found — return to journal →</Link>
    </div>
  ),
  errorComponent: () => (
    <div className="grid min-h-screen place-items-center">
      <Link to="/blog" className="text-gold">Something went wrong — back to journal →</Link>
    </div>
  ),
  component: BlogPost,
});

function BlogPost() {
  const p = Route.useLoaderData();
  return (
    <main className="relative bg-background text-foreground">
      <ScrollProgress />
      <SmoothScroll />
      <Nav />
      <PageHero
        image={p.cover}
        eyebrow={`By ${p.author} · ${p.date}`}
        title={p.title}
        subtitle={p.excerpt}
        height="70svh"
      />

      <article className="mx-auto max-w-3xl px-6 py-20">
        <p className="text-lg leading-relaxed text-foreground/90">{p.intro}</p>

        <div className="mt-12 space-y-12">
          {p.sections.map((s, i) => (
            <motion.section
              key={s.heading}
              initial={{ y: 30, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.7, delay: i * 0.03 }}
            >
              <h2 className="font-display text-3xl md:text-4xl text-gold">{s.heading}</h2>
              <div className="hairline mt-4" />
              <p className="mt-5 text-muted-foreground leading-relaxed">{s.body}</p>
            </motion.section>
          ))}
        </div>

        {p.faqs.length > 0 && (
          <section className="mt-16">
            <h2 className="font-display text-3xl md:text-4xl">Frequently asked</h2>
            <div className="hairline mt-4" />
            <div className="mt-6 space-y-3">
              {p.faqs.map((f) => (
                <details key={f.q} className="group rounded-2xl border border-white/10 bg-card/60 p-6 open:border-gold/30">
                  <summary className="cursor-pointer list-none font-display text-lg flex items-center justify-between">
                    {f.q}
                    <span className="text-gold transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 text-sm text-muted-foreground">{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        <div className="mt-16 flex justify-between border-t border-white/10 pt-8 text-sm">
          <Link to="/blog" className="text-muted-foreground hover:text-gold">← All articles</Link>
          <Link to="/contact" className="text-gold">Plan your trip →</Link>
        </div>
      </article>

      <Footer />
    </main>
  );
}
