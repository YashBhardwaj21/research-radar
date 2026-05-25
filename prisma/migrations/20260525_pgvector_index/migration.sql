CREATE INDEX IF NOT EXISTS paper_embedding_idx
ON "Paper"
USING hnsw (
 embedding vector_cosine_ops
);