import { config } from '../core/config';
import { logger } from '../core/logger';

interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
}

export interface AnalysisResult {
  summary: string;
  keywords: string[];
  methodology: string | null;
  limitations: string | null;
}

/**
 * LLMAnalyzer calls local Ollama for async paper summarisation.
 *
 * Design constraints:
 *   - Uses only local Ollama (llama3.1:8b), no OpenAI.
 *   - All calls are async with timeouts so the worker is never blocked.
 *   - Failures are logged and return null — never crash the pipeline.
 */
export class LLMAnalyzer {
  private baseUrl: string;
  private model: string;
  private timeoutMs: number;

  constructor(
    baseUrl = config.ollamaBaseUrl,
    model = 'llama3.1:8b',
    timeoutMs = 60_000,
  ) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Summarize a paper's title + abstract into structured fields.
   */
  async analyze(title: string, abstract: string): Promise<AnalysisResult | null> {
    const prompt = `You are a research paper analyst. Given the title and abstract below, produce a JSON object with these exact keys:
- "summary": A 2-3 sentence plain-English summary of the paper.
- "keywords": An array of 3-7 keywords/topics.
- "methodology": One sentence describing the methodology, or null if unclear.
- "limitations": One sentence on limitations, or null if not mentioned.

Title: ${title}

Abstract: ${abstract}

Respond ONLY with valid JSON. No markdown, no explanation.`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          options: {
            temperature: 0.1,
            num_predict: 512,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        logger.warn({ status: response.status }, 'LLMAnalyzer: Ollama returned non-OK status');
        return null;
      }

      const data = (await response.json()) as OllamaGenerateResponse;
      const raw = data.response.trim();

      // Try to parse JSON from the response (Ollama sometimes wraps in ```json)
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn({ raw: raw.slice(0, 200) }, 'LLMAnalyzer: Could not extract JSON from response');
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]) as AnalysisResult;

      // Validate required fields
      if (!parsed.summary || !Array.isArray(parsed.keywords)) {
        logger.warn('LLMAnalyzer: Parsed response missing required fields');
        return null;
      }

      logger.info({ title: title.slice(0, 60), keywords: parsed.keywords.length }, 'LLMAnalyzer: Analysis complete');
      return parsed;

    } catch (err: any) {
      if (err.name === 'AbortError') {
        logger.warn({ title: title.slice(0, 60) }, 'LLMAnalyzer: Ollama request timed out');
      } else {
        logger.warn({ err: err.message, title: title.slice(0, 60) }, 'LLMAnalyzer: Analysis failed');
      }
      return null;
    }
  }

  /**
   * Health check — can we reach Ollama and is the model loaded?
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return false;

      const data = (await response.json()) as { models: Array<{ name: string }> };
      return data.models.some(m => m.name.includes(this.model.split(':')[0]));
    } catch {
      return false;
    }
  }
}
