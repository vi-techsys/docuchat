# DocuChat Postman Testing Guide

## 🚀 Complete RAG API Testing

This guide provides comprehensive Postman collections and test data for validating the DocuChat RAG system functionality.

## 📋 Prerequisites

1. **Postman Desktop** (recommended)
2. **Environment Setup**: Configure your environment variables
3. **Authentication**: You'll need JWT tokens for protected endpoints

## 🔧 Environment Configuration

### Base URL
```
http://localhost:5000/api/v1
```

### Authentication Flow
1. Register user → Get JWT tokens
2. Use tokens in `Authorization: Bearer <token>` header

## 📚 Test Scenarios

### Scenario 1: Complete RAG Pipeline
**Purpose**: Test end-to-end RAG functionality with real document content

#### Setup Steps
1. **Register and Login**
   ```http
   POST /api/v1/auth/register
   Content-Type: application/json
   Body: {
     "email": "test@example.com",
     "password": "TestPassword123!"
   }
   ```

   ```http
   POST /api/v1/auth/login
   Body: {
     "email": "test@example.com", 
     "password": "TestPassword123!"
   }
   ```

2. **Upload Document**
   ```http
   POST /api/v1/documents
   Authorization: Bearer <access-token>
   Content-Type: application/json
   Body: {
     "title": "Employee Handbook 2024",
     "content": "Remote Work Policy Employees in Administrative and IT departments are eligible for remote work up to 4 days per week. Sales and Marketing employees up to 2 days per week. All employees must complete 90-day onboarding before remote work eligibility. Internet stipend of $50 per month for remote work expenses. Company VPN required for all remote work. Public Wi-Fi prohibited for work activities.",
     "fileUrl": "https://example.com/handbook.pdf",
     "fileSize": 5242880,
     "mimeType": "application/pdf"
   }
   ```

3. **Create Conversation**
   ```http
   POST /api/v1/conversations
   Authorization: Bearer <access-token>
   Body: {
     "documentId": "<document-id-from-step-2>",
     "title": "Handbook Questions"
   }
   ```

4. **Send RAG Messages**
   ```http
   POST /api/v1/conversations/{conversationId}/messages
   Authorization: Bearer <access-token>
   Content-Type: application/json
   
   // Test various question types
   Body: {
     "content": "What is the remote work policy?"
   }
   
   Body: {
     "content": "How many days can I work remotely?"
   }
   
   Body: {
     "content": "What equipment is provided?"
   }
   
   Body: {
     "content": "Is VPN required?"
   }
   
   Body: {
     "content": "Tell me about vacation policy"  // Should return "no info found"
   }
   ```

### Expected Responses
- **Relevant questions**: Should return answers with citations
- **Irrelevant questions**: Should return "couldn't find information" messages
- **Conversation history**: Should maintain context across messages

---

### Scenario 2: Document Management
**Purpose**: Test document CRUD operations and processing

#### Test Cases

1. **List Documents**
   ```http
   GET /api/v1/documents
   Authorization: Bearer <access-token>
   ```

2. **Get Document Status**
   ```http
   GET /api/v1/documents/{documentId}
   Authorization: Bearer <access-token>
   ```

3. **Update Document**
   ```http
   PUT /api/v1/documents/{documentId}
   Authorization: Bearer <access-token>
   Body: {
     "title": "Updated Employee Handbook",
     "status": "completed"
   }
   ```

4. **Delete Document**
   ```http
   DELETE /api/v1/documents/{documentId}
   Authorization: Bearer <access-token>
   ```

---

### Scenario 3: User Management
**Purpose**: Test user administration and tier management

#### Test Cases

1. **Get User Profile**
   ```http
   GET /api/v1/auth/profile
   Authorization: Bearer <access-token>
   ```

2. **Update User Tier** (if admin)
   ```http
   PUT /api/v1/admin/users/{userId}
   Authorization: Bearer <admin-token>
   Body: {
     "tier": "pro"
   }
   ```

---

### Scenario 4: Health & Monitoring
**Purpose**: Test system health and metrics

#### Test Cases

1. **Health Checks**
   ```http
   GET /health/live
   // Expected: { "status": "healthy", "uptime": "..." }
   
   GET /health/ready
   // Expected: { "status": "ready", "checks": { "database": "connected", "redis": "connected" } }
   ```

2. **Metrics Endpoint**
   ```http
   GET /metrics
   // Expected: Prometheus metrics format
   ```

---

## 📊 Sample Test Data

### User Registration Test Data
```json
{
  "email": "testuser@example.com",
  "password": "TestPassword123!"
}
```

### Document Upload Test Data
```json
{
  "title": "Company Policy Document 2024",
  "content": "This document outlines the comprehensive policies for employee conduct, benefits, and procedures. All employees are required to read and acknowledge these policies. Remote Work: Employees may work remotely up to 3 days per week with manager approval. Equipment: Company provides laptop and $1000 stipend. Vacation: 15 days paid vacation per year. Sick Leave: 10 days paid sick leave per year. Benefits: Health insurance, 401k matching, retirement plan.",
  "fileUrl": "https://example.com/policy.pdf",
  "fileSize": 1048576,
  "mimeType": "application/pdf"
}
```

### RAG Question Test Data
```json
[
  {
    "content": "What is the remote work policy?",
    "expected": "Should mention 3 days per week, manager approval, equipment provided"
  },
  {
    "content": "How much vacation do employees get?",
    "expected": "Should mention 15 days paid vacation per year"
  },
  {
    "content": "What equipment is provided for remote work?",
    "expected": "Should mention laptop and $1000 stipend"
  },
  {
    "content": "What is the company's internet policy?",
    "expected": "Should return 'no information found' if not in documents"
  },
  {
    "content": "Compare vacation and sick leave policies",
    "expected": "Should compare both policies if available"
  }
]
```

## 🔍 Response Validation

### Success Criteria
- **Status Codes**: 200 for success, 201 for creation
- **Response Format**: Consistent JSON structure with `success: true`
- **Data Fields**: All expected fields present and correctly typed
- **RAG Quality**: Answers based on document context with proper citations
- **Error Handling**: Appropriate error messages and status codes

### Performance Benchmarks
- **Response Time**: < 2 seconds for most queries
- **Search Results**: Relevant results with similarity scores > 0.3
- **Context Assembly**: Token usage within budget limits
- **Caching**: Embedding cache hits after first query

## 🚨 Common Issues & Solutions

### Authentication Issues
- **401 Unauthorized**: Check JWT token validity and expiration
- **403 Forbidden**: Verify user permissions for admin endpoints
- **429 Rate Limited**: Implement exponential backoff in client

### Document Processing Issues
- **400 Bad Request**: Validate file size, MIME type, required fields
- **413 Payload Too Large**: Check file size limits (MAX_FILE_SIZE)
- **Processing Timeout**: Monitor queue processing for large documents

### RAG Pipeline Issues
- **No Search Results**: Check document embedding status and vector search
- **Empty Context**: Verify semantic search minimum score thresholds
- **Hallucination**: Review system prompt and temperature settings
- **Citation Errors**: Validate citation format and source references

## 📈 Test Automation

### Postman Collection Features
1. **Environment Variables**: Configure base URL and authentication tokens
2. **Pre-request Scripts**: Auto-generate JWT tokens for setup
3. **Response Assertions**: Use pm.response scripts to validate API responses
4. **Load Testing**: Simulate concurrent user activity
5. **Performance Monitoring**: Track response times and success rates

### Sample pm.test Script
```javascript
// Validate RAG response structure
pm.test("RAG response has correct structure", function() {
    const response = pm.response.json();
    
    pm.expect(response.success).to.be.true;
    pm.expect(response.data).to.be.an('object');
    pm.expect(response.data.answer).to.be.a('string');
    
    if (response.data.citations && response.data.citations.length > 0) {
        pm.expect(response.data.citations[0]).to.have.property('chunkId');
        pm.expect(response.data.citations[0]).to.have.property('documentTitle');
    }
    
    // Validate conversation history
    if (response.data.conversationId) {
        pm.expect(response.data.conversationId).to.be.a('string');
    }
});
```

## 🎯 Testing Checklist

- [ ] Register test user and get JWT tokens
- [ ] Upload sample documents and verify processing
- [ ] Create conversations and test RAG queries
- [ ] Test document CRUD operations
- [ ] Validate conversation history functionality
- [ ] Test error handling and edge cases
- [ ] Monitor performance metrics
- [ ] Verify rate limiting and security
- [ ] Test health endpoints and monitoring

## 📝 Notes

1. **Document Processing**: Documents may take time to process (chunking, embedding)
2. **Vector Search**: Initial queries may be slower until embeddings are cached
3. **Context Limits**: RAG responses limited by context token budget (~3500 tokens)
4. **Conversation Memory**: System maintains last 10 messages for context
5. **Cost Awareness**: Each query consumes OpenAI tokens - monitor usage

## 🔗 Related Documentation

- [API Documentation](./README.md) - Complete API reference
- [Testing Guide](./TESTING_GUIDE.md) - Development testing procedures
- [Architecture Overview](./docs/architecture.md) - System design documentation

---

**Last Updated**: 2026-01-11  
**Version**: 1.0  
**Status**: Production Ready ✅
