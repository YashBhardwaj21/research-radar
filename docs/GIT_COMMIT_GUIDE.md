# Research Radar — Git Commit Guide

This document provides a step-by-step guide to commit the entire project to GitHub
using atomic, well-scoped commits organized by milestone and feature area.

Your existing commit history already covers early M1 work. The commands below
cover everything that is currently **untracked or modified**.

---

## Pre-Flight: Update .gitignore

```bash
git add .gitignore
git commit -m "chore: update .gitignore for Prisma generated client and env"
```

---

## Milestone 1: Core Browser Automation Infrastructure

### Commit 1 — DevOps: Docker, Config, Logging

```bash
git add docker-compose.yml docker/ package.json package-lock.json playwright.config.ts
git add src/core/
git commit -m "feat(infra): add Docker Compose stack, centralized config, and structured Pino logging"
```

### Commit 2 — Advanced Browser Middleware

```bash
git add src/browser/BrowserManager.ts src/browser/NetworkInterceptor.ts src/browser/RequestFilter.ts
git commit -m "feat(browser): add crash recovery, network interception, and ad/tracker request filtering"
```

### Commit 3 — Multi-Source Extractors

```bash
git add src/extractors/BaseExtractor.ts src/extractors/PubMedExtractor.ts
git add src/extractors/ArxivExtractor.ts src/extractors/SemanticScholarExtractor.ts
git commit -m "feat(extractors): implement PubMed, arXiv, and Semantic Scholar extractors"
```

### Commit 4 — M1 Verification Script

```bash
git add src/verify-m1.ts
git commit -m "test(m1): add Milestone 1 integration verification script"
```

### Commit 5 — M1 Technical Audit

```bash
git add docs/audit/milestone_1_technical_audit.md
git commit -m "docs(audit): add Milestone 1 technical audit report"
```

---

## Milestone 2: Distributed Browser Orchestration

### Commit 6 — Health & Circuit Breaking

```bash
git add src/health/SourceHealthManager.ts src/health/WorkerHealth.ts
git commit -m "feat(health): implement sliding-window circuit breaker and worker health tracking"
```

### Commit 7 — Orchestration Layer

```bash
git add src/orchestrator/ExtractorFactory.ts src/orchestrator/JobRunner.ts
git commit -m "feat(orchestrator): add ExtractorFactory and strict timeout JobRunner"
```

### Commit 8 — BullMQ Queue Infrastructure

```bash
git add src/queue/QueueManager.ts src/queue/types.ts src/queue/worker.ts src/queue/bull-board.ts
git commit -m "feat(queue): implement BullMQ scrape queue, idempotent job IDs, worker with graceful shutdown"
```

### Commit 9 — Prometheus Observability

```bash
git add src/observability/metrics.ts src/observability/metricsServer.ts
git commit -m "feat(observability): add Prometheus metrics and Fastify /metrics endpoint"
```

### Commit 10 — M2 Verification Script

```bash
git add src/verify-m2.ts
git commit -m "test(m2): add Milestone 2 stress test verification script (60-job queue)"
```

### Commit 11 — M2 Technical Audit

```bash
git add docs/audit/milestone_2_technical_audit.md
git commit -m "docs(audit): add Milestone 2 technical audit report"
```

---

## Milestone 3: Database Persistence & Semantic Vector Search

### Commit 12 — Prisma Schema & Migrations

```bash
git add prisma.config.ts prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add normalized Prisma schema with pgvector, enums, HNSW index, and initial migration"
```

### Commit 13 — Deduplication & Embedding Service

```bash
git add src/processing/Deduplicator.ts src/processing/EmbeddingService.ts
git commit -m "feat(processing): add hierarchical deduplicator and Ollama embedding service"
```

### Commit 14 — Embedding Worker (Two-Stage Pipeline)

```bash
git add src/queue/embeddingWorker.ts
git commit -m "feat(queue): add embedding worker for two-stage async ingestion pipeline"
```

### Commit 15 — Search API

```bash
git add src/api/search.ts
git commit -m "feat(api): add POST /api/search with pgvector cosine similarity, filters, and pagination"
```

### Commit 16 — Playwright Tests (if any)

```bash
git add tests/
git commit -m "test: add Playwright test configuration and fixtures"
```

---

## Final: Push to GitHub

```bash
git push origin main
```

---

## Remaining Milestones

### ✅ Milestone 1 — Core Browser Automation Infrastructure (COMPLETE)
### ✅ Milestone 2 — Distributed Browser Orchestration (COMPLETE)
### ✅ Milestone 3 — Database Persistence & Semantic Vector Search (COMPLETE — pending verification with live Ollama)

### ⬜ Milestone 4 — Production Hardening (KEEP SMALL)
- Health endpoints (`/health`, `/ready`, `/live`)
- Environment config (`.env.example`)
- Structured logging (Pino, `job_id`, `worker_id`)
- Docker (`Dockerfile.worker`, `Dockerfile.api`, `docker-compose.yml`)
- CI/CD pipeline (GitHub Actions with lint, build, test)
- Graceful shutdown verification (`SIGINT`, `SIGTERM`)

### ⬜ Milestone 5 — Demo & Observability (MOST IMPORTANT)
- Queue Status API (`GET /api/jobs`)
- Metrics API (`GET /metrics`)
- Export API (`POST /export` for CSV, JSON, BibTeX)
- Swagger Docs (`/docs`)
- Playwright Failure Replay ⭐ (Store traces, `npm run replay-job`)
- Block/CAPTCHA Detection (Detect 403/captcha, trigger cooldowns)

### ⬜ Milestone 6 — Research Intelligence (Optional Enhancements)
- CitationGraphService (`GET /paper/:id/citations`, `GET /paper/:id/network`)
- TrendAnalyzer (`GET /trends?topic=X`)
- QueryExpansion (Dictionary + synonyms)
- LLMAnalyzer (Async Ollama summary/keywords)
