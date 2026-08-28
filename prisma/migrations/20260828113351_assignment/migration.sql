-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "columnLabel" TEXT,
    "code" TEXT NOT NULL,
    "confirmedAt" DATETIME,
    "eventId" TEXT,
    "syncState" TEXT NOT NULL DEFAULT 'draft',
    "syncError" TEXT,
    "syncedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Assignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Assignment_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "Roster" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_userId_rosterId_day_key" ON "Assignment"("userId", "rosterId", "day");
