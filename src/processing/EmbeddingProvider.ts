export interface EmbeddingProvider {
  /**
   * Generates a dense vector embedding for the provided text.
   * Returns a number[] of length equal to the model's dimensionality.
   */
  generate(text: string): Promise<number[]>;
}
