// Server-only reads of the imported holiday packages (lives in the Fly n Feel
// server database, configured via FNF_SUPABASE_URL / FNF_SUPABASE_SERVICE_ROLE_KEY).
// Read-only: this module never writes, and never returns keys or source files.

function cfg() {
  const url = process.env["FNF_SUPABASE_URL"];
  const key = process.env["FNF_SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("Package catalogue is not configured");
  return { url: url.replace(/\/$/, ""), key };
}

function headers(key: string) {
  const h: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_")) h.Authorization = `Bearer ${key}`;
  return h;
}

export async function rest<T>(path: string): Promise<T> {
  const { url, key } = cfg();
  // One retry on a dropped connection or temporary server error, so a brief
  // network blip doesn't hide the whole catalogue.
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(`${url}/rest/v1/${path}`, { headers: headers(key) });
      if (r.ok) return (await r.json()) as T;
      if (r.status < 500 || attempt >= 1) throw new Error(`Package catalogue read failed (${r.status})`);
    } catch (e) {
      if (attempt >= 1 || (e instanceof Error && e.message.startsWith("Package catalogue read failed"))) throw e;
    }
    await new Promise((res) => setTimeout(res, 300));
  }
}

const BUCKET = "package-images";

/** Turns storage://package-images/<path> refs into short-lived signed URLs. */
export async function signRefs(refs: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const paths: string[] = [];
  for (const ref of refs) {
    if (/^https?:\/\//.test(ref)) out[ref] = ref;
    else if (ref.startsWith(`storage://${BUCKET}/`)) paths.push(ref.slice(`storage://${BUCKET}/`.length));
  }
  if (!paths.length) return out;
  const { url, key } = cfg();
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const r = await fetch(`${url}/storage/v1/object/sign/${BUCKET}`, {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify({ expiresIn: 60 * 60 * 6, paths: chunk }),
    });
    if (!r.ok) continue;
    const rows = (await r.json()) as { path: string; signedURL?: string; signedUrl?: string }[];
    for (const row of rows) {
      const s = row.signedURL ?? row.signedUrl;
      if (s) out[`storage://${BUCKET}/${row.path}`] = `${url}/storage/v1${s}`;
    }
  }
  return out;
}
