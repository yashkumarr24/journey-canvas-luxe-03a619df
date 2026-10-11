import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { saveEnquiry, type EnquiryRow } from './enquiry-store';

const row: EnquiryRow = {
  name: 'Asha Rao',
  email: 'asha@example.com',
  phone: '+91 90000 00000',
  service: 'Visa',
  destination: 'Dubai',
  message: 'Need a tourist visa for two.',
  source_page: 'contact',
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.FNF_SUPABASE_URL;
  delete process.env.FNF_SUPABASE_SERVICE_ROLE_KEY;
});

describe('saveEnquiry', () => {
  it('posts the enquiry row to the FNF database with the service key server-side', async () => {
    process.env.FNF_SUPABASE_URL = 'https://fnf.example.co/';
    process.env.FNF_SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

    let seen: { url: string; apikey?: string; auth?: string; body: string } | null = null;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen = { url: String(input), apikey: headers.apikey, auth: headers.Authorization, body: String(init?.body) };
      return new Response('[]', { status: 201 });
    }) as typeof fetch;

    await saveEnquiry(row);

    assert.ok(seen);
    assert.equal(seen!.url, 'https://fnf.example.co/rest/v1/enquiries');
    assert.equal(seen!.apikey, 'test-service-key');
    assert.equal(seen!.auth, 'Bearer test-service-key');
    assert.deepEqual(JSON.parse(seen!.body), row);
  });

  it('throws when the FNF credentials are not configured', async () => {
    await assert.rejects(() => saveEnquiry(row), /not configured/);
  });

  it('throws when the database rejects the insert', async () => {
    process.env.FNF_SUPABASE_URL = 'https://fnf.example.co';
    process.env.FNF_SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    globalThis.fetch = (async () => new Response('denied', { status: 401 })) as typeof fetch;
    await assert.rejects(() => saveEnquiry(row), /save failed \(401\)/);
  });
});
