-- DropIndex
DROP INDEX "paper_embedding_idx";

-- AlterTable
ALTER TABLE "Paper" ADD COLUMN     "embeddingModel" TEXT,
ADD COLUMN     "extractorVersion" TEXT,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "originatingQuery" TEXT,
ADD COLUMN     "pipelineVersion" TEXT,
ADD COLUMN     "scrapedAt" TIMESTAMP(3);
