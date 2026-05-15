# DocuChat Testing Guide

## 🚀 Ready for Testing

The core RAG functionality and MCP service are now implemented and ready for testing. Here's what's available:

## ✅ Completed Features

### 1. **pgvector Setup**
- PostgreSQL with pgvector extension configured
- Vector columns (1536 dimensions for text-embedding-3-small)
- HNSW indexes for efficient cosine similarity search

### 2. **Embedding Service**
- OpenAI text-embedding-3-small integration
- Batch processing with caching
- Content hashing for cache optimization
- Cost tracking and event emission
- MCP service integration for centralized AI calls

### 3. **Advanced Document Processing**
- Text extraction service (PDF, Markdown, text files)
- Recursive chunking with overlap (500 tokens, 50 overlap)
- Format detection from file extensions
- Metadata preservation
- Real-time processing with cost tracking

### 4. **RAG Pipeline**
- Vector similarity search
- Context assembly
- Answer generation with MCP service
- Source citation
- Conversation summary generation

### 5. **MCP (Model Control Plane) Service**
- **Budget Enforcement**: Per-user daily budget limits based on tier (free: $1, pro: $10, enterprise: $100)
- **Prompt Resolution**: Database-backed prompt templates with versioning
- **Model Routing**: Intelligent model selection based on task type
- **Fallback Chains**: Automatic fallback to secondary models on failure
- **Cost Tracking**: Real-time cost calculation with model-specific pricing
- **Audit Logging**: Comprehensive AI request audit trail
- **Confidence Levels**: High/medium/low confidence scoring for chat responses

### 6. **Database-Backed Prompt System**
- Prompt templates stored in database
- Version control with changelog tracking
- A/B testing capability for prompt variants
- 5-minute cache for performance
- Instant activation via cache busting
- No deployment required for prompt updates

### 7. **AI Audit Log**
- Dedicated audit table for AI requests
- Input/output summaries (first 500 chars) for debugging
- Token-level cost tracking
- Fallback usage monitoring
- Queryable by user, task type, model, and time

## 🧪 Testing Endpoints

### 1. **Unified Document Upload**
The unified endpoint handles both file uploads and direct text content:

**Direct Text Upload:**
```bash
POST /api/v1/documents
Content-Type: application/json
Authorization: Bearer <your-jwt-token>

{
  "title": "Test Document",
  "content": "This is a test document for the RAG system. It contains multiple sentences to test the chunking functionality. The system should break this into chunks and create embeddings for each chunk."
}
```

**File Upload:**
```bash
POST /api/v1/documents
Content-Type: multipart/form-data
Authorization: Bearer <your-jwt-token>

file: [binary file data]
title: "Test Document"
```

**Supported File Formats:**
- `.txt` - Plain text files
- `.md` - Markdown files  
- `.pdf` - PDF documents
- `.doc` - Word documents (older format)
- `.docx` - Word documents (newer format)

### 2. **Query Documents**
```bash
POST /api/v1/rag/query
Content-Type: application/json
Authorization: Bearer <your-jwt-token>

{
  "question": "What is this document about?",
  "maxChunks": 5
}
```

### 3. **Get Document Chunks**
```bash
GET /api/v1/rag/documents/{documentId}/chunks
Authorization: Bearer <your-jwt-token>
```

### 4. **MCP Service Testing**
The MCP service is used internally by other services. Test it via the RAG query endpoint which uses MCP for AI calls.

**Test MCP Features via RAG Query:**
```bash
POST /api/v1/rag/query
Content-Type: application/json
Authorization: Bearer <your-jwt-token>

{
  "question": "What is this document about?",
  "maxChunks": 5
}
```

**Response includes:**
- `model`: The model used (e.g., gpt-4o-mini)
- `promptVersion`: The prompt version used
- `tokensUsed`: Token counts (prompt, completion, total)
- `costUsd`: Cost in USD
- `latencyMs`: Request latency
- `fallbackUsed`: Whether fallback model was used
- `confidenceLevel`: Confidence score for chat tasks

### 5. **Prompt Management (Database Operations)**
Prompt templates are managed directly in the database. Use SQL or a database client to manage prompts.

**View Active Prompts:**
```sql
SELECT * FROM prompt_templates WHERE isActive = true;
```

**Create New Prompt Version:**
```sql
INSERT INTO prompt_templates (taskType, version, name, content, isActive, metadata)
VALUES ('chat', 'v2', 'RAG Chat - Improved', 'Your new prompt content here', true, '{"author": "admin", "changelog": "Improved context handling"}');
```

**Activate Different Version:**
```sql
-- Deactivate old version
UPDATE prompt_templates SET isActive = false WHERE taskType = 'chat' AND version = 'v1';

-- Activate new version
UPDATE prompt_templates SET isActive = true WHERE taskType = 'chat' AND version = 'v2';
```

**A/B Testing Setup:**
```sql
-- Mark multiple versions as active for A/B testing
UPDATE prompt_templates SET isActive = true WHERE taskType = 'chat' AND version IN ('v1', 'v2');
```

**Bust Prompt Cache (via code):**
```typescript
import { bustPromptCache } from './src/services/mcp.service';
await bustPromptCache('chat'); // Instant activation
```

### 6. **AI Audit Log Queries**
Query the audit log to analyze AI usage and performance.

**Query by User:**
```sql
SELECT * FROM ai_audit_logs WHERE userId = 'user-id' ORDER BY createdAt DESC LIMIT 10;
```

**Query by Task Type:**
```sql
SELECT taskType, model, COUNT(*) as request_count, AVG(costUsd) as avg_cost, AVG(latencyMs) as avg_latency
FROM ai_audit_logs
WHERE createdAt >= NOW() - INTERVAL '24 hours'
GROUP BY taskType, model;
```

**Query Fallback Usage:**
```sql
SELECT model, COUNT(*) as fallback_count, COUNT(*) * 100.0 / (SELECT COUNT(*) FROM ai_audit_logs) as percentage
FROM ai_audit_logs
WHERE fallbackUsed = true
GROUP BY model;
```

**Query High-Cost Requests:**
```sql
SELECT * FROM ai_audit_logs
WHERE costUsd > 0.01
ORDER BY costUsd DESC
LIMIT 20;
```

**Query by Model Performance:**
```sql
SELECT model, AVG(latencyMs) as avg_latency, AVG(costUsd) as avg_cost, COUNT(*) as total_requests
FROM ai_audit_logs
WHERE createdAt >= NOW() - INTERVAL '7 days'
GROUP BY model
ORDER BY avg_latency;
```

## 🔧 Setup Instructions

### 1. **Start Services**
Make sure your Docker containers are running:
```bash
# PostgreSQL with pgvector
docker run -d \
  --name docuchat-postgres \
  -e POSTGRES_USER=docuchat \
  -e POSTGRES_PASSWORD=docuchat_dev \
  -e POSTGRES_DB=docuchat \
  -p 5432:5432 \
  pgvector/pgvector:pg16

# Redis (if not already running)
docker run -d \
  --name docuchat-redis \
  -p 6379:6379 \
  redis:alpine
```

### 2. **Database Setup**
```bash
# Enable pgvector extension
docker exec -it docuchat-postgres psql -U docuchat -d docuchat -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Run migrations
cd c:\docuchat
npx prisma db push

# Create HNSW index
docker exec -it docuchat-postgres psql -U docuchat -d docuchat -c "CREATE INDEX ON \"Chunk\" USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);"

# Seed initial prompt templates
npx ts-node prisma/seed.ts
```

### 3. **Start Server**
```bash
cd c:\docuchat
npm run dev
```

## 🧪 Testing Workflow

### 1. **Register/Login**
```bash
# Register user
POST /api/v1/auth/register
{
  "email": "test@example.com",
  "password": "password123"
}

# Login
POST /api/v1/auth/login
{
  "email": "test@example.com",
  "password": "password123"
}
```

### 2. **Upload Document**
Use the simple upload endpoint to test without file dependencies.

### 3. **Query Document**
Test the RAG functionality with your uploaded document.

### 4. **Test MCP Service**
Make a RAG query and observe the MCP response fields (model, cost, latency, fallback, confidence).

### 5. **Run MCP Test Suite**
```bash
npx ts-node src/services/mcp.test.ts
```
This tests all MCP features: budget enforcement, prompt resolution, model routing, cost calculation, audit logging, cache busting, and more.

### 6. **Check Audit Logs**
Query the ai_audit_logs table to verify audit logging is working correctly.

### 7. **Test Prompt Management**
Create a new prompt version in the database and test cache busting.

## 🔍 Current Limitations

### **File Upload**
- PDF processing may have dependency issues with pdf-parse
- Some file formats may not be fully supported

### **Dependencies**
Some npm packages (multer, pdf-parse) need manual installation:
```bash
npm install multer pdf-parse @types/multer @types/pdf-parse
```

### **MCP Service**
- Requires valid OpenAI API key in environment variables
- Budget enforcement is per-day, not per-request
- Prompt cache has 5-minute TTL (can be busted for instant activation)

## 📝 Next Steps

### **Enhancements**
1. Add complexity-based model routing (query length, keywords)
2. Implement LLM-classified routing (use cheap model to classify complexity)
3. Add prompt performance metrics and A/B test analysis
4. Implement prompt rollback UI or admin interface
5. Add real-time budget alerts
6. Implement rate limiting per user tier

### **Monitoring**
1. Set up Prometheus metrics dashboard
2. Create alerting for high fallback usage
3. Monitor cost per user tier
4. Track prompt version performance

## 🎯 What You Can Test Now

### **Core Features**
1. **Document Upload** (text-based and file-based)
2. **Chunking** (intelligent text splitting)
3. **Vector Storage** (pgvector integration)
4. **Similarity Search** (cosine similarity)
5. **RAG Queries** (context retrieval + answer generation)
6. **Caching** (content hashing)
7. **Cost Tracking** (token usage logging)

### **MCP Service Features**
1. **Budget Enforcement** (per-user daily limits)
2. **Prompt Resolution** (database-backed with versioning)
3. **Model Routing** (task-based model selection)
4. **Fallback Chains** (automatic model fallback)
5. **Cost Calculation** (model-specific pricing)
6. **Audit Logging** (comprehensive AI request tracking)
7. **Confidence Levels** (chat response scoring)
8. **Prompt A/B Testing** (deterministic user-based splits)
9. **Cache Busting** (instant prompt activation)

The complete pipeline is functional with production-ready MCP service integration!
