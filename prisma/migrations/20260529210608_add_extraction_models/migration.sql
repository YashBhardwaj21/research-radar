-- AlterTable
ALTER TABLE "Paper" ADD COLUMN     "pdfUrl" TEXT;

-- CreateTable
CREATE TABLE "PaperContent" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "fullText" TEXT NOT NULL,
    "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchTask" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "ResearchTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Modality" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Modality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Condition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Condition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dataset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Method" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Method_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Metric" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Metric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperExtraction" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "limitations" TEXT,
    "futureWork" TEXT,
    "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperResearchTask" (
    "paperId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,

    CONSTRAINT "PaperResearchTask_pkey" PRIMARY KEY ("paperId","taskId")
);

-- CreateTable
CREATE TABLE "PaperModality" (
    "paperId" TEXT NOT NULL,
    "modalityId" TEXT NOT NULL,

    CONSTRAINT "PaperModality_pkey" PRIMARY KEY ("paperId","modalityId")
);

-- CreateTable
CREATE TABLE "PaperCondition" (
    "paperId" TEXT NOT NULL,
    "conditionId" TEXT NOT NULL,

    CONSTRAINT "PaperCondition_pkey" PRIMARY KEY ("paperId","conditionId")
);

-- CreateTable
CREATE TABLE "PaperDataset" (
    "paperId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,

    CONSTRAINT "PaperDataset_pkey" PRIMARY KEY ("paperId","datasetId")
);

-- CreateTable
CREATE TABLE "PaperMethod" (
    "paperId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,

    CONSTRAINT "PaperMethod_pkey" PRIMARY KEY ("paperId","methodId")
);

-- CreateTable
CREATE TABLE "PaperMetric" (
    "paperId" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,

    CONSTRAINT "PaperMetric_pkey" PRIMARY KEY ("paperId","metricId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaperContent_paperId_key" ON "PaperContent"("paperId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchTask_name_key" ON "ResearchTask"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Modality_name_key" ON "Modality"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Condition_name_key" ON "Condition"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Dataset_name_key" ON "Dataset"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Method_name_key" ON "Method"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Metric_name_key" ON "Metric"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PaperExtraction_paperId_key" ON "PaperExtraction"("paperId");

-- AddForeignKey
ALTER TABLE "PaperContent" ADD CONSTRAINT "PaperContent_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperExtraction" ADD CONSTRAINT "PaperExtraction_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperResearchTask" ADD CONSTRAINT "PaperResearchTask_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperResearchTask" ADD CONSTRAINT "PaperResearchTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ResearchTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperModality" ADD CONSTRAINT "PaperModality_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperModality" ADD CONSTRAINT "PaperModality_modalityId_fkey" FOREIGN KEY ("modalityId") REFERENCES "Modality"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperCondition" ADD CONSTRAINT "PaperCondition_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperCondition" ADD CONSTRAINT "PaperCondition_conditionId_fkey" FOREIGN KEY ("conditionId") REFERENCES "Condition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperDataset" ADD CONSTRAINT "PaperDataset_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperDataset" ADD CONSTRAINT "PaperDataset_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperMethod" ADD CONSTRAINT "PaperMethod_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperMethod" ADD CONSTRAINT "PaperMethod_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "Method"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperMetric" ADD CONSTRAINT "PaperMetric_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperMetric" ADD CONSTRAINT "PaperMetric_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "Metric"("id") ON DELETE CASCADE ON UPDATE CASCADE;
