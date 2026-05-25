# Distributed Semantic Aggregation Pipeline

A multi-source literature retrieval platform combining headless browser automation (Playwright), semantic search, vector embeddings (Ollama), distributed task queues (BullMQ), Redis caching, and PostgreSQL (pgvector).

**What this project demonstrates:**
✓ Playwright automation & anti-bot handling
✓ Distributed background workers
✓ Queue systems & retry logic
✓ Vector databases & semantic search
✓ Docker & container orchestration
✓ PostgreSQL & Prisma ORM
✓ Redis caching
✓ Local AI embeddings
✓ Systems thinking & failure handling

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

```mermaid
erDiagram
    Source ||--o{ Paper : "contains"
    Paper ||--o{ PaperAuthor : "has"
    Author ||--o{ PaperAuthor : "writes"
    
    Source {
        String id PK
        String name UK
        String health
    }
    
    Paper {
        String id PK
        String title
        String abstract
        String doi UK
        String url UK
        Int year
        String sourceId FK
        Unsupported embedding "vector(768)"
        DateTime scrapedAt
    }
    
    Author {
        String id PK
        String name UK
    }
    
    ScrapeJob {
        String id PK
        String status
        Int retries
        DateTime startedAt
    }
```

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
   ```

2. **Start Docker Infrastructure** (Postgres + Redis)
   ```bash
   docker-compose up -d
   ```

3. **Initialize Database**
   ```bash
   npx prisma migrate dev
   npx prisma generate
   ```

4. **Start Ollama** (Ensure `nomic-embed-text` is pulled)
   ```bash
   ollama run nomic-embed-text
   ```

5. **Boot the Pipeline** (in 3 separate terminals)
   ```bash
   npm run api
   npm run worker
   npm run embedding-worker
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

**Request:**
```json
{
  "source": "all",
  "query": "large language models",
  "maxResults": 3,
  "refresh": true
}
```

### 2. Semantic Search

`POST /api/v1/search`

**Request:**
```json
{
  "query": "large language models architecture",
  "limit": 2
}
```

**Response:**
*(Real system output demonstrating 500-char abstract truncation and mathematical fallback scoring)*
```json
{
  "query": "large language models architecture",
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

## Screenshots

*(Placeholders for repository visual assets)*

- **Architecture:** `![Architecture](docs/images/architecture.png)`
- **Search Results:** `![Search Results](docs/images/search_results.png)`
- **Worker Logs:** `![Worker Logs](docs/images/worker_logs.png)`
- **Prometheus Metrics:** `![Metrics](docs/images/metrics.png)`

---

## Playwright Engineering Decisions

Playwright was chosen over standard HTTP clients (Axios + Cheerio) due to the heavy reliance of modern academic repositories on client-side rendering.

- **Context Pooling**: Instantiating full browsers per request is too slow. The platform maintains a pool of persistent `BrowserContext` instances to reduce overhead.
- **Request Interception**: `page.route()` is used to aggressively block image, font, and CSS requests to lower bandwidth and speed up extraction.
- **HTML Snapshots & Tracing**: On selector timeouts or crashes, the worker automatically invokes `context.tracing.stop({ path: trace.zip })` to save a debuggable artifact of the failure.
- **Network Idle vs DOMContentLoaded**: Switched to `domcontentloaded` with explicit locator waits to avoid false-negative timeouts on pages with hanging tracking scripts.



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

**Methodology:**
- **Machine**: Local Development Machine (16GB RAM, 8-Core CPU)
- **Runs**: N=20 searches
- **Parameters**: `maxResults=5` per source

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

