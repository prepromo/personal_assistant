-- CreateEnum
CREATE TYPE "CabinetSubscriptionStatus" AS ENUM ('pending_payment', 'active', 'canceled');

-- CreateTable
CREATE TABLE "CabinetSubscription" (
    "id" TEXT NOT NULL,
    "cabinetUserId" TEXT NOT NULL,
    "status" "CabinetSubscriptionStatus" NOT NULL DEFAULT 'pending_payment',
    "planCode" TEXT NOT NULL DEFAULT 'monthly',
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CabinetSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CabinetSubscription_cabinetUserId_key" ON "CabinetSubscription"("cabinetUserId");

ALTER TABLE "CabinetSubscription" ADD CONSTRAINT "CabinetSubscription_cabinetUserId_fkey" FOREIGN KEY ("cabinetUserId") REFERENCES "CabinetUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
