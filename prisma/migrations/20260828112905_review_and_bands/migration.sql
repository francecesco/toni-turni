-- AlterTable
ALTER TABLE "Roster" ADD COLUMN "error" TEXT;
ALTER TABLE "Roster" ADD COLUMN "heartbeatAt" DATETIME;
ALTER TABLE "Roster" ADD COLUMN "requestedAt" DATETIME;

-- CreateTable
CREATE TABLE "ColumnAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "userId" TEXT,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ColumnAlias_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RosterBand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rosterId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "rawOutput" TEXT,
    "dayFrom" INTEGER,
    "dayTo" INTEGER,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RosterBand_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "Roster" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RosterCell" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rosterId" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "columnLabel" TEXT NOT NULL,
    "rawCode" TEXT NOT NULL,
    "code" TEXT,
    "confidence" REAL NOT NULL,
    "handCorrected" BOOLEAN NOT NULL DEFAULT false,
    "conflicted" BOOLEAN NOT NULL DEFAULT false,
    "conflictWith" TEXT,
    "bandIndex" INTEGER,
    CONSTRAINT "RosterCell_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "Roster" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_RosterCell" ("code", "columnLabel", "confidence", "day", "handCorrected", "id", "rawCode", "rosterId") SELECT "code", "columnLabel", "confidence", "day", "handCorrected", "id", "rawCode", "rosterId" FROM "RosterCell";
DROP TABLE "RosterCell";
ALTER TABLE "new_RosterCell" RENAME TO "RosterCell";
CREATE UNIQUE INDEX "RosterCell_rosterId_day_columnLabel_key" ON "RosterCell"("rosterId", "day", "columnLabel");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ColumnAlias_label_key" ON "ColumnAlias"("label");

-- CreateIndex
CREATE UNIQUE INDEX "RosterBand_rosterId_index_key" ON "RosterBand"("rosterId", "index");
