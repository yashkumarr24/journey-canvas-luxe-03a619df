import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { SectionTitle } from "./Section";
import { submitEnquiry } from "@/lib/enquiries.functions";

function Field({
  label,
  type = "text",
  as = "input",
  value,
  onChange,
  required,
}: {
  label: string;
  type?: string;
  as?: "input" | "textarea";
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const active = focused || value.length > 0;
  const Comp: any = as;
  return (
    <div className="relative">
      <Comp
        type={type}
        value={value}
        required={required}
        onChange={(e: any) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        rows={as === "textarea" ? 4 : undefined}
        className="peer w-full resize-none border-b border-foreground/15 bg-transparent px-0 pb-3 pt-7 text-base text-foreground outline-none transition-colors focus:border-gold"
      />
      <label
        className={`pointer-events-none absolute left-0 origin-left transition-all ${
          active ? "top-0 text-xs text-gold" : "top-6 text-base text-muted-foreground"
        }`}
      >
        {label}
      </label>
    </div>
  );
}

export function Contact() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  // The form is SSR'd before hydration; until React attaches onSubmit, a click
  // submits nothing and no request is made. Disable the button until hydrated.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [service, setService] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [destination, setDestination] = useState("");
  const [message, setMessage] = useState("");
  const [company, setCompany] = useState(""); // honeypot

  useEffect(() => {
    const on = (e: Event) => setService(String((e as CustomEvent).detail ?? ""));
    window.addEventListener("fnf-enquiry-service", on);
    const saved = sessionStorage.getItem("fnf-enquiry-service");
    if (saved) { setService(saved); sessionStorage.removeItem("fnf-enquiry-service"); }
    return () => window.removeEventListener("fnf-enquiry-service", on);
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "sending") return;
    setStatus("sending");
    try {
      await submitEnquiry({
        data: {
          name,
          email,
          service,
          destination,
          message,
          company,
          sourcePage: window.location.pathname,
        },
      });
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  };

  return (
    <section id="contact" className="relative overflow-hidden px-6 py-28 md:py-40">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(50%_60%_at_50%_50%,oklch(0.18_0.04_260),transparent_70%)]" />
      <div className="mx-auto grid max-w-7xl gap-16 md:grid-cols-2">
        <div>
          <SectionTitle
            eyebrow="Plan Your Journey"
            title={<>Let's design <span className="italic gold-gradient">your next escape.</span></>}
            subtitle="Tell us where you'd like to go — or let us suggest. A travel designer will reply within one business day with a tailored draft."
          />
          <div className="mt-12 space-y-6 text-sm text-muted-foreground">
            <div>
              <div className="text-xs uppercase tracking-[0.25em] text-gold">Domestic</div>
              <div className="mt-1 text-foreground">+91 XXXXX XXXXX</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.25em] text-gold">International</div>
              <div className="mt-1 text-foreground">+91 XXXXX XXXXX</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.25em] text-gold">Email</div>
              <a className="mt-1 block text-foreground hover:text-gold" href="mailto:hello@loremipsum.com">hello@loremipsum.com</a>
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.25em] text-gold">Studio</div>
              <div className="mt-1 text-foreground">
                Lorem Ipsum Business Center,<br />
                Lorem Ipsum Street, Lorem Ipsum City,<br />
                India
              </div>
            </div>
          </div>
        </div>

        <motion.form
          initial={{ y: 40, opacity: 0 }}
          whileInView={{ y: 0, opacity: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.9 }}
          onSubmit={onSubmit}
          className="glass space-y-6 rounded-3xl p-8 md:p-12"
        >
          <div className="relative">
            <label htmlFor="enquiry-service" className="text-xs text-gold">Service</label>
            <select id="enquiry-service" value={service} onChange={(e) => setService(e.target.value)} className="mt-1 w-full border-b border-foreground/15 bg-transparent pb-3 pt-2 text-base text-foreground outline-none focus:border-gold">
              <option value="">Holiday / general enquiry</option>
              {["Flights", "Hotels", "Holidays", "Car Rental", "Visa", "Cruise"].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <Field label="Your full name" value={name} onChange={setName} required />
          <Field label="Email address" type="email" value={email} onChange={setEmail} required />
          <Field label="Where would you like to go?" value={destination} onChange={setDestination} />
          <Field label="Tell us about your trip" as="textarea" value={message} onChange={setMessage} />

          {/* Honeypot: hidden from humans, catches bots */}
          <div aria-hidden="true" className="absolute left-[-9999px] top-0 h-0 w-0 overflow-hidden">
            <label>
              Company
              <input type="text" tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} />
            </label>
          </div>

          {status === "error" && (
            <p role="alert" className="text-sm text-destructive">
              Something went wrong while sending. Please try again.
            </p>
          )}
          {status === "sent" && (
            <p role="status" className="text-sm text-foreground">
              Thank you — your enquiry has been received. We'll reply within one business day.
            </p>
          )}

          <button
            type="submit"
            disabled={status === "sending" || status === "sent"}
            className="group inline-flex items-center gap-3 rounded-full bg-gold px-7 py-4 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.03] disabled:opacity-60"
          >
            {status === "sent" ? "✓ Sent — we'll be in touch" : status === "sending" ? "Sending…" : "Send the brief"}
            <span className="transition-transform group-hover:translate-x-1">→</span>
          </button>
        </motion.form>
      </div>
    </section>
  );
}
