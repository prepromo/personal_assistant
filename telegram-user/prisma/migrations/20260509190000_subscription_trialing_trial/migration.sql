-- Новый статус пробного периода после регистрации на сайте (register-web).
ALTER TYPE "CabinetSubscriptionStatus" ADD VALUE 'trialing';

ALTER TABLE "CabinetSubscription" ADD COLUMN "trialEndsAt" TIMESTAMP(3);
