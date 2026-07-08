-- FDB-002B: Unit price history foundation.

CREATE TABLE IF NOT EXISTS public.unit_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  price NUMERIC(14,2) NOT NULL CHECK (price >= 0),
  currency TEXT NOT NULL DEFAULT 'THB',
  price_source TEXT,
  source_file TEXT,
  source_page INTEGER CHECK (source_page IS NULL OR source_page > 0),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  price_list_date DATE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.unit_price_history TO anon, authenticated;
GRANT ALL ON public.unit_price_history TO service_role;
ALTER TABLE public.unit_price_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'unit_price_history'
      AND policyname = 'Price history of active project units is viewable'
  ) THEN
    CREATE POLICY "Price history of active project units is viewable"
      ON public.unit_price_history
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.units u
          JOIN public.projects p ON p.id = u.project_id
          WHERE u.id = unit_price_history.unit_id
            AND p.is_active = true
        )
      );
  END IF;
END $$;

CREATE TRIGGER trg_unit_price_history_updated_at
  BEFORE UPDATE ON public.unit_price_history
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_unit_price_history_unit_id
  ON public.unit_price_history(unit_id);
CREATE INDEX IF NOT EXISTS idx_unit_price_history_recorded_at
  ON public.unit_price_history(recorded_at);
CREATE INDEX IF NOT EXISTS idx_unit_price_history_price_list_date
  ON public.unit_price_history(price_list_date);
CREATE INDEX IF NOT EXISTS idx_unit_price_history_currency
  ON public.unit_price_history(currency);
