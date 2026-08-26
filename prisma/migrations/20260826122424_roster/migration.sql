-- CreateTable
CREATE TABLE "Roster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "ward" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "imagePath" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "provider" TEXT,
    "rawOutput" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RosterCell" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rosterId" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "columnLabel" TEXT NOT NULL,
    "rawCode" TEXT NOT NULL,
    "code" TEXT,
    "confidence" REAL NOT NULL,
    "handCorrected" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "RosterCell_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "Roster" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Roster_year_month_ward_version_key" ON "Roster"("year", "month", "ward", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RosterCell_rosterId_day_columnLabel_key" ON "RosterCell"("rosterId", "day", "columnLabel");
