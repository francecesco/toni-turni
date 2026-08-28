-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Roster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "ward" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "imagePath" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "provider" TEXT,
    "rawOutput" TEXT,
    "missingBands" TEXT,
    "conflicts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Roster" ("createdAt", "id", "imagePath", "missingBands", "month", "provider", "rawOutput", "status", "version", "ward", "year") SELECT "createdAt", "id", "imagePath", "missingBands", "month", "provider", "rawOutput", "status", "version", "ward", "year" FROM "Roster";
DROP TABLE "Roster";
ALTER TABLE "new_Roster" RENAME TO "Roster";
CREATE UNIQUE INDEX "Roster_year_month_ward_version_key" ON "Roster"("year", "month", "ward", "version");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
