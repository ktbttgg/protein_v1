-- Add silent steering flags + coaching text storage to meal_analysis
-- Safe for local resets even if base tables aren't present yet

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'meal_analysis'
  ) THEN

    ALTER TABLE public.meal_analysis
  ADD COLUMN IF NOT EXISTS meal_summary text,
  ADD COLUMN IF NOT EXISTS fat_risk text,
  ADD COLUMN IF NOT EXISTS fibre_risk text,
  ADD COLUMN IF NOT EXISTS carb_type text,
  ADD COLUMN IF NOT EXISTS five_min_fix text,
  ADD COLUMN IF NOT EXISTS next_time_tweak text,
  ADD COLUMN IF NOT EXISTS coaching_reason text;


    -- Optional: keep values clean with CHECK constraints
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meal_analysis_fat_risk_check') THEN
      ALTER TABLE public.meal_analysis
        ADD CONSTRAINT meal_analysis_fat_risk_check
        CHECK (fat_risk IS NULL OR fat_risk IN ('low','medium','high'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meal_analysis_fibre_risk_check') THEN
      ALTER TABLE public.meal_analysis
        ADD CONSTRAINT meal_analysis_fibre_risk_check
        CHECK (fibre_risk IS NULL OR fibre_risk IN ('low','medium','high'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meal_analysis_carb_type_check') THEN
      ALTER TABLE public.meal_analysis
        ADD CONSTRAINT meal_analysis_carb_type_check
        CHECK (carb_type IS NULL OR carb_type IN ('low','mixed','refined_heavy'));
    END IF;

  END IF;
END $$;