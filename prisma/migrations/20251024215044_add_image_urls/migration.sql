-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "pending_messages" ADD COLUMN     "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
