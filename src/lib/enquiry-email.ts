// Email plan for a saved website enquiry.
//
// Two messages are always planned:
//   1. a business notification to the configured notify address, and
//   2. a confirmation to the customer's own address.
// The address itself comes from settings (ENQUIRY_NOTIFY_EMAIL), so this module
// only decides who receives what.

export type EnquiryDetails = {
  name: string;
  email: string;
  phone: string | null;
  service: string;
  destination: string | null;
  message: string | null;
  source_page: string;
};

export type EnquiryEmail = {
  to: string;
  subject: string;
  html: string;
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildEnquiryEmails(d: EnquiryDetails, notifyTo: string): EnquiryEmail[] {
  const dest = d.destination ?? "—";
  const msg = d.message ?? "—";
  const phone = d.phone ?? "—";

  return [
    {
      to: notifyTo,
      subject: `New enquiry: ${d.service} — ${d.name}`,
      html: `<h2>New website enquiry</h2>
           <p><b>Service:</b> ${escapeHtml(d.service)}<br/>
           <b>Name:</b> ${escapeHtml(d.name)}<br/>
           <b>Email:</b> ${escapeHtml(d.email)}<br/>
           <b>Phone:</b> ${escapeHtml(phone)}<br/>
           <b>Destination:</b> ${escapeHtml(dest)}<br/>
           <b>Source:</b> ${escapeHtml(d.source_page)}</p>
           <p><b>Message:</b><br/>${escapeHtml(msg).replace(/\n/g, "<br/>")}</p>`,
    },
    {
      to: d.email,
      subject: "We received your enquiry — Fly n Feel Holidays",
      html: `<p>Dear ${escapeHtml(d.name)},</p>
           <p>Thank you for contacting Fly n Feel Holidays about <b>${escapeHtml(d.service)}</b>.
           A travel designer will reply within one business day.</p>
           <p>Warm regards,<br/>Fly n Feel Holidays</p>`,
    },
  ];
}
