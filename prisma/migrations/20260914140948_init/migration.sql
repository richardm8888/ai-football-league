-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER');

-- CreateEnum
CREATE TYPE "SeasonStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETE');

-- CreateEnum
CREATE TYPE "MatchdayPhase" AS ENUM ('WEEK_OPEN', 'ANALYSIS', 'PREPARATION', 'TACTICAL_SUBMISSION', 'REVIEW_AND_APPROVAL', 'LOCKED', 'SIMULATION', 'POST_MATCH', 'COMPLETE');

-- CreateEnum
CREATE TYPE "FixtureStatus" AS ENUM ('SCHEDULED', 'LOCKED', 'PLAYED');

-- CreateEnum
CREATE TYPE "Position" AS ENUM ('GK', 'DC', 'DL', 'DR', 'DM', 'MC', 'ML', 'MR', 'AM', 'AML', 'AMR', 'ST');

-- CreateEnum
CREATE TYPE "Foot" AS ENUM ('LEFT', 'RIGHT', 'BOTH');

-- CreateEnum
CREATE TYPE "InjurySeverity" AS ENUM ('NONE', 'KNOCK', 'MINOR', 'MODERATE', 'SERIOUS');

-- CreateEnum
CREATE TYPE "Formation" AS ENUM ('F_4_3_3', 'F_4_2_3_1', 'F_4_4_2', 'F_3_5_2', 'F_5_3_2');

-- CreateEnum
CREATE TYPE "Mentality" AS ENUM ('VERY_DEFENSIVE', 'DEFENSIVE', 'BALANCED', 'POSITIVE', 'ATTACKING');

-- CreateEnum
CREATE TYPE "PlayingStyle" AS ENUM ('POSSESSION', 'BALANCED', 'DIRECT', 'COUNTER_ATTACKING', 'HIGH_TEMPO', 'PATIENT_BUILD_UP');

-- CreateEnum
CREATE TYPE "PressingIntensity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'INTENSE');

-- CreateEnum
CREATE TYPE "DefensiveLine" AS ENUM ('DEEP', 'STANDARD', 'HIGH', 'VERY_HIGH');

-- CreateEnum
CREATE TYPE "BuildUp" AS ENUM ('SHORT_PASSING', 'MIXED', 'DIRECT', 'LONG_DISTRIBUTION');

-- CreateEnum
CREATE TYPE "Width" AS ENUM ('NARROW', 'BALANCED', 'WIDE');

-- CreateEnum
CREATE TYPE "DefensiveApproach" AS ENUM ('ZONAL', 'MAN_ORIENTED', 'AGGRESSIVE_PRESSING', 'COMPACT_BLOCK', 'MID_BLOCK', 'LOW_BLOCK');

-- CreateEnum
CREATE TYPE "Tempo" AS ENUM ('VERY_SLOW', 'SLOW', 'NORMAL', 'FAST', 'VERY_FAST');

-- CreateEnum
CREATE TYPE "RiskTolerance" AS ENUM ('CAUTIOUS', 'MEASURED', 'BALANCED', 'BOLD', 'RECKLESS');

-- CreateEnum
CREATE TYPE "AttackingFocus" AS ENUM ('LEFT_FLANK', 'RIGHT_FLANK', 'BOTH_FLANKS', 'CENTRAL', 'MIXED');

-- CreateEnum
CREATE TYPE "SetPieceApproach" AS ENUM ('SHORT', 'MIXED', 'DIRECT_DELIVERY', 'NEAR_POST', 'FAR_POST');

-- CreateEnum
CREATE TYPE "PlayerRole" AS ENUM ('GOALKEEPER', 'SWEEPER_KEEPER', 'FULL_BACK', 'WING_BACK', 'INVERTED_FULL_BACK', 'ATTACKING_FULL_BACK', 'CENTRAL_DEFENDER', 'BALL_PLAYING_DEFENDER', 'STOPPER', 'COVER_DEFENDER', 'WIDE_CENTRE_BACK', 'ANCHOR', 'DEEP_LYING_PLAYMAKER', 'BALL_WINNING_MIDFIELDER', 'HALF_BACK', 'CENTRAL_MIDFIELDER', 'BOX_TO_BOX', 'MEZZALA', 'ROAMING_PLAYMAKER', 'CARRILERO', 'ATTACKING_MIDFIELDER', 'ADVANCED_PLAYMAKER', 'SHADOW_STRIKER', 'WINGER', 'INVERTED_WINGER', 'WIDE_PLAYMAKER', 'WIDE_TARGET_MAN', 'ADVANCED_FORWARD', 'TARGET_MAN', 'POACHER', 'COMPLETE_FORWARD', 'FALSE_NINE', 'PRESSING_FORWARD');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'PROPOSED', 'APPROVED', 'LOCKED');

-- CreateEnum
CREATE TYPE "PlanSource" AS ENUM ('MANUAL', 'AI_ASSISTED');

-- CreateEnum
CREATE TYPE "TrainingFocus" AS ENUM ('RECOVERY', 'FITNESS', 'POSSESSION', 'PRESSING', 'DEFENSIVE_ORGANISATION', 'ATTACKING_PATTERNS', 'TRANSITION_PLAY', 'SET_PIECES', 'FORMATION_FAMILIARITY', 'INDIVIDUAL_ROLES', 'MATCH_PREPARATION');

-- CreateEnum
CREATE TYPE "TrainingIntensity" AS ENUM ('LIGHT', 'NORMAL', 'HIGH', 'VERY_HIGH');

-- CreateEnum
CREATE TYPE "FamiliarityDimension" AS ENUM ('FORMATION', 'PLAYING_STYLE', 'PRESSING', 'DEFENSIVE_ORGANISATION', 'BUILD_UP', 'TRANSITION', 'SET_PIECES', 'OVERALL_STABILITY');

-- CreateEnum
CREATE TYPE "PlayerFamiliarityKind" AS ENUM ('ROLE', 'POSITION');

-- CreateEnum
CREATE TYPE "TeamSide" AS ENUM ('HOME', 'AWAY');

-- CreateEnum
CREATE TYPE "MatchEventType" AS ENUM ('KICK_OFF', 'POSSESSION_SEQUENCE', 'BUILD_UP', 'PRESSING_ACTION', 'TACKLE', 'INTERCEPTION', 'FOUL', 'YELLOW_CARD', 'RED_CARD', 'SHOT', 'SHOT_ON_TARGET', 'SAVE', 'GOAL', 'OWN_GOAL', 'PENALTY_AWARDED', 'PENALTY_MISSED', 'CORNER', 'OFFSIDE', 'INJURY', 'SUBSTITUTION', 'TACTICAL_CHANGE', 'HALF_TIME', 'FULL_TIME');

-- CreateEnum
CREATE TYPE "AiMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');

-- CreateEnum
CREATE TYPE "AiDecisionKind" AS ENUM ('TACTICAL_PLAN', 'TRAINING_PLAN', 'LINEUP_SELECTION', 'SUBSTITUTION_PLAN', 'MATCH_STATE_INSTRUCTION', 'SCOUTING_SUMMARY');

-- CreateEnum
CREATE TYPE "AiDecisionStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'INVALID', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM ('LEAGUE_ROUNDUP', 'MATCH_REPORT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "League" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiModel" TEXT NOT NULL DEFAULT 'claude-sonnet-5',
    "aiMonthlyTokens" INTEGER NOT NULL DEFAULT 400000,

    CONSTRAINT "League_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueMembership" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MANAGER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "SeasonStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Matchday" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "phase" "MatchdayPhase" NOT NULL DEFAULT 'WEEK_OPEN',
    "deadlineAt" TIMESTAMP(3),
    "simulatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Matchday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fixture" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "matchdayId" TEXT NOT NULL,
    "homeClubId" TEXT NOT NULL,
    "awayClubId" TEXT NOT NULL,
    "status" "FixtureStatus" NOT NULL DEFAULT 'SCHEDULED',

    CONSTRAINT "Fixture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Club" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "nickname" TEXT,
    "stadium" TEXT NOT NULL,
    "primaryColor" TEXT NOT NULL DEFAULT '#1f6feb',
    "reputation" INTEGER NOT NULL DEFAULT 60,
    "morale" INTEGER NOT NULL DEFAULT 60,
    "ownerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Club_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubHistory" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "matchdayId" TEXT NOT NULL,
    "matchdayNumber" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "played" INTEGER NOT NULL,
    "won" INTEGER NOT NULL,
    "drawn" INTEGER NOT NULL,
    "lost" INTEGER NOT NULL,
    "goalsFor" INTEGER NOT NULL,
    "goalsAgainst" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "formGuide" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiManager" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "persona" TEXT NOT NULL,
    "philosophy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiManager_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "shirtNumber" INTEGER NOT NULL,
    "primaryPosition" "Position" NOT NULL,
    "secondaryPositions" "Position"[],
    "preferredFoot" "Foot" NOT NULL,
    "potential" INTEGER NOT NULL,
    "personality" TEXT NOT NULL,
    "contractUntil" INTEGER NOT NULL,
    "wageThousands" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerAttribute" (
    "playerId" TEXT NOT NULL,
    "passing" INTEGER NOT NULL,
    "firstTouch" INTEGER NOT NULL,
    "dribbling" INTEGER NOT NULL,
    "finishing" INTEGER NOT NULL,
    "crossing" INTEGER NOT NULL,
    "tackling" INTEGER NOT NULL,
    "marking" INTEGER NOT NULL,
    "heading" INTEGER NOT NULL,
    "longShots" INTEGER NOT NULL,
    "setPieces" INTEGER NOT NULL,
    "decisions" INTEGER NOT NULL,
    "positioning" INTEGER NOT NULL,
    "composure" INTEGER NOT NULL,
    "concentration" INTEGER NOT NULL,
    "anticipation" INTEGER NOT NULL,
    "workRate" INTEGER NOT NULL,
    "teamwork" INTEGER NOT NULL,
    "vision" INTEGER NOT NULL,
    "determination" INTEGER NOT NULL,
    "pace" INTEGER NOT NULL,
    "acceleration" INTEGER NOT NULL,
    "stamina" INTEGER NOT NULL,
    "strength" INTEGER NOT NULL,
    "agility" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL,
    "handling" INTEGER NOT NULL,
    "reflexes" INTEGER NOT NULL,
    "oneOnOnes" INTEGER NOT NULL,
    "distribution" INTEGER NOT NULL,

    CONSTRAINT "PlayerAttribute_pkey" PRIMARY KEY ("playerId")
);

-- CreateTable
CREATE TABLE "PlayerState" (
    "playerId" TEXT NOT NULL,
    "fitness" INTEGER NOT NULL DEFAULT 100,
    "fatigue" INTEGER NOT NULL DEFAULT 0,
    "morale" INTEGER NOT NULL DEFAULT 60,
    "form" INTEGER NOT NULL DEFAULT 50,
    "confidence" INTEGER NOT NULL DEFAULT 50,
    "matchSharpness" INTEGER NOT NULL DEFAULT 60,
    "injury" "InjurySeverity" NOT NULL DEFAULT 'NONE',
    "injuryDescription" TEXT,
    "injuryWeeksLeft" INTEGER NOT NULL DEFAULT 0,
    "suspensionMatches" INTEGER NOT NULL DEFAULT 0,
    "yellowCardsSeason" INTEGER NOT NULL DEFAULT 0,
    "redCardsSeason" INTEGER NOT NULL DEFAULT 0,
    "appearances" INTEGER NOT NULL DEFAULT 0,
    "goals" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "ratingSum" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "PlayerState_pkey" PRIMARY KEY ("playerId")
);

-- CreateTable
CREATE TABLE "MatchPlan" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "PlanSource" NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT NOT NULL DEFAULT '',
    "approvedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TacticalPlan" (
    "id" TEXT NOT NULL,
    "matchPlanId" TEXT NOT NULL,
    "formation" "Formation" NOT NULL,
    "mentality" "Mentality" NOT NULL,
    "playingStyle" "PlayingStyle" NOT NULL,
    "pressing" "PressingIntensity" NOT NULL,
    "defensiveLine" "DefensiveLine" NOT NULL,
    "buildUp" "BuildUp" NOT NULL,
    "width" "Width" NOT NULL,
    "defensiveApproach" "DefensiveApproach" NOT NULL,
    "tempo" "Tempo" NOT NULL,
    "riskTolerance" "RiskTolerance" NOT NULL,
    "attackingFocus" "AttackingFocus" NOT NULL,
    "setPieceApproach" "SetPieceApproach" NOT NULL,
    "counterPress" BOOLEAN NOT NULL DEFAULT false,
    "counterAttack" BOOLEAN NOT NULL DEFAULT false,
    "offsideTrap" BOOLEAN NOT NULL DEFAULT false,
    "fullBackFreedom" INTEGER NOT NULL DEFAULT 50,
    "matchStateInstructions" JSONB NOT NULL DEFAULT '[]',
    "substitutionPlan" JSONB NOT NULL DEFAULT '[]',
    "changeAnalysis" JSONB,

    CONSTRAINT "TacticalPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lineup" (
    "id" TEXT NOT NULL,
    "matchPlanId" TEXT NOT NULL,
    "captainPlayerId" TEXT,

    CONSTRAINT "Lineup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerRoleAssignment" (
    "id" TEXT NOT NULL,
    "lineupId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "position" "Position" NOT NULL,
    "role" "PlayerRole" NOT NULL,
    "isStarter" BOOLEAN NOT NULL DEFAULT true,
    "benchOrder" INTEGER,

    CONSTRAINT "PlayerRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingPlan" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "matchdayId" TEXT NOT NULL,
    "primaryFocus" "TrainingFocus" NOT NULL,
    "secondaryFocus" "TrainingFocus" NOT NULL,
    "intensity" "TrainingIntensity" NOT NULL DEFAULT 'NORMAL',
    "individualFocus" JSONB NOT NULL DEFAULT '[]',
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "PlanSource" NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT NOT NULL DEFAULT '',
    "approvedAt" TIMESTAMP(3),
    "appliedEffects" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TacticalFamiliarity" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "dimension" "FamiliarityDimension" NOT NULL,
    "key" TEXT NOT NULL DEFAULT '_',
    "value" DOUBLE PRECISION NOT NULL DEFAULT 35,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TacticalFamiliarity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerFamiliarity" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "kind" "PlayerFamiliarityKind" NOT NULL,
    "key" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 35,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerFamiliarity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "seed" TEXT NOT NULL,
    "homeGoals" INTEGER NOT NULL,
    "awayGoals" INTEGER NOT NULL,
    "simulatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inputSnapshot" JSONB NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchEvent" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "minute" INTEGER NOT NULL,
    "type" "MatchEventType" NOT NULL,
    "side" "TeamSide",
    "playerId" TEXT,
    "secondaryPlayerId" TEXT,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "description" TEXT NOT NULL,

    CONSTRAINT "MatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchStatistic" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "side" "TeamSide" NOT NULL,
    "possession" DOUBLE PRECISION NOT NULL,
    "shots" INTEGER NOT NULL,
    "shotsOnTarget" INTEGER NOT NULL,
    "expectedGoals" DOUBLE PRECISION NOT NULL,
    "passes" INTEGER NOT NULL,
    "passesCompleted" INTEGER NOT NULL,
    "fouls" INTEGER NOT NULL,
    "yellowCards" INTEGER NOT NULL,
    "redCards" INTEGER NOT NULL,
    "corners" INTEGER NOT NULL,
    "offsides" INTEGER NOT NULL,
    "tackles" INTEGER NOT NULL,
    "interceptions" INTEGER NOT NULL,
    "pressingActions" INTEGER NOT NULL,
    "saves" INTEGER NOT NULL,
    "bigChances" INTEGER NOT NULL,
    "tacticalSummary" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "MatchStatistic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerMatchPerformance" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "side" "TeamSide" NOT NULL,
    "minutesPlayed" INTEGER NOT NULL,
    "position" "Position" NOT NULL,
    "role" "PlayerRole" NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL,
    "goals" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "shots" INTEGER NOT NULL DEFAULT 0,
    "shotsOnTarget" INTEGER NOT NULL DEFAULT 0,
    "expectedGoals" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "passes" INTEGER NOT NULL DEFAULT 0,
    "passesCompleted" INTEGER NOT NULL DEFAULT 0,
    "keyPasses" INTEGER NOT NULL DEFAULT 0,
    "tackles" INTEGER NOT NULL DEFAULT 0,
    "interceptions" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "fouls" INTEGER NOT NULL DEFAULT 0,
    "yellowCard" BOOLEAN NOT NULL DEFAULT false,
    "redCard" BOOLEAN NOT NULL DEFAULT false,
    "injured" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PlayerMatchPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Coaching staff',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDecision" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "matchdayId" TEXT,
    "conversationId" TEXT,
    "kind" "AiDecisionKind" NOT NULL,
    "status" "AiDecisionStatus" NOT NULL DEFAULT 'PROPOSED',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "proposal" JSONB NOT NULL,
    "validation" JSONB NOT NULL,
    "rationale" TEXT NOT NULL DEFAULT '',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMemory" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "importance" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "matchdayId" TEXT NOT NULL,
    "fixtureId" TEXT,
    "kind" "ReportKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "narrative" TEXT NOT NULL DEFAULT '',
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT,
    "clubId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "League_inviteCode_key" ON "League"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueMembership_leagueId_userId_key" ON "LeagueMembership"("leagueId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Season_leagueId_name_key" ON "Season"("leagueId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Matchday_seasonId_number_key" ON "Matchday"("seasonId", "number");

-- CreateIndex
CREATE INDEX "Fixture_seasonId_idx" ON "Fixture"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "Fixture_matchdayId_homeClubId_key" ON "Fixture"("matchdayId", "homeClubId");

-- CreateIndex
CREATE UNIQUE INDEX "Fixture_matchdayId_awayClubId_key" ON "Fixture"("matchdayId", "awayClubId");

-- CreateIndex
CREATE INDEX "Club_ownerUserId_idx" ON "Club"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Club_leagueId_name_key" ON "Club"("leagueId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ClubHistory_clubId_matchdayId_key" ON "ClubHistory"("clubId", "matchdayId");

-- CreateIndex
CREATE UNIQUE INDEX "AiManager_clubId_key" ON "AiManager"("clubId");

-- CreateIndex
CREATE INDEX "Player_clubId_idx" ON "Player"("clubId");

-- CreateIndex
CREATE UNIQUE INDEX "Player_clubId_shirtNumber_key" ON "Player"("clubId", "shirtNumber");

-- CreateIndex
CREATE INDEX "MatchPlan_clubId_idx" ON "MatchPlan"("clubId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchPlan_fixtureId_clubId_key" ON "MatchPlan"("fixtureId", "clubId");

-- CreateIndex
CREATE UNIQUE INDEX "TacticalPlan_matchPlanId_key" ON "TacticalPlan"("matchPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "Lineup_matchPlanId_key" ON "Lineup"("matchPlanId");

-- CreateIndex
CREATE INDEX "PlayerRoleAssignment_lineupId_idx" ON "PlayerRoleAssignment"("lineupId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerRoleAssignment_lineupId_playerId_key" ON "PlayerRoleAssignment"("lineupId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingPlan_clubId_matchdayId_key" ON "TrainingPlan"("clubId", "matchdayId");

-- CreateIndex
CREATE INDEX "TacticalFamiliarity_clubId_idx" ON "TacticalFamiliarity"("clubId");

-- CreateIndex
CREATE UNIQUE INDEX "TacticalFamiliarity_clubId_dimension_key_key" ON "TacticalFamiliarity"("clubId", "dimension", "key");

-- CreateIndex
CREATE INDEX "PlayerFamiliarity_playerId_idx" ON "PlayerFamiliarity"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerFamiliarity_playerId_kind_key_key" ON "PlayerFamiliarity"("playerId", "kind", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Match_fixtureId_key" ON "Match"("fixtureId");

-- CreateIndex
CREATE INDEX "MatchEvent_matchId_sequence_idx" ON "MatchEvent"("matchId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "MatchStatistic_matchId_side_key" ON "MatchStatistic"("matchId", "side");

-- CreateIndex
CREATE INDEX "PlayerMatchPerformance_playerId_idx" ON "PlayerMatchPerformance"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerMatchPerformance_matchId_playerId_key" ON "PlayerMatchPerformance"("matchId", "playerId");

-- CreateIndex
CREATE INDEX "AiConversation_clubId_idx" ON "AiConversation"("clubId");

-- CreateIndex
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiDecision_clubId_createdAt_idx" ON "AiDecision"("clubId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiMemory_clubId_key_key" ON "AiMemory"("clubId", "key");

-- CreateIndex
CREATE INDEX "Report_matchdayId_kind_idx" ON "Report"("matchdayId", "kind");

-- CreateIndex
CREATE INDEX "AuditLog_leagueId_createdAt_idx" ON "AuditLog"("leagueId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_clubId_createdAt_idx" ON "AuditLog"("clubId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "League" ADD CONSTRAINT "League_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMembership" ADD CONSTRAINT "LeagueMembership_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMembership" ADD CONSTRAINT "LeagueMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matchday" ADD CONSTRAINT "Matchday_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_matchdayId_fkey" FOREIGN KEY ("matchdayId") REFERENCES "Matchday"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_homeClubId_fkey" FOREIGN KEY ("homeClubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_awayClubId_fkey" FOREIGN KEY ("awayClubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Club" ADD CONSTRAINT "Club_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Club" ADD CONSTRAINT "Club_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubHistory" ADD CONSTRAINT "ClubHistory_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubHistory" ADD CONSTRAINT "ClubHistory_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubHistory" ADD CONSTRAINT "ClubHistory_matchdayId_fkey" FOREIGN KEY ("matchdayId") REFERENCES "Matchday"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiManager" ADD CONSTRAINT "AiManager_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerAttribute" ADD CONSTRAINT "PlayerAttribute_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerState" ADD CONSTRAINT "PlayerState_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlan" ADD CONSTRAINT "MatchPlan_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlan" ADD CONSTRAINT "MatchPlan_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TacticalPlan" ADD CONSTRAINT "TacticalPlan_matchPlanId_fkey" FOREIGN KEY ("matchPlanId") REFERENCES "MatchPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lineup" ADD CONSTRAINT "Lineup_matchPlanId_fkey" FOREIGN KEY ("matchPlanId") REFERENCES "MatchPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerRoleAssignment" ADD CONSTRAINT "PlayerRoleAssignment_lineupId_fkey" FOREIGN KEY ("lineupId") REFERENCES "Lineup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerRoleAssignment" ADD CONSTRAINT "PlayerRoleAssignment_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingPlan" ADD CONSTRAINT "TrainingPlan_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingPlan" ADD CONSTRAINT "TrainingPlan_matchdayId_fkey" FOREIGN KEY ("matchdayId") REFERENCES "Matchday"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TacticalFamiliarity" ADD CONSTRAINT "TacticalFamiliarity_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerFamiliarity" ADD CONSTRAINT "PlayerFamiliarity_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_secondaryPlayerId_fkey" FOREIGN KEY ("secondaryPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchStatistic" ADD CONSTRAINT "MatchStatistic_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerMatchPerformance" ADD CONSTRAINT "PlayerMatchPerformance_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerMatchPerformance" ADD CONSTRAINT "PlayerMatchPerformance_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerMatchPerformance" ADD CONSTRAINT "PlayerMatchPerformance_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDecision" ADD CONSTRAINT "AiDecision_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDecision" ADD CONSTRAINT "AiDecision_matchdayId_fkey" FOREIGN KEY ("matchdayId") REFERENCES "Matchday"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDecision" ADD CONSTRAINT "AiDecision_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDecision" ADD CONSTRAINT "AiDecision_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMemory" ADD CONSTRAINT "AiMemory_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_matchdayId_fkey" FOREIGN KEY ("matchdayId") REFERENCES "Matchday"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
