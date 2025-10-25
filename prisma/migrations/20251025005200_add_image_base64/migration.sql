-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "imageBase64" TEXT;

-- AlterTable
ALTER TABLE "pending_messages" ADD COLUMN     "imageBase64" TEXT;
