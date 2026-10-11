import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { buildEnquiryEmails } from "./enquiry-email";
import { saveEnquiry } from "./enquiry-store";

const enquirySchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  service: z.string().trim().max(60).optional().or(z.literal("")),
  destination: z.string().trim().max(200).optional().or(z.literal("")),
  message: z.string().trim().max(4000).optional().or(z.literal("")),
  sourcePage: z.string().trim().max(120).optional().or(z.literal("")),
  // Honeypot: real users never fill this; bots do.
  company: z.string().max(0).optional().or(z.literal("")),
});

async function sendResendEmail(apiKey: string, from: string, to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

export const submitEnquiry = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => enquirySchema.parse(input))
  .handler(async ({ data }) => {
    // Spam: honeypot filled → pretend success, store nothing.
    if (data.company) return { ok: true as const };

    const row = {
      name: data.name,
      email: data.email,
      phone: data.phone || null,
      service: data.service || "general",
      destination: data.destination || null,
      message: data.message || null,
      source_page: data.sourcePage || "contact",
    };

    try {
      await saveEnquiry(row);
    } catch {
      throw new Error("Could not save your enquiry. Please try again.");
    }

    // Emails are best-effort: the saved record is the source of truth.
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    const notifyTo = process.env.ENQUIRY_NOTIFY_EMAIL || from;
    if (apiKey && from && notifyTo) {
      try {
        for (const email of buildEnquiryEmails(row, notifyTo)) {
          await sendResendEmail(apiKey, from, email.to, email.subject, email.html);
        }
      } catch (e) {
        console.error("Enquiry email failed:", e instanceof Error ? e.message : e);
      }
    }

    return { ok: true as const };
  });
