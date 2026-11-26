-- Additive migration: flexible scheduling window, webhook trigger preset, and delivery routing.
ALTER TABLE "Routine"
  ADD COLUMN IF NOT EXISTS "windowMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "webhookPreset" TEXT,
  ADD COLUMN IF NOT EXISTS "deliverTo" JSONB;
