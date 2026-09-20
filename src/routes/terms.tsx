import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SmoothScroll } from "@/components/SmoothScroll";
import { ScrollProgress } from "@/components/ScrollProgress";
import { PageHero } from "@/components/PageHero";
import hero from "@/assets/hero.webp";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms & Conditions — Fly n Feel Holidays" },
      { name: "description", content: "The terms that govern bookings, payments, cancellations and use of Fly n Feel Holidays services." },
    ],
  }),
  component: Terms,
});

const sections: { h: string; body: string[] }[] = [
  {
    h: "1. Acceptance of Terms",
    body: [
      "By accessing our website, calling our travel desk, or booking any holiday package, you agree to these terms in full. If you do not accept any part of these terms, please do not use our services.",
      "These terms apply to all customers — individuals, families, corporate groups and travel partners — and are in addition to any specific terms attached to your individual itinerary or confirmation email.",
    ],
  },
  {
    h: "2. Bookings & Confirmation",
    body: [
      "A booking is treated as confirmed only once we have received an advance deposit (typically 25–50% of the package value, depending on the destination) and a signed booking form or written confirmation by email or WhatsApp.",
      "Quoted prices are valid for the dates mentioned on the quotation. Hotel availability, airfare and visa fees can change rapidly; the final amount payable will be confirmed at the time of booking.",
    ],
  },
  {
    h: "3. Payment Terms",
    body: [
      "An initial deposit is required to begin processing your booking. The full balance must be cleared at least 30 days before the start of travel for international packages, and 15 days before for domestic packages, unless agreed otherwise in writing.",
      "All payments are accepted in INR via bank transfer, UPI, debit/credit card or cheque. International card surcharges, where applicable, are payable by the customer.",
    ],
  },
  {
    h: "4. Cancellations & Refunds",
    body: [
      "Cancellation charges depend on the time of cancellation and the suppliers (hotels, airlines, cruise lines, visa providers) involved. As a general guide:",
      "More than 45 days before travel — administrative fee plus any non‑refundable supplier costs.",
      "30 to 45 days before travel — 25% of the package value plus non‑refundable supplier costs.",
      "15 to 30 days before travel — 50% of the package value plus non‑refundable supplier costs.",
      "Less than 15 days before travel — up to 100% of the package value may be non‑refundable.",
      "Refunds, where applicable, are processed within 15 working days of receiving a written cancellation request.",
    ],
  },
  {
    h: "5. Visa, Passport & Travel Documents",
    body: [
      "It is the traveller's responsibility to hold a valid passport (with a minimum of 6 months validity from the date of return) and to apply for any visas required for the destination. We provide visa assistance and documentation support where included in your package.",
      "We are not liable for visa rejections by foreign embassies or for any losses arising from incorrect, incomplete or late submission of documents by the traveller.",
    ],
  },
  {
    h: "6. Travel Insurance",
    body: [
      "Travel insurance is strongly recommended for all international travel and for any domestic itinerary that involves adventure activities, high‑altitude travel or pre‑existing medical conditions.",
      "We can arrange travel insurance on your behalf at an additional cost. Coverage is provided by third‑party insurers and is subject to their terms and conditions.",
    ],
  },
  {
    h: "7. Itinerary Changes & Force Majeure",
    body: [
      "Itineraries may need to change due to weather, road closures, political situations, hotel overbookings or other circumstances beyond our control. We will always do our best to provide equivalent or better alternatives at no extra cost.",
      "In the event of force majeure — natural disasters, pandemics, strikes, terrorist activity, government restrictions — we will pass through any refunds received from suppliers but cannot guarantee a full refund of the package amount.",
    ],
  },
  {
    h: "8. Conduct During Travel",
    body: [
      "Travellers are expected to behave responsibly and respect local customs, laws and other guests. We reserve the right to remove a traveller from a group tour without refund if their behaviour endangers the group or breaches local law.",
      "Any damage caused to hotel property, vehicles or third‑party assets is payable by the traveller directly to the supplier.",
    ],
  },
  {
    h: "9. Liability",
    body: [
      "We act as an intermediary between you and the travel suppliers (airlines, hotels, transport, visa providers). While we exercise reasonable care in selecting our suppliers, we are not liable for direct or indirect losses caused by supplier acts or omissions.",
      "Our maximum liability for any claim is limited to the total amount you have paid us for the affected booking.",
    ],
  },
  {
    h: "10. Privacy & Data",
    body: [
      "We collect and process personal data only for the purpose of fulfilling your booking. Please refer to our Privacy Policy for full details on how we collect, store and use your information.",
    ],
  },
  {
    h: "11. Governing Law",
    body: [
      "These terms are governed by the laws of India. Any dispute arising out of or in connection with your booking shall be subject to the exclusive jurisdiction of the courts of Ahmedabad, Gujarat.",
    ],
  },
  {
    h: "12. Contact",
    body: [
      "For any questions about these terms, please write to our travel desk or call your booking executive. We respond to written queries within two working days.",
    ],
  },
];

function Terms() {
  return (
    <main className="relative bg-background text-foreground">
      <ScrollProgress />
      <SmoothScroll />
      <Nav />
      <PageHero
        image={hero}
        eyebrow="Legal"
        title={<>Terms & <span className="italic gold-gradient">Conditions.</span></>}
        subtitle="The terms that govern bookings, payments, cancellations and use of our services. Please read them in full before confirming any booking."
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
