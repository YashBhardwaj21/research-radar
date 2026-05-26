# Distributed Semantic Aggregation Pipeline

A multi-source literature retrieval platform combining headless browser automation (Playwright), semantic search, vector embeddings (Ollama), distributed task queues (BullMQ), Redis caching, and PostgreSQL (pgvector).


![Node](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=for-the-badge&logo=Playwright&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2CA5E0?style=for-the-badge&logo=docker&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)

---

## Overview

This project serves as an experimental data pipeline and retrieval API. It is designed to autonomously fetch, normalize, embed, and rank scientific literature from disparate sources using a unified interface, while handling the complexities of web scraping, rate limits, and asynchronous background jobs.

---

## Problem Statement

Scientific literature is heavily fragmented across platforms like PubMed and Arxiv. Simple keyword search often misses highly relevant papers due to differences in terminology.

This platform bridges that gap by aggregating literature, normalizing metadata, generating localized semantic embeddings, and exposing a unified retrieval API that ranks results via cosine similarity.

---

## Architecture

```mermaid
graph TD
    User([Client/User]) -->|POST /api/v1/search| API[Fastify API]
    API -->|Cache Hit| Redis[(Redis Cache)]
    API -->|Cache Miss / Enqueue| Queue[BullMQ Queue]
    
    Queue -->|Consume| Worker[Scraping Worker]
    
    Worker -->|Playwright| P[PubMed]
    Worker -->|Playwright| A[Arxiv]
    
    Worker -->|Normalize| Dedup[Deduplicator Engine]
    Dedup -->|Persist| PG[(PostgreSQL)]
    
    Dedup -->|Enqueue| EmbedQueue[Embedding Queue]
    EmbedQueue -->|Consume| EmbedWorker[Embedding Worker]
    
    EmbedWorker -->|HTTP| Ollama[Local Ollama]
    Ollama -->|Vector 768d| EmbedWorker
    EmbedWorker -->|Update| PG
    
    API -->|Vector Search| PG
```

---

## Database Schema

### Core Entities

#### `Source`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| **`id`** | `String` | Primary Key | Unique UUID |
| **`name`** | `String` | Unique | Name of the repository (e.g., pubmed, arxiv) |
| **`health`** | `Enum` | | Current API health (`HEALTHY`, `COOLDOWN`) |

#### `Paper`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| **`id`** | `String` | Primary Key | Unique UUID |
| **`title`** | `String` | | Full title of the paper |
| **`abstract`** | `String` | Nullable | Summary of the paper |
| **`doi`** | `String` | Unique | Digital Object Identifier |
| **`url`** | `String` | Unique | Canonical URL to the paper |
| **`year`** | `Int` | Nullable | Year of publication |
| **`sourceId`** | `String` | Foreign Key | References `Source.id` |
| **`embedding`**| `Vector(768)`| Nullable | Generated `nomic-embed-text` pgvector |

#### `Author`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| **`id`** | `String` | Primary Key | Unique UUID |
| **`name`** | `String` | Unique | Full name of the author |

#### `ScrapeJob`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| **`id`** | `String` | Primary Key | Job ID from BullMQ |
| **`status`** | `Enum` | | `PENDING`, `RUNNING`, `FAILED`, `COMPLETED` |
| **`retries`** | `Int` | Default `0` | Number of times the job has been retried |
| **`startedAt`**| `DateTime` | | When the extraction started |

*Note: `Paper` and `Author` are linked via a many-to-many join table `PaperAuthor`.*

---

## Tech Stack

| Layer | Tool | Purpose |
|-------|------|---------|
| **Scraping** | Playwright | Headless browser automation, anti-bot evasion |
| **Queue** | BullMQ | Distributed task orchestration and retries |
| **Cache** | Redis | Ephemeral storage and API response caching |
| **DB** | PostgreSQL | Relational metadata persistence |
| **Vector DB** | pgvector | Cosine similarity ranking |
| **ORM** | Prisma | Type-safe database querying and migrations |
| **Embeddings** | Ollama | Local inference for `nomic-embed-text` |
| **Runtime** | Node.js / TS | Core execution environment |
| **Container** | Docker | Orchestration for backing services |

---

## Folder Structure

```text
src/
├── api/
│   ├── search.ts              # Fastify REST endpoints
│   └── health.ts              # Circuit breaker status checks
├── browser/
│   ├── BrowserManager.ts      # Playwright lifecycle manager
│   ├── ContextPool.ts         # Browser context pooling
│   └── RequestFilter.ts       # Network interception (ad blocking)
├── core/
│   └── config.ts              # Environment & fallback configs
├── extractors/
│   ├── BaseExtractor.ts       # Abstract interface
│   ├── PubMedExtractor.ts     # PubMed scraping logic
│   └── ArxivExtractor.ts      # Arxiv scraping logic
├── health/
│   └── SourceHealthManager.ts # Rate limit cooldowns
├── observability/
│   └── metrics.ts             # Prometheus counters & histograms
├── processing/
│   ├── Deduplicator.ts        # Levenshtein fuzzy matching & insertion
│   └── EmbeddingService.ts    # Ollama HTTP client
└── queue/
    ├── worker.ts              # BullMQ scraping consumer
    └── embeddingWorker.ts     # BullMQ vector consumer
```

---

### Running From a Clean Machine

1. **Clone & Install**
   ```bash
   git clone <repo-url>
   cd automation
   npm install
   npx playwright install --with-deps
   ```

2. **Start Docker Infrastructure** (Postgres + Redis)
   ```bash
   docker-compose up -d
   ```

3. **Initialize Database**
   ```bash
   npx prisma generate
   npx prisma migrate dev
   npm run build
   ```

4. **Start Ollama** (Ensure `nomic-embed-text` is pulled)
   ```bash
   ollama pull nomic-embed-text
   ```

5. **Boot the Pipeline**
   ```bash
   npm run start-all
   ```

### Environment Variables

Create a `.env` file in the root directory:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/pipeline"
POSTGRES_URL="postgresql://postgres:postgres@localhost:5432/pipeline"
REDIS_URL="redis://localhost:6379/0"
OLLAMA_BASE_URL="http://localhost:11434"
EMBEDDING_MODEL="nomic-embed-text"
API_KEY="default-secret-key-change-me"
ENVIRONMENT="development"
LOG_LEVEL="info"
```

---



---

## Pipeline Flow

1. **User Query**: Client submits a search request.
2. **API Dispatch**: API queues a job in BullMQ if cache misses.
3. **Extraction**: Worker allocates a Playwright context and targets PubMed/Arxiv.
4. **Normalization**: DOM data is parsed into a unified JSON format.
5. **Deduplication**: Payload passes through exact URL/DOI matching and Levenshtein fuzzy-title matching.
6. **Persistence**: Unique records are saved to PostgreSQL.
7. **Embedding**: Secondary queue triggers local Ollama to generate a 768d vector.
8. **Semantic Search**: Vectors are mathematically compared (`<=>`) using pgvector and ranked.

---

## API Documentation

### 1. Trigger Scrape Job

`POST /api/jobs`

**cURL (Mac/Linux):**
```bash
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -H "x-api-key: default-secret-key-change-me" \
  -d '{"source": "pubmed", "query": "Artificial Intelligence in Psychiatry", "maxResults": 2}'
```

**PowerShell (Windows):**
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/jobs" `
  -Method POST `
  -Headers @{ "Content-Type" = "application/json"; "x-api-key" = "default-secret-key-change-me" } `
  -Body '{"source": "pubmed", "query": "Artificial Intelligence in Psychiatry", "maxResults": 2}'
```

### 2. Semantic Search

`POST /api/v1/search`

**cURL (Mac/Linux):**
```bash
curl -X POST http://localhost:3000/api/v1/search \
  -H "Content-Type: application/json" \
  -H "x-api-key: default-secret-key-change-me" \
  -d '{"query": "neural networks inspired by human brain", "source": "pubmed", "limit": 2}'
```

**PowerShell (Windows):**
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/search" `
  -Method POST `
  -Headers @{ "Content-Type" = "application/json"; "x-api-key" = "default-secret-key-change-me" } `
  -Body '{"query": "neural networks inspired by human brain", "source": "pubmed", "limit": 2}'
```

**Response:**
*(Real system output demonstrating 500-char abstract truncation and mathematical fallback scoring)*
```json
{
  "query": "neural networks inspired by human brain",
  "count": 2,
  "results": [
    {
      "title": "[Artificial neural networks as a psychiatric instrument]",
      "authors": [
        "J Van den Stock",
        "J Vennekens",
        "H Op de Beeck",
        "L Mertens",
        "E Yargholi"
      ],
      "abstract": "Background: Artificial intelligence (AI) has evolved enormously over the past decade and is increasingly being applied to a range of domains, including psychiatry. AI encompasses several modalities, including artificial neural networks (ANNs), referring to computer models partly based on the workings of the brain. ANNs have existed since the \u201950s, but only became \u2018mainstream\u2019 since the 2010s. The fact that they are inspired by the workings of the brain raises the question of wh...",
      "source": "pubmed",
      "year": null,
      "url": "https://pubmed.ncbi.nlm.nih.gov/38174402/",
      "score": 0.5836
    },
    {
      "title": "Artificial neural networks and deep learning",
      "authors": [
        "Dirk Valkenborg",
        "Axel-Jan Rousseau",
        "Melvin Geubbelmans",
        "Tomasz Burzykowski"
      ],
      "abstract": "Deep learning focuses on the use of artificial neural networks (ANNs), a collection of machine learning algorithms whose architecture is inspired by the human brain. Although the first ANN was proposed more than 70 years ago, deep learning has gained immense popularity in the last decade...",
      "source": "pubmed",
      "year": null,
      "url": "https://pubmed.ncbi.nlm.nih.gov/38302219/",
      "score": 0.5786
    }
  ],
  "warning": "fresh scrape scheduled" 
}
```

---

## Debugging & Observability

### 1. Queue Dashboard (BullMQ)
The platform includes an embedded UI to monitor distributed background jobs.
1. Run `npm run api` (ensure you have compiled the code first with `npm run build`).
2. Open your browser and navigate to: **http://localhost:3001/ui**
3. You will see a dashboard showing all active, pending, completed, and failed scraping jobs across the queues.

### 2. Visual Playwright Scraping
By default, the platform scrapes the literature sources headlessly (invisible to the user). If you want to visually observe what the robots are doing:
1. Open your `.env` file and change `BROWSER_HEADLESS=true` to `BROWSER_HEADLESS=false`.
2. Restart `npm run worker`. 
3. When you trigger a scrape job, an actual Chromium browser window will pop up, allowing you to watch the automation in real-time.

### 3. Playwright Trace Viewer (For E2E Tests)
If one of the automated tests fails (e.g., when running `npx playwright test`), Playwright will automatically generate a trace zip file. To open the time-travel trace viewer, run:
```bash
npx playwright show-trace test-results/<name-of-failed-test-folder>/trace.zip
```
This launches a UI where you can scrub through a timeline of exactly what the browser did before the test failed, including network requests, console logs, and DOM snapshots.

---

## Screenshots

### 1. Queue Orchestration — BullMQ Dashboard
Shows worker creation, job assignment, extractor startup, timeout configuration, and query execution.

<img width="1600" height="790" alt="Worker Startup Logs" src="https://github.com/user-attachments/assets/41e177d5-bbef-4774-b0d7-a84876f1a42e" />

---

### 2. Worker Lifecycle — Job Initialization & Extractor Startup
Demonstrates asynchronous job execution, completed jobs, retries, and queue state monitoring.

<img width="972" height="1030" alt="BullMQ Queue Dashboard" src="https://github.com/user-attachments/assets/e8bcbdb7-19be-439f-af62-eb7ab26acb20" />

---

### 3. Semantic Search Output — API Response
Example response returned by `/api/v1/search`, showing semantic ranking, abstracts, metadata, and similarity scores.

<img width="1600" height="967" alt="API Search Response" src="https://github.com/user-attachments/assets/5505066d-fcee-46cc-8cf6-e608ad4d904d" />

---

### 4. Playwright Navigation — URL Construction & DOM Interaction
Shows navigation success, selector waits, and result discovery during multi-source extraction.

<img width="1316" height="846" alt="Navigation Logs" src="https://github.com/user-attachments/assets/0a0940d6-6f91-448b-8d71-ae9638cd27f2" />

---

### 5. Extraction Pipeline — Parsing & Metadata Collection
Demonstrates extraction of titles, authors, abstracts, and structured paper metadata.

<img width="1215" height="819" alt="Extraction Logs" src="https://github.com/user-attachments/assets/0dc666cb-ff9d-47f7-8e0f-ab42295bde37" />

---

### 6. Persistence Layer — Deduplication & Database Ingestion
Shows duplicate detection, Prisma persistence, browser context cleanup, and successful job completion.

<img width="1021" height="990" alt="Deduplication Logs" src="https://github.com/user-attachments/assets/739ff2e6-a2c8-4060-a363-9127763c0172" />

---

---

## Playwright Engineering Decisions

Playwright was chosen over standard HTTP clients (Axios + Cheerio) due to the heavy reliance of modern academic repositories on client-side rendering and bot protection.

- **Context Pooling**: Instantiating full browsers per request is too slow. The platform maintains a pool of persistent `BrowserContext` instances to reduce overhead.
- **Request Interception**: `page.route()` is used to aggressively block image, font, and CSS requests to lower bandwidth and speed up extraction.
- **HTML Snapshots & Tracing**: On selector timeouts or crashes, the worker automatically invokes `context.tracing.stop({ path: trace.zip })` to save a debuggable artifact of the failure.
- **Network Idle vs DOMContentLoaded**: Switched to `domcontentloaded` with explicit locator waits to avoid false-negative timeouts on pages with hanging tracking scripts.

---

## Architecture Tradeoffs

- **Why BullMQ over RabbitMQ?** BullMQ operates directly on Redis, which was already required for API caching. This reduced infrastructure complexity while still providing delayed jobs, rate limiting, and parent-child flows.
- **Why pgvector over Pinecone?** Storing embeddings alongside relational metadata (titles, authors) in PostgreSQL simplifies architecture, allows for ACID transactions, and eliminates the risk of sync drift between the database and an external vector index.
- **Why Ollama over OpenAI?** Running `nomic-embed-text` locally via Ollama ensures zero API costs during heavy scraping, and prevents rate-limit bottlenecks when processing thousands of papers concurrently.

---

## Engineering Challenges & Solutions

**1. Problem: PubMed CAPTCHA and Rate Limiting**
Frequent requests to PubMed triggered CAPTCHA blocks.
**Solution:** Implemented Playwright request interception to strip identifying bot headers, alongside a circuit breaker (`SourceHealthManager`) that puts the source in `COOLDOWN` status when rate limits are detected.

**2. Problem: Arxiv Selector Instability**
Arxiv occasionally returned alternate DOM structures, causing `waitForSelector` to hang and consume memory.
**Solution:** Bound strict timeouts to locators and implemented an automated Playwright trace capture (`debugSnapshot()`) on catch blocks to inspect the DOM offline.

**3. Problem: Database Unique Constraint Collisions**
Concurrent workers occasionally scraped the same popular paper from different sources at the exact same time, crashing the worker on Prisma's unique constraint.
**Solution:** Wrapped Prisma inserts in a `try/catch`. On violation, the worker queries the existing ID and gracefully falls back rather than crashing the job.

---

## Observability & Monitoring

The platform exposes production-inspired telemetry:
- **Prometheus Metrics**: `http://localhost:9090/metrics` (Exposes active workers, queue depth, and scrape latency).
- **Structured Logging**: Uses `Pino` to log context (`CACHE MISS`, `NAVIGATION_OK`, `PARSED`) for easy grep-based debugging.

---

## Testing

Integration and extraction testing are verified via Playwright Test.

```bash
npx playwright test
```
*Covers deduplication edge cases, fallback query parsing, and network interception logic.*

---

## Benchmarks


**Results:**
- PubMed Extraction: ~12 sec
- Arxiv Extraction: ~7 sec
- Vector Generation: ~800 ms / paper
- Semantic Search (API DB Hit): ~150 ms
- Cache Hit (Redis): < 15 ms

---

## Future Work

- **Hybrid Retrieval**: Combine BM25 keyword search with cosine similarity (Alpha = 0.5) for improved recall.
- **Kubernetes Deployment**: Migrate from Docker Compose to K8s to test horizontal pod autoscaling for the extraction workers.
- **RAG Integration**: Pipe the extracted abstracts directly into an LLM context window to generate automated literature review summaries.
