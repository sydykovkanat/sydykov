-- AlterTable
ALTER TABLE "pending_messages" ADD COLUMN     "isOwnerMessage" BOOLEAN NOT NULL DEFAULT false;
