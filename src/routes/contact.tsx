import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SmoothScroll } from "@/components/SmoothScroll";
import { ScrollProgress } from "@/components/ScrollProgress";
import { PageHero } from "@/components/PageHero";
import { Contact } from "@/components/Contact";
import hero from "@/assets/hero.webp";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact Fly n Feel Holidays — Travel Desk" },
      { name: "description", content: "Reach our travel desk by phone, WhatsApp or email. Offices in Ahmedabad, Abu Road, Dubai and Bangkok." },
      { property: "og:title", content: "Contact Fly n Feel Holidays" },
      { property: "og:description", content: "Talk to a real travel designer. We respond within the hour during office hours." },
    ],
  }),
  component: ContactPage,
});

const offices = [
  {
    name: "Ahmedabad · Head Office",
    body: ["707, 7th Floor, The Ridge,", "Opp. Wide Angle, Nr. Iscon Cross Road,", "Satellite, Ahmedabad — 380054"],
    phone: "+91 XX XXX‑XXXXX",
    hours: "Mon – Sat · 10 AM to 7 PM",
  },
  {
    name: "Abu Road · Rajasthan",
    body: ["14, Ganesh Bhavan, Subhash Market,", "Abu Road — 307026, Rajasthan"],
    phone: "+91 XXXXX XXXXX",
    hours: "Mon – Sat · 10 AM to 7 PM",
  },
  {
    name: "Dubai · United Arab Emirates",
    body: ["Rakez, Dubai, UAE."],
    phone: "+971 XX XXX XXXX",
    hours: "Sun – Thu · 9 AM to 6 PM",
  },
  {
    name: "Bangkok · Thailand",
    body: ["99 Floor 1 Unit L1‑A07,", "Ramkhamhaeng Road, Suan Luang, Bangkok."],
    phone: "+66 XX XXX XXXX",
    hours: "Mon – Sat · 10 AM to 6 PM",
  },
];

function ContactPage() {
  return (
    <main className="relative bg-background text-foreground">
      <ScrollProgress />
      <SmoothScroll />
      <Nav />
      <PageHero
        image={hero}
        eyebrow="Get in Touch"
        title={<>Connect <span className="italic gold-gradient">with us.</span></>}
        subtitle="Reach our travel desk by phone, WhatsApp or email. Tell us how you like to travel — we'll take it from there."
        lightText
      />

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {offices.map((o) => (
            <div key={o.name} className="rounded-3xl border border-foreground/10 bg-card/60 p-7">
              <h3 className="font-display text-xl text-gold">{o.name}</h3>
              <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                {o.body.map((b) => <div key={b}>{b}</div>)}
              </div>
              <div className="mt-4 text-sm text-foreground">{o.phone}</div>
              <div className="mt-1 text-xs text-muted-foreground">{o.hours}</div>
            </div>
          ))}
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-gold/30 bg-card/60 p-7">
            <div className="text-[10px] uppercase tracking-[0.25em] text-gold">For Domestic Trips</div>
            <div className="mt-2 font-display text-3xl">+91 XXXXX XXXXX</div>
          </div>
          <div className="rounded-3xl border border-gold/30 bg-card/60 p-7">
            <div className="text-[10px] uppercase tracking-[0.25em] text-gold">For International Trips</div>
            <div className="mt-2 font-display text-3xl">+91 XXXXX XXXXX</div>
          </div>
        </div>
      </section>

      <Contact />
      <Footer />
    </main>
  );
}
