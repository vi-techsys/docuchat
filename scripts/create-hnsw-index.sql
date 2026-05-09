-- Create HNSW index for efficient cosine similarity search
CREATE INDEX ON "Chunk"
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- m = 16: each node connects to 16 neighbors (higher = more accurate, more memory)
-- ef_construction = 64: search quality during build (higher = better index, slower build)
