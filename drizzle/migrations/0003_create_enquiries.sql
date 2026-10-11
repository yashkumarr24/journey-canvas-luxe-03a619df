CREATE TABLE public.enquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email citext NOT NULL,
  phone text,
  service text NOT NULL DEFAULT 'general',
  destination text,
  message text,
  source_page text NOT NULL DEFAULT 'contact',
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT INSERT ON public.enquiries TO anon;
GRANT INSERT ON public.enquiries TO authenticated;
GRANT ALL ON public.enquiries TO service_role;

ALTER TABLE public.enquiries ENABLE ROW LEVEL SECURITY;

CREATE POLICY enquiries_public_insert ON public.enquiries
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

COMMENT ON TABLE public.enquiries IS 'Website enquiry form submissions. Visitors can insert; only service_role (admin/server) can read.';