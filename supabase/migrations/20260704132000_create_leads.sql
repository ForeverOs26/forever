CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  country TEXT,
  budget TEXT,
  interest TEXT,
  project_slug TEXT REFERENCES public.projects(slug) ON UPDATE CASCADE ON DELETE SET NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  source TEXT NOT NULL DEFAULT 'contact_form',
  CONSTRAINT leads_name_not_empty CHECK (length(btrim(name)) > 0),
  CONSTRAINT leads_email_format CHECK (
    email ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
  ),
  CONSTRAINT leads_phone_not_empty CHECK (length(btrim(phone)) > 0),
  CONSTRAINT leads_phone_format CHECK (
    phone ~ '^\+?[0-9][0-9 ()\-]{6,24}[0-9]$'
  ),
  CONSTRAINT leads_status_valid CHECK (
    status IN ('new', 'contacted', 'qualified', 'closed', 'spam')
  )
);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

GRANT INSERT ON public.leads TO anon, authenticated;
GRANT ALL ON public.leads TO service_role;

CREATE POLICY "Anyone can submit a lead"
  ON public.leads
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    status = 'new'
    AND length(btrim(name)) > 0
    AND length(btrim(email)) > 0
    AND length(btrim(phone)) > 0
  );

CREATE INDEX IF NOT EXISTS idx_leads_created_at ON public.leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_project_slug ON public.leads(project_slug);
CREATE INDEX IF NOT EXISTS idx_leads_email ON public.leads(email);
