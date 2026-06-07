import { useState } from "react";
import { motion } from "framer-motion";
import { SectionTitle } from "./Section";

function Field({ label, type = "text", as = "input" }: { label: string; type?: string; as?: "input" | "textarea" }) {
  const [val, setVal] = useState("");
  const [focused, setFocused] = useState(false);
  const active = focused || val.length > 0;
  const Comp: any = as;
  return (
    <div className="relative">
      <Comp
        type={type}
        value={val}
        onChange={(e: any) => setVal(e.target.value)}
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
  const [sent, setSent] = useState(false);
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
          onSubmit={(e) => { e.preventDefault(); setSent(true); }}
          className="glass space-y-6 rounded-3xl p-8 md:p-12"
        >
          <Field label="Your full name" />
          <Field label="Email address" type="email" />
          <Field label="Where would you like to go?" />
          <Field label="Tell us about your trip" as="textarea" />

          <button
            type="submit"
            className="group inline-flex items-center gap-3 rounded-full bg-gold px-7 py-4 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.03]"
          >
            {sent ? "✓ Sent — we'll be in touch" : "Send the brief"}
            <span className="transition-transform group-hover:translate-x-1">→</span>
          </button>
        </motion.form>
      </div>
    </section>
  );
}
