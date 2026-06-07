import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SmoothScroll } from "@/components/SmoothScroll";
import { ScrollProgress } from "@/components/ScrollProgress";
import { PageHero } from "@/components/PageHero";
import { posts } from "@/data/posts";
import blogHero from "@/assets/blog-hero.jpg";

export const Route = createFileRoute("/blog/")({
  head: () => ({
    meta: [
      { title: "The Journal — Fly n Feel Holidays Blog" },
      { name: "description", content: "Travel notes, planning guides and quiet recommendations from our travel desk." },
      { property: "og:title", content: "The Journal — Fly n Feel Holidays" },
      { property: "og:description", content: "Field notes and travel guides from the Fly n Feel desk." },
    ],
  }),
  component: BlogIndex,
});

function BlogIndex() {
  return (
    <main className="relative bg-background text-foreground">
      <ScrollProgress />
      <SmoothScroll />
      <Nav />
      <PageHero
        image={blogHero}
        eyebrow="The Journal"
        title={<>Stories from <span className="italic gold-gradient">the road.</span></>}
        subtitle="A growing library of field notes, planning guides and quiet recommendations from our travel desk."
      />
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-10 md:grid-cols-2">
          {posts.map((p, i) => (
            <motion.article
              key={p.slug}
              initial={{ y: 40, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: i * 0.08 }}
              className="group"
            >
              <Link to="/blog/$slug" params={{ slug: p.slug }} className="block">
                <div className="aspect-[16/10] overflow-hidden rounded-3xl border border-foreground/10">
                  <img src={p.cover} alt={p.title} loading="lazy" className="size-full object-cover transition-transform duration-[1400ms] ease-out group-hover:scale-110" />
                </div>
                <div className="mt-5 flex items-center gap-4 text-xs uppercase tracking-[0.25em] text-muted-foreground">
                  <span className="text-gold">by {p.author}</span>
                  <span>·</span>
                  <span>{p.date}</span>
                  <span>·</span>
                  <span>{p.read}</span>
                </div>
                <h2 className="mt-3 font-display text-3xl md:text-4xl leading-tight transition-colors group-hover:text-gold">{p.title}</h2>
                <p className="mt-3 text-muted-foreground">{p.excerpt}</p>
                <div className="mt-4 inline-flex items-center gap-2 text-sm text-gold">
                  Read the article <span className="transition-transform group-hover:translate-x-1">→</span>
                </div>
              </Link>
            </motion.article>
          ))}
        </div>
      </section>
      <Footer />
    </main>
  );
}
