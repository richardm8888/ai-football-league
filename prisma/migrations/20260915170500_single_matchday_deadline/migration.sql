-- Collapse the five pre-lock phases into one OPEN period.
--
-- Analysis, Preparation, Tactical submission and Review and approval gated
-- nothing: every one of them appeared in EDITABLE_PHASES, so the same actions
-- were legal in all of them. They only ever advanced when an administrator
-- pressed a button five times. Existing matchdays sitting in any of them are
-- still open for business, so they all map to OPEN.
CREATE TYPE "MatchdayPhase_new" AS ENUM ('OPEN', 'LOCKED', 'SIMULATION', 'POST_MATCH', 'COMPLETE');

ALTER TABLE "Matchday" ALTER COLUMN "phase" DROP DEFAULT;

ALTER TABLE "Matchday"
  ALTER COLUMN "phase" TYPE "MatchdayPhase_new"
  USING (
    CASE "phase"::text
      WHEN 'WEEK_OPEN'           THEN 'OPEN'
      WHEN 'ANALYSIS'            THEN 'OPEN'
      WHEN 'PREPARATION'         THEN 'OPEN'
      WHEN 'TACTICAL_SUBMISSION' THEN 'OPEN'
      WHEN 'REVIEW_AND_APPROVAL' THEN 'OPEN'
      ELSE "phase"::text
    END
  )::"MatchdayPhase_new";

DROP TYPE "MatchdayPhase";
ALTER TYPE "MatchdayPhase_new" RENAME TO "MatchdayPhase";

ALTER TABLE "Matchday" ALTER COLUMN "phase" SET DEFAULT 'OPEN';
