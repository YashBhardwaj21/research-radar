# Technical Audit Report: Milestone 1
**Project**: Playwright Research Ingestion Pipeline  
**Phase**: Core Browser Automation Infrastructure  
**Date**: May 2026

---

## 1. Executive Summary

Milestone 1 successfully established the foundational browser automation layer for the research ingestion pipeline. Rather than creating a procedural scraping script, this phase focused on building a robust, resilient, and highly governed infrastructure using **TypeScript** and **Playwright's Node.js API**. 

The primary objectives achieved were:
1. Preventing resource exhaustion through centralized browser lifecycle management.
2. Implementing extreme resilience against transient network failures and anti-bot mechanisms.
3. Establishing a standardized, extensible blueprint for adding new data sources.

---

## 2. Component Deep Dive: What, How, and Why

### 2.1 Browser Lifecycle Management (`src/browser/BrowserManager.ts`)
- **What we did**: Implemented a Singleton class that launches and maintains a single underlying Chromium browser process.
- **How we did it**: Used the standard Singleton design pattern with a private constructor and a static `getInstance()` method. The browser is launched with specific flags (`--no-sandbox`, `--disable-dev-shm-usage`) optimized for server/Docker environments.
- **Why we did it**: Browsers are extremely memory-intensive. Launching a new browser process for every extraction job would result in massive overhead and inevitable Out-Of-Memory (OOM) crashes on the server. The Singleton pattern guarantees that the application multiplexes all work through one shared process.

### 2.2 Context Pooling (`src/browser/ContextPool.ts`)
- **What we did**: Created a pool manager for Playwright `BrowserContext` objects (the equivalent of isolated incognito tabs).
- **How we did it**: 
  - Tracked active vs. idle contexts in a state array.
  - Enforced a hard limit (`maxContexts`) on the number of simultaneous contexts.
  - Implemented usage tracking to recycle contexts after a set number of uses (preventing slow DOM memory leaks).
  - Implemented a `cleanup()` function to close idle, stale contexts.
- **Why we did it**: Even within a single browser, keeping thousands of contexts open will crash the node process. A pool ensures we bound our concurrency and actively garbage-collect stale resources. This is a hallmark of enterprise-grade automation.

### 2.3 Resilient Navigation (`src/browser/navigation.ts`)
- **What we did**: Replaced raw Playwright API calls (`page.goto`, `page.click`) with defensive wrappers.
- **How we did it**: 
  - Implemented `safeGoto` and `safeClick` using a `for` loop to retry failed actions.
  - Used **Exponential Backoff**: waiting `Math.pow(2, attempt) * 1000` milliseconds between retries.
  - Added an automatic `screenshotOnFail` function that generates an MD5 hash of the URL and saves a full-page snapshot if all retries are exhausted.
- **Why we did it**: Headless browsers running in CI/CD or backend environments face unique timing issues, slow networks, and dynamic DOM rendering delays. Raw `goto` calls are brittle. Wrappers ensure transient network blips don't crash the worker, and screenshots provide crucial observability when debugging headless failures.

### 2.4 Traffic Governance (`src/browser/RateLimiter.ts`)
- **What we did**: Built a centralized, per-domain rate limiter.
- **How we did it**: Used an in-memory `Map<string, number>` to track the last access time for specific hostnames. When navigating, the system calculates a randomized delay (jitter) between 2s and 5s before proceeding.
- **Why we did it**: Academic databases (like PubMed or Semantic Scholar) employ strict anti-bot measures. Hitting them concurrently without throttling will result in immediate IP bans. Randomized jitter makes the automation appear significantly more human.

### 2.5 State Persistence (`src/browser/SessionManager.ts`)
- **What we did**: Created a utility to persist and load browser cookies and local storage.
- **How we did it**: Utilized Playwright's native `context.storageState({ path })` to save JSON state files to the disk (`/sessions` directory).
- **Why we did it**: Enables "log in once, scrape infinitely" architectures. Crucial for sources that enforce strict rate limits on unauthenticated traffic.

### 2.6 Extractor Blueprint (`src/extractors/BaseExtractor.ts` & `PubMedExtractor.ts`)
- **What we did**: Defined an abstract interface for scraping and implemented the first concrete source.
- **How we did it**: 
  - `BaseExtractor` forces all subclasses to implement standard `search` and `extractPaper` methods returning uniform `PaperMetadata`.
  - It provides protected access to `acquireContext()` ensuring extractors don't bypass the `ContextPool`.
  - `PubMedExtractor` uses CSS selectors specific to PubMed, leveraging the `safeGoto` wrapper.
- **Why we did it**: Promotes the Open-Closed Principle (SOLID). Adding arXiv or Google Scholar in the future requires zero changes to the core browser infrastructure; engineers simply implement a new subclass.

---

## 3. DevOps & Configuration

### 3.1 Structured Logging (`src/core/logger.ts`)
- **Decision**: Used `pino` instead of `console.log`.
- **Rationale**: `console.log` is insufficient for distributed systems. `pino` provides high-performance, structured JSON logging. This allows future integration with log aggregators (like Datadog or ELK), making it easy to query logs by `job_id`, `url`, or `error_code`.

### 3.2 Environment Configuration
- **Decision**: Strict environment validation using `.env` and a centralized `config.ts`.
- **Rationale**: Keeps secrets out of source control and allows the Dockerized workers to be configured via environment variables at runtime.

### 3.3 Containerized Dependencies (`docker-compose.yml`)
- **Decision**: Spun up `pgvector` (PostgreSQL) and `redis:7-alpine`.
- **Rationale**: Standardizes the local development environment so any engineer can type `docker compose up` and have the required database/queue backend running instantly.

---

## 4. Conclusion & Readiness for Milestone 2

The infrastructure established in Milestone 1 meets high backend engineering standards. The system is structurally protected against memory leaks, transient network errors, and basic rate-limiting bans.

The codebase is now fully prepared for **Milestone 2**, where we will introduce **BullMQ**. Because the browser lifecycle is strictly managed by the `ContextPool` and `BrowserManager`, we can safely launch concurrent BullMQ workers without fear of resource exhaustion.

---

## 5. Milestone 1 Hardening & Verification

Before proceeding to distributed queue orchestration (Milestone 2), a strict verification audit revealed structural weaknesses in the initial implementation that would cause catastrophic failures under high concurrency. The following critical hardening patches were applied:

### 5.1 ContextPool Transparent Queuing
- **The Problem**: The initial `ContextPool` threw an exception (`Max browser contexts reached`) if the active context count exceeded the configured limit. In a distributed environment with 50 incoming jobs and a limit of 10 contexts, 40 jobs would immediately crash rather than wait.
- **The Fix**: Refactored `ContextPool.ts` to implement a transparent, promise-based FIFO wait queue. When the limit is reached, incoming requests dynamically await a resolution trigger. When a context is released, the pool pops the next waiting request and resolves its promise.
- **Why it was necessary**: Systems must handle backpressure gracefully. Throwing errors on capacity limits defeats the purpose of an infrastructure pipeline. The transparent queue ensures worker orchestration can blindly request contexts without implementing complex retry loops themselves.

### 5.2 RateLimiter Concurrency Mutex (Staggering)
- **The Problem**: The initial `RateLimiter` calculated jitter delays based on the time since the last access. However, if 10 concurrent workers hit the `throttle()` function at the exact same millisecond, they all calculated the same delay, slept for the same duration, and hit the target domain simultaneously, defeating the rate limit.
- **The Fix**: Implemented a per-domain Promise chain (a mutex lock) in `RateLimiter.ts`. Each incoming request awaits the completion of the *previous* request's randomized delay before calculating its own. 
- **Why it was necessary**: True distributed infrastructure must serialize access to protected resources. The promise chain ensures that even if 100 workers try to scrape PubMed simultaneously, the requests are perfectly staggered over time, protecting the IP address from immediate bans.

### 5.3 Correlation IDs via `AsyncLocalStorage`
- **The Problem**: Concurrent worker logs were interspersed, making it impossible to trace which log line belonged to which extraction job.
- **The Fix**: Integrated Node.js core `AsyncLocalStorage` into the `pino` logger (`src/core/logger.ts`). 
- **Why it was necessary**: By injecting `job_id` and `source` at the boundary of the worker execution, all subsequent logs (even deep inside navigation wrappers or extractors) automatically inherit those correlation IDs. This is a non-negotiable requirement for observability in distributed systems.
