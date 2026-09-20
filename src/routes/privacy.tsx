import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SmoothScroll } from "@/components/SmoothScroll";
import { ScrollProgress } from "@/components/ScrollProgress";
import { PageHero } from "@/components/PageHero";
import hero from "@/assets/hero.webp";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Fly n Feel Holidays" },
      { name: "description", content: "How Fly n Feel Holidays collects, stores and protects your personal information." },
    ],
  }),
  component: Privacy,
});

const sections: { h: string; body: string[] }[] = [
  {
    h: "General",
    body: [
      "This Privacy Policy applies to the website and other customer interfaces of Fly n Feel Holidays (I) Pvt. Ltd. It governs the collection, use and protection of your personal information as a visitor, registered user or customer.",
      "By visiting and/or using the website, you agree to the practices described in this policy. This statement does not apply to the websites of our business partners, corporate affiliates or any third parties, even when linked from our site.",
    ],
  },
  {
    h: "Information We Collect",
    body: [
      "When you enquire about a tour, request a quotation, register on the website or make a booking, we may collect your name, email address, mobile number, date of birth, passport details (for international travel), travel preferences and billing details.",
      "When you simply visit the website, we collect non‑identifying information such as your IP address, browser type, pages visited and the duration of your visit. This helps us improve the website and tailor what we show you.",
    ],
  },
  {
    h: "How We Use Your Information",
    body: [
      "To fulfil bookings — issue flight, hotel, visa, insurance and ground‑transport bookings on your behalf.",
      "To communicate with you about your trip — confirmations, itinerary updates, vouchers and on‑ground support.",
      "To respond to enquiries and provide customer service.",
      "To send occasional newsletters, promotions and offers — you can opt out at any time.",
      "To comply with legal, regulatory and security requirements.",
    ],
  },
  {
    h: "Sharing of Information",
    body: [
      "We share only the information necessary to fulfil your booking with our suppliers — airlines, hotels, embassies, insurance providers and ground partners.",
      "We do not sell, rent or trade your personal information with any third party for marketing purposes.",
      "We may disclose information when required to do so by law, regulation, court order or legitimate request from public authorities.",
    ],
  },
  {
    h: "Data Security",
    body: [
      "We follow industry‑standard practices to protect your information, including encryption in transit and restricted access to systems that store personal data. While no system is fully immune to risk, we work continuously to keep your data safe.",
    ],
  },
  {
    h: "Cookies",
    body: [
      "We use cookies and similar technologies to remember your preferences, analyse site traffic and improve your experience. You can disable cookies in your browser settings, though some features of the site may not work as intended.",
    ],
  },
  {
    h: "Your Rights",
    body: [
      "You can request a copy of the personal information we hold about you, ask us to correct inaccurate data, or request deletion of your data — subject to any legal obligations we may have to retain it. Please write to our travel desk to make any such request.",
    ],
  },
  {
    h: "Changes to this Policy",
    body: [
      "We may update this policy from time to time. Material changes will be highlighted on this page. Continued use of the website after changes constitutes acceptance of the updated policy.",
    ],
  },
  {
    h: "Contact",
    body: [
      "For any privacy‑related questions, please write to our travel desk. We respond to privacy queries within five working days.",
    ],
  },
];

function Privacy() {
  return (
    <main className="relative bg-background text-foreground">
      <ScrollProgress />
      <SmoothScroll />
      <Nav />
      <PageHero
        image={hero}
        eyebrow="Legal"
        title={<>Privacy <span className="italic gold-gradient">Policy.</span></>}
        subtitle="How we collect, store and protect your personal information."
      />
      <article className="mx-auto max-w-3xl px-6 py-16">
        <div className="space-y-12">
          {sections.map((s) => (
            <section key={s.h}>
              <h2 className="font-display text-2xl md:text-3xl text-gold">{s.h}</h2>
              <div className="hairline mt-4" />
              <div className="mt-5 space-y-4 text-muted-foreground leading-relaxed">
                {s.body.map((p, i) => <p key={i}>{p}</p>)}
              </div>
            </section>
          ))}
        </div>
      </article>
      <Footer />
    </main>
  );
}
