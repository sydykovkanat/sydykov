-- CreateTable
CREATE TABLE "user_facts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "fact" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_facts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_facts_userId_idx" ON "user_facts"("userId");

-- CreateIndex
CREATE INDEX "user_facts_category_idx" ON "user_facts"("category");

-- AddForeignKey
ALTER TABLE "user_facts" ADD CONSTRAINT "user_facts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
