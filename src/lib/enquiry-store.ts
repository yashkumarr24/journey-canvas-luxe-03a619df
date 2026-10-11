// Server-only: saves website enquiries to the Fly n Feel database
// (FNF_SUPABASE_URL / FNF_SUPABASE_SERVICE_ROLE_KEY). The service-role key
// never leaves the server; this module is only imported inside handlers.

export interface EnquiryRow {
  name: string;
  email: string;
  phone: string | null;
  service: string;
  destination: string | null;
  message: string | null;
  source_page: string;
}

function cfg() {
  const url = process.env["FNF_SUPABASE_URL"];
  const key = process.env["FNF_SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("Enquiry storage is not configured");
  return { url: url.replace(/\/$/, ""), key };
}

/** Inserts one enquiry row. Throws on failure so the caller can show a retry message. */
export async function saveEnquiry(row: EnquiryRow): Promise<void> {
  const { url, key } = cfg();
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;

  const res = await fetch(`${url}/rest/v1/enquiries`, {
    method: "POST",
    headers,
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Enquiry save failed (${res.status})`);
}
