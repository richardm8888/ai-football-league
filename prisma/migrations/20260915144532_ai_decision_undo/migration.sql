-- AlterEnum
ALTER TYPE "AiDecisionStatus" ADD VALUE 'UNDONE';

-- AlterTable
ALTER TABLE "AiDecision" ADD COLUMN     "appliedAt" TIMESTAMP(3),
ADD COLUMN     "previousState" JSONB;
