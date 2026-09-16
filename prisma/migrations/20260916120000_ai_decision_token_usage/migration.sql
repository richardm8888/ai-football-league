-- Record what each coaching request actually cost.
--
-- Nothing logged token usage before this, so every figure in docs/AI_COSTS.md is
-- derived from the code rather than observed. These four counters come straight
-- from the provider's usage object.
--
-- Nullable rather than defaulted to zero: the local coach makes no API call, and
-- a single call can propose tactics, training and a scouting summary at once, so
-- the counters land on the first of those rows and stay null on the rest. Null
-- means unmeasured, which averages and sums correctly; zero would not.
ALTER TABLE "AiDecision" ADD COLUMN     "inputTokens" INTEGER,
ADD COLUMN     "outputTokens" INTEGER,
ADD COLUMN     "cacheCreationInputTokens" INTEGER,
ADD COLUMN     "cacheReadInputTokens" INTEGER;
