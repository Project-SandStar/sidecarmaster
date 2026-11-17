
-- CreateTable
CREATE TABLE "ReleaseHost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "releaseId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReleaseHost_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HeartbeatSample" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hostId" TEXT NOT NULL,
    "at" DATETIME NOT NULL,
    "online" BOOLEAN NOT NULL,
    "activeRequests" INTEGER,
    "vramUsedMb" INTEGER,
    "vramTotalMb" INTEGER,
    "gpuUtilPct" REAL,
    "diskFreePct" REAL,
    "containersRunning" INTEGER
);

-- CreateTable
CREATE TABLE "HeartbeatHourly" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hostId" TEXT NOT NULL,
    "hour" DATETIME NOT NULL,
    "samples" INTEGER NOT NULL,
    "onlineSamples" INTEGER NOT NULL,
    "avgActiveRequests" REAL,
    "maxActiveRequests" INTEGER,
    "maxVramPct" REAL,
    "minDiskFreePct" REAL
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "state" TEXT NOT NULL DEFAULT 'open',
    "hostId" TEXT,
    "appId" TEXT,
    "message" TEXT NOT NULL,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackedAt" DATETIME,
    "ackedBy" TEXT,
    "closedAt" DATETIME,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "notifiedAt" DATETIME
);

-- CreateTable
CREATE TABLE "AlertMute" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rule" TEXT,
    "hostId" TEXT,
    "appId" TEXT,
    "until" DATETIME NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Release" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'stable',
    "version" TEXT NOT NULL,
    "build" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "notes" TEXT,
    "minOS" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "filePath" TEXT,
    "fileName" TEXT,
    "size" INTEGER,
    "gitlabTag" TEXT,
    "rollout" TEXT NOT NULL DEFAULT 'all',
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Release" ("build", "channel", "createdAt", "id", "minOS", "notes", "platform", "product", "sha256", "url", "version") SELECT "build", "channel", "createdAt", "id", "minOS", "notes", "platform", "product", "sha256", "url", "version" FROM "Release";
DROP TABLE "Release";
ALTER TABLE "new_Release" RENAME TO "Release";
CREATE INDEX "Release_product_platform_channel_idx" ON "Release"("product", "platform", "channel");
CREATE UNIQUE INDEX "Release_product_platform_channel_build_key" ON "Release"("product", "platform", "channel", "build");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseHost_releaseId_hostId_key" ON "ReleaseHost"("releaseId", "hostId");

-- CreateIndex
CREATE INDEX "HeartbeatSample_hostId_at_idx" ON "HeartbeatSample"("hostId", "at");

-- CreateIndex
CREATE INDEX "HeartbeatSample_at_idx" ON "HeartbeatSample"("at");

-- CreateIndex
CREATE INDEX "HeartbeatHourly_hour_idx" ON "HeartbeatHourly"("hour");

-- CreateIndex
CREATE UNIQUE INDEX "HeartbeatHourly_hostId_hour_key" ON "HeartbeatHourly"("hostId", "hour");

-- CreateIndex
CREATE INDEX "Alert_key_state_idx" ON "Alert"("key", "state");

-- CreateIndex
CREATE INDEX "Alert_state_openedAt_idx" ON "Alert"("state", "openedAt");

-- CreateIndex
CREATE INDEX "AlertMute_until_idx" ON "AlertMute"("until");

