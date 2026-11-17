-- AlterTable
ALTER TABLE "Host" ADD COLUMN "hostname" TEXT;
ALTER TABLE "Host" ADD COLUMN "liveStatus" TEXT;

-- CreateTable
CREATE TABLE "HostAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hostId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'soundsuite-import',
    "firstSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HostAlias_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Command" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hostId" TEXT,
    "sidecarUrl" TEXT NOT NULL,
    "appId" TEXT NOT NULL DEFAULT 'sidecarmaster',
    "action" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" TEXT,
    "requestedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "Command_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "HostAlias_url_key" ON "HostAlias"("url");

-- CreateIndex
CREATE INDEX "HostAlias_hostId_idx" ON "HostAlias"("hostId");

-- CreateIndex
CREATE INDEX "Command_sidecarUrl_status_idx" ON "Command"("sidecarUrl", "status");

-- CreateIndex
CREATE INDEX "Command_status_expiresAt_idx" ON "Command"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Host_hostname_idx" ON "Host"("hostname");

