-- Add persistent routine state and optional pause metadata.
ALTER TABLE "routines"
  ADD COLUMN IF NOT EXISTS "state" JSONB,
  ADD COLUMN IF NOT EXISTS "pausedReason" TEXT,
  ADD COLUMN IF NOT EXISTS "resumeAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "routines_paused_resume_at_idx"
  ON "routines" ("active", "resumeAt")
  WHERE "active" = false AND "resumeAt" IS NOT NULL;
