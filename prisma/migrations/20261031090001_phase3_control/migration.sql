-- Phase 3: control + app registry. Additive only (ALTER ADD COLUMN), so it merges with Phase 2 relay migrations.

-- Host: desired-policy revision and drift healing switch
ALTER TABLE "Host" ADD COLUMN "policyRev" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Host" ADD COLUMN "pushedPolicyRev" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Host" ADD COLUMN "lastConfigPushAt" DATETIME;
ALTER TABLE "Host" ADD COLUMN "reconcileEnabled" BOOLEAN NOT NULL DEFAULT true;

-- App: health probe, public API token, sidecar token
ALTER TABLE "App" ADD COLUMN "probeUrl" TEXT;
ALTER TABLE "App" ADD COLUMN "apiTokenHash" TEXT;
ALTER TABLE "App" ADD COLUMN "apiTokenHint" TEXT;
ALTER TABLE "App" ADD COLUMN "apiScopes" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "App" ADD COLUMN "apiTokenAt" DATETIME;
ALTER TABLE "App" ADD COLUMN "sidecarTokenEnc" TEXT;
CREATE UNIQUE INDEX "App_apiTokenHash_key" ON "App"("apiTokenHash");

-- AppMode: container kind and per-OS default models
ALTER TABLE "AppMode" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'ollama';
ALTER TABLE "AppMode" ADD COLUMN "defaultModels" TEXT NOT NULL DEFAULT '{}';

-- Reconcile loop memory
CREATE TABLE "ReconcileState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hostId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "tries" INTEGER NOT NULL DEFAULT 0,
    "lastTryAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "gaveUp" BOOLEAN NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX "ReconcileState_hostId_appId_mode_key" ON "ReconcileState"("hostId", "appId", "mode");
