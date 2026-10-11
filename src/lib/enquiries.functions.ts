import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const row = {
      name: data.name,
      email: data.email,
      phone: data.phone || null,
      service: data.service || "general",
      destination: data.destination || null,
      message: data.message || null,
      source_page: data.sourcePage || "contact",
    };

    const { error } = await supabaseAdmin.from("enquiries").insert(row);
    if (error) throw new Error("Could not save your enquiry. Please try again.");

    // Emails are best-effort: the saved record is the source of truth.
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    const notifyTo = process.env.ENQUIRY_NOTIFY_EMAIL || from;
    if (apiKey && from && notifyTo) {
      const service = row.service;
      const dest = row.destination ?? "—";
      const msg = row.message ?? "—";
      try {
        await sendResendEmail(
          apiKey,
          from,
          notifyTo,
          `New enquiry: ${service} — ${row.name}`,
          `<h2>New website enquiry</h2>
           <p><b>Service:</b> ${escapeHtml(service)}<br/>
           <b>Name:</b> ${escapeHtml(row.name)}<br/>
           <b>Email:</b> ${escapeHtml(row.email)}<br/>
           <b>Phone:</b> ${escapeHtml(row.phone ?? "—")}<br/>
           <b>Destination:</b> ${escapeHtml(dest)}<br/>
           <b>Source:</b> ${escapeHtml(row.source_page)}</p>
           <p><b>Message:</b><br/>${escapeHtml(msg).replace(/\n/g, "<br/>")}</p>`,
        );
        await sendResendEmail(
          apiKey,
          from,
          row.email,
          "We received your enquiry — Fly n Feel Holidays",
          `<p>Dear ${escapeHtml(row.name)},</p>
           <p>Thank you for contacting Fly n Feel Holidays about <b>${escapeHtml(service)}</b>.
           A travel designer will reply within one business day.</p>
           <p>Warm regards,<br/>Fly n Feel Holidays</p>`,
        );
      } catch (e) {
        console.error("Enquiry email failed:", e instanceof Error ? e.message : e);
      }
    }

    return { ok: true as const };
  });
