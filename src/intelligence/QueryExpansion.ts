import { logger } from '../core/logger';

/**
 * Static dictionary of research domain synonyms and abbreviations.
 *
 * This is a deterministic, zero-dependency query expansion layer.
 * No LLM needed — just a curated synonym map so the scraping
 * pipeline can cast a wider net when searching sources.
 */
const SYNONYM_MAP: Record<string, string[]> = {
  // Neuroscience / Psychology
  'adhd': ['attention deficit hyperactivity disorder', 'ADHD', 'hyperkinetic disorder'],
  'attention deficit hyperactivity disorder': ['adhd', 'hyperkinetic disorder'],
  'asd': ['autism spectrum disorder', 'ASD', 'autism'],
  'autism': ['autism spectrum disorder', 'ASD', 'asd'],
  'ptsd': ['post-traumatic stress disorder', 'PTSD', 'post traumatic stress'],
  'ocd': ['obsessive compulsive disorder', 'OCD'],
  'depression': ['major depressive disorder', 'MDD', 'depressive disorder', 'unipolar depression'],
  'anxiety': ['generalized anxiety disorder', 'GAD', 'anxiety disorder'],

  // Machine Learning / AI
  'llm': ['large language model', 'LLM', 'language model', 'foundation model'],
  'large language model': ['llm', 'LLM', 'foundation model', 'language model'],
  'gnn': ['graph neural network', 'GNN', 'graph network'],
  'cnn': ['convolutional neural network', 'CNN', 'convnet'],
  'rnn': ['recurrent neural network', 'RNN', 'LSTM', 'GRU'],
  'transformer': ['attention mechanism', 'self-attention', 'multi-head attention'],
  'reinforcement learning': ['RL', 'policy gradient', 'Q-learning', 'reward learning'],
  'rl': ['reinforcement learning', 'policy gradient', 'Q-learning'],
  'rag': ['retrieval augmented generation', 'RAG'],
  'retrieval augmented generation': ['rag', 'RAG'],

  // Biology / Medicine
  'crispr': ['CRISPR-Cas9', 'gene editing', 'genome editing', 'CRISPR'],
  'mrna': ['messenger RNA', 'mRNA vaccine', 'mRNA therapeutics'],
  'pcr': ['polymerase chain reaction', 'RT-PCR', 'qPCR'],
  'covid': ['COVID-19', 'SARS-CoV-2', 'coronavirus', 'novel coronavirus'],
  'alzheimer': ["Alzheimer's disease", 'AD', 'dementia', 'neurodegeneration'],
  'parkinson': ["Parkinson's disease", 'PD', 'dopaminergic degeneration'],
  'cancer': ['neoplasm', 'tumor', 'malignancy', 'carcinoma', 'oncology'],

  // General
  'ml': ['machine learning', 'ML', 'statistical learning'],
  'machine learning': ['ml', 'ML', 'statistical learning', 'deep learning'],
  'nlp': ['natural language processing', 'NLP', 'computational linguistics'],
  'natural language processing': ['nlp', 'NLP', 'computational linguistics', 'text mining'],
  'cv': ['computer vision', 'CV', 'image recognition', 'visual computing'],
  'computer vision': ['cv', 'CV', 'image recognition', 'object detection'],
};

export interface ExpandedQuery {
  original: string;
  expansions: string[];
  allTerms: string[];
}

export class QueryExpansion {

  /**
   * Expand a query string by looking up each word/phrase in the synonym dictionary.
   * Returns the original plus all discovered synonyms, deduplicated.
   */
  expand(query: string): ExpandedQuery {
    const lower = query.toLowerCase().trim();
    const expansions: Set<string> = new Set();

    // Try exact match first
    if (SYNONYM_MAP[lower]) {
      for (const syn of SYNONYM_MAP[lower]) {
        expansions.add(syn);
      }
    }

    // Try matching substrings (multi-word abbreviations)
    const words = lower.split(/\s+/);
    for (const word of words) {
      if (SYNONYM_MAP[word]) {
        for (const syn of SYNONYM_MAP[word]) {
          expansions.add(syn);
        }
      }
    }

    // Remove the original query from expansions to avoid duplication
    expansions.delete(lower);
    expansions.delete(query);

    const result: ExpandedQuery = {
      original: query,
      expansions: Array.from(expansions),
      allTerms: [query, ...Array.from(expansions)],
    };

    logger.debug({ original: query, expansionCount: result.expansions.length }, 'QueryExpansion: Expanded query');
    return result;
  }

  /**
   * Check if the synonym map has an entry for a given term.
   */
  has(term: string): boolean {
    return !!SYNONYM_MAP[term.toLowerCase().trim()];
  }

  /**
   * Get all known terms in the dictionary.
   */
  listKnownTerms(): string[] {
    return Object.keys(SYNONYM_MAP);
  }
}
