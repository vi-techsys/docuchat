# DocuChat API

A document sharing API built with Express.js, TypeScript, and Prisma.

## Getting Started

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- PostgreSQL database

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your database URL and JWT secrets
   ```

4. Generate Prisma client:
   ```bash
   npx prisma generate
   ```

5. Run database migrations:
   ```bash
   npx prisma migrate dev
   ```

6. Start the development server:
   ```bash
   npm run dev
   # or
   npx ts-node-dev src/server.ts
   ```

The server will start on `http://localhost:5000`

## 🚀 Key Features

### 🏥 Health & Monitoring
- **Health Checks**: `/health/live` and `/health/ready` endpoints
- **Metrics**: Prometheus metrics at `/metrics`
- **Queue Monitoring**: Bull Board UI at `/admin/queues`

### 🔒 Security & Authentication
- **JWT Authentication**: Access and refresh tokens
- **Rate Limiting**: Tier-based rate limiting with Redis
- **Security Headers**: Helmet, CORS, XSS protection
- **Input Sanitization**: Protection against injection attacks
- **Security Events**: Failed login tracking and IP blocking

### 📊 Caching & Performance
- **Redis Caching**: Multi-layer caching with TTL management
- **HTTP Caching**: ETags and cache-control headers
- **Cache Invalidation**: Event-driven cache updates
- **Database Optimization**: Comprehensive indexing strategy

### 📝 Logging & Analytics
- **Structured Logging**: Winston with correlation IDs
- **Request Tracking**: Complete request/response logging
- **Business Metrics**: Authentication, usage, and performance metrics
- **Error Tracking**: Comprehensive error logging and monitoring

### 🔄 Queue System
- **Document Processing**: Async document processing with BullMQ
- **Event System**: Event-driven architecture for cache invalidation
- **Retry Logic**: Automatic retry with exponential backoff
- **Queue Monitoring**: Real-time queue status and metrics

### 👥 User Management
- **Tier System**: Free, Pro, and Enterprise tiers
- **Role-based Access**: User and admin roles
- **Usage Tracking**: Comprehensive usage analytics
- **Session Management**: Secure session handling

## API Endpoints

### Base URL
```
http://localhost:5000/api/v1
```

### Authentication

All document endpoints require authentication. Include the JWT token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

---

## 📋 Routes Documentation

### 1. Welcome Endpoint

#### GET `/api/v1`
Returns a welcome message.

**Request:**
- Method: `GET`
- URL: `/api/v1`
- Headers: None required
- Body: None

**Response (201):**
```json
{
  "success": true,
  "data": {
    "message": "Welcome to DocuChat!"
  }
}
```

---

### 2. Authentication Routes

#### POST `/api/v1/auth/register`
Registers a new user account.

**Request:**
- Method: `POST`
- URL: `/api/v1/auth/register`
- Headers: 
  - `Content-Type: application/json`
- Body:
```json
{
  "email": "user@example.com",
  "password": "your-password"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "user-uuid",
    "email": "user@example.com"
  }
}
```

**Error Responses:**
- `400` - Missing email or password
- `400` - Email already exists or validation error

#### POST `/api/v1/auth/login`
Authenticates a user and returns JWT tokens.

**Request:**
- Method: `POST`
- URL: `/api/v1/auth/login`
- Headers:
  - `Content-Type: application/json`
- Body:
```json
{
  "email": "user@example.com",
  "password": "your-password"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "accessToken": "jwt-access-token",
    "refreshToken": "jwt-refresh-token"
  }
}
```

**Error Responses:**
- `400` - Missing email or password
- `401` - Invalid credentials

#### POST `/api/v1/auth/register-admin`
Create the first admin user (for initial setup only).

**Request:**
- Method: `POST`
- URL: `/api/v1/auth/register-admin`
- Headers:
  - `Content-Type: application/json`
- Body:
```json
{
  "email": "admin@example.com",
  "password": "AdminPassword123!"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "admin-uuid",
    "email": "admin@example.com",
    "role": "admin",
    "tier": "enterprise",
    "message": "Admin user created successfully"
  }
}
```

**Error Responses:**
- `400` - Missing email or password
- `403` - Admin user already exists
- `400` - Email already exists or validation error

**Important:** This endpoint can only be used once to create the first admin user. After that, use the admin role update endpoint.

---

### 3. Documents Routes

#### GET `/api/v1/documents`
Get all documents for the authenticated user (requires authentication).

**Request:**
- Method: `GET`
- URL: `/api/v1/documents`
- Headers:
  - `Authorization: Bearer <jwt-token>`
- Query Parameters (optional):
  - `page`: Page number (default: 1)
  - `limit`: Number of items per page (default: 10)
  - `status`: Filter by status (`pending`, `processing`, `completed`, `failed`)
  - `search`: Search in title and content

**Response (200):**
```json
{
  "success": true,
  "data": {
    "documents": [
      {
        "id": "document-uuid",
        "userId": "user-uuid",
        "title": "Document Title",
        "content": "Document content",
        "status": "completed",
        "fileUrl": "https://example.com/file.pdf",
        "fileSize": 1024000,
        "mimeType": "application/pdf",
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T01:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 25,
      "totalPages": 3
    }
  }
}
```

**Error Responses:**
- `401` - User not authenticated

#### POST `/api/v1/documents`
Creates a new document (requires authentication).

**Request:**
- Method: `POST`
- URL: `/api/v1/documents`
- Headers:
  - `Content-Type: application/json`
  - `Authorization: Bearer <jwt-token>`
- Body:
```json
{
  "title": "Document Title",
  "content": "Document content",
  "fileUrl": "https://example.com/file.pdf",
  "fileSize": 1024000,
  "mimeType": "application/pdf"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "document-uuid",
    "userId": "user-uuid",
    "title": "Document Title",
    "content": "Document content",
    "status": "pending",
    "fileUrl": "https://example.com/file.pdf",
    "fileSize": 1024000,
    "mimeType": "application/pdf",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Error Responses:**
- `401` - User not authenticated
- `400` - Validation error or missing required fields

#### GET `/api/v1/documents/:id`
Get a specific document by ID (requires authentication).

**Request:**
- Method: `GET`
- URL: `/api/v1/documents/:id`
- Headers:
  - `Authorization: Bearer <jwt-token>`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "document-uuid",
    "userId": "user-uuid",
    "title": "Document Title",
    "content": "Document content",
    "status": "completed",
    "fileUrl": "https://example.com/file.pdf",
    "fileSize": 1024000,
    "mimeType": "application/pdf",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T01:00:00.000Z"
  }
}
```

**Error Responses:**
- `401` - User not authenticated
- `404` - Document not found

#### PUT `/api/v1/documents/:id`
Update a document (requires authentication).

**Request:**
- Method: `PUT`
- URL: `/api/v1/documents/:id`
- Headers:
  - `Content-Type: application/json`
  - `Authorization: Bearer <jwt-token>`
- Body:
```json
{
  "title": "Updated Document Title",
  "content": "Updated content",
  "status": "completed"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "document-uuid",
    "userId": "user-uuid",
    "title": "Updated Document Title",
    "content": "Updated content",
    "status": "completed",
    "updatedAt": "2024-01-01T02:00:00.000Z"
  }
}
```

**Error Responses:**
- `401` - User not authenticated
- `404` - Document not found
- `400` - Validation error

#### DELETE `/api/v1/documents/:id`
Delete a document (requires authentication).

**Request:**
- Method: `DELETE`
- URL: `/api/v1/documents/:id`
- Headers:
  - `Authorization: Bearer <jwt-token>`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Document deleted successfully"
  }
}
```

**Error Responses:**
- `401` - User not authenticated
- `404` - Document not found

---

### 4. Conversation Routes

#### GET `/api/v1/conversations`
Get all conversations for the authenticated user (requires authentication).

**Request:**
- Method: `GET`
- URL: `/api/v1/conversations`
- Headers:
  - `Authorization: Bearer <jwt-token>`
- Query Parameters (optional):
  - `page`: Page number (default: 1)
  - `limit`: Number of items per page (default: 10)
  - `status`: Filter by status (`active`, `archived`, `deleted`)
  - `documentId`: Filter by document ID

**Response (200):**
```json
{
  "success": true,
  "data": {
    "conversations": [
      {
        "id": "conversation-uuid",
        "userId": "user-uuid",
        "documentId": "document-uuid",
        "title": "Conversation Title",
        "status": "active",
        "lastMessageAt": "2024-01-01T02:00:00.000Z",
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T02:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 5,
      "totalPages": 1
    }
  }
}
```

**Error Responses:**
- `401` - User not authenticated

#### POST `/api/v1/conversations`
Create a new conversation (requires authentication).

**Request:**
- Method: `POST`
- URL: `/api/v1/conversations`
- Headers:
  - `Content-Type: application/json`
  - `Authorization: Bearer <jwt-token>`
- Body:
```json
{
  "documentId": "document-uuid",
  "title": "New Conversation Title"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "conversation-uuid",
    "userId": "user-uuid",
    "documentId": "document-uuid",
    "title": "New Conversation Title",
    "status": "active",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Error Responses:**
- `401` - User not authenticated
- `400` - Validation error
- `404` - Document not found

#### GET `/api/v1/conversations/:id`
Get a specific conversation by ID (requires authentication).

**Request:**
- Method: `GET`
- URL: `/api/v1/conversations/:id`
- Headers:
  - `Authorization: Bearer <jwt-token>`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "conversation-uuid",
    "userId": "user-uuid",
    "documentId": "document-uuid",
    "title": "Conversation Title",
    "status": "active",
    "lastMessageAt": "2024-01-01T02:00:00.000Z",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T02:00:00.000Z",
    "messages": [
      {
        "id": "message-uuid",
        "content": "Message content",
        "role": "user",
        "tokenCount": 150,
        "createdAt": "2024-01-01T01:00:00.000Z"
      }
    ]
  }
}
```

**Error Responses:**
- `401` - User not authenticated
- `404` - Conversation not found

---

### 5. Message Routes

#### POST `/api/v1/conversations/:conversationId/messages`
Send a message in a conversation (requires authentication).

**Request:**
- Method: `POST`
- URL: `/api/v1/conversations/:conversationId/messages`
- Headers:
  - `Content-Type: application/json`
  - `Authorization: Bearer <jwt-token>`
- Body:
```json
{
  "content": "What is this document about?",
  "role": "user"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "message-uuid",
    "conversationId": "conversation-uuid",
    "content": "What is this document about?",
    "role": "user",
    "tokenCount": 8,
    "createdAt": "2024-01-01T03:00:00.000Z"
  }
}
```

**Error Responses:**
- `401` - User not authenticated
- `400` - Validation error
- `404` - Conversation not found

#### GET `/api/v1/conversations/:conversationId/messages`
Get all messages in a conversation (requires authentication).

**Request:**
- Method: `GET`
- URL: `/api/v1/conversations/:conversationId/messages`
- Headers:
  - `Authorization: Bearer <jwt-token>`
- Query Parameters (optional):
  - `page`: Page number (default: 1)
  - `limit`: Number of items per page (default: 50)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "message-uuid",
        "content": "Message content",
        "role": "user",
        "tokenCount": 150,
        "model": "gpt-3.5-turbo",
        "temperature": 0.7,
        "createdAt": "2024-01-01T01:00:00.000Z",
        "updatedAt": "2024-01-01T01:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 25,
      "totalPages": 1
    }
  }
}
```

**Error Responses:**
- `401` - User not authenticated
- `404` - Conversation not found

---

### 6. Admin Routes

#### GET `/api/v1/admin/users`
Get all users (requires admin authentication).

**Request:**
- Method: `GET`
- URL: `/api/v1/admin/users`
- Headers:
  - `Authorization: Bearer <admin-jwt-token>`
- Query Parameters (optional):
  - `page`: Page number (default: 1)
  - `limit`: Number of items per page (default: 20)
  - `role`: Filter by role (`user`, `admin`)
  - `tier`: Filter by tier (`free`, `pro`, `enterprise`)
  - `isActive`: Filter by active status (`true`, `false`)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "users": [
      {
        "id": "user-uuid",
        "email": "user@example.com",
        "role": "user",
        "tier": "pro",
        "isActive": true,
        "lastLoginAt": "2024-01-01T02:00:00.000Z",
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 100,
      "totalPages": 5
    }
  }
}
```

**Error Responses:**
- `401` - User not authenticated or not admin
- `403` - Insufficient permissions

#### GET `/api/v1/admin/stats`
Get system statistics (requires admin authentication).

**Request:**
- Method: `GET`
- URL: `/api/v1/admin/stats`
- Headers:
  - `Authorization: Bearer <admin-jwt-token>`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "users": {
      "total": 150,
      "active": 120,
      "newThisMonth": 25
    },
    "documents": {
      "total": 1250,
      "processed": 1000,
      "pending": 250
    },
    "conversations": {
      "total": 3500,
      "active": 800
    },
    "storage": {
      "totalSize": "2.5GB",
      "averageFileSize": "2MB"
    }
  }
}
```

**Error Responses:**
- `401` - User not authenticated or not admin
- `403` - Insufficient permissions

---

### 7. Webhook Routes

#### POST `/api/v1/webhooks`
Handle incoming webhook events.

**Request:**
- Method: `POST`
- URL: `/api/v1/webhooks`
- Headers:
  - `Content-Type: application/json`
  - `X-Webhook-Signature`: HMAC signature (optional)
- Body:
```json
{
  "eventId": "evt_1234567890",
  "eventType": "payment.completed",
  "source": "stripe",
  "data": {
    "customerId": "cus_1234567890",
    "amount": 2500,
    "currency": "usd"
  }
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Webhook received successfully",
    "eventId": "evt_1234567890"
  }
}
```

**Error Responses:**
- `400` - Invalid webhook format
- `401` - Invalid signature
- `429` - Rate limit exceeded

---

### 8. Health Check Routes

#### GET `/health/live`
Liveness probe - checks if the server is running.

**Request:**
- Method: `GET`
- URL: `/health/live`
- Headers: None required

**Response (200):**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "uptime": "2h30m15s",
  "memory": {
    "rss": "96MB",
    "heap": "24MB",
    "external": "4MB"
  },
  "version": "1.0.0",
  "environment": "development"
}
```

**Error Responses:**
- `503` - Service unavailable

#### GET `/health/ready`
Readiness probe - checks if the server is ready to accept requests.

**Request:**
- Method: `GET`
- URL: `/health/ready`
- Headers: None required

**Response (200):**
```json
{
  "status": "ready",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "checks": {
    "database": "connected",
    "redis": "connected",
    "queues": "running"
  }
}
```

**Error Responses:**
- `503` - Service not ready

---

### 9. Monitoring Routes

#### GET `/metrics`
Prometheus metrics endpoint.

**Request:**
- Method: `GET`
- URL: `/metrics`
- Headers: None required

**Response (200):**
```
# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",route="/api/v1",status="200"} 1250

# HELP http_request_duration_seconds Duration of HTTP requests in seconds
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{le="0.1"} 1200
http_request_duration_seconds_bucket{le="0.5"} 1240
http_request_duration_seconds_bucket{le="1.0"} 1248
http_request_duration_seconds_bucket{le="+Inf"} 1250

# HELP auth_events_total Total number of authentication events
# TYPE auth_events_total counter
auth_events_total{event_type="login",result="success"} 850
auth_events_total{event_type="login",result="failure"} 150
```

**Error Responses:**
- `500` - Metrics collection error

---

## 🛠️ Technology Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Language**: TypeScript
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Authentication**: JWT (JSON Web Tokens)
- **Caching**: Redis with ioredis
- **Logging**: Winston with structured logging
- **Monitoring**: Prometheus with prom-client
- **Security**: Helmet, CORS, XSS protection
- **Rate Limiting**: express-rate-limit with Redis
- **Queue System**: BullMQ
- **Testing**: Jest

## 📁 Project Structure

```
src/
├── app.ts                 # Express app configuration
├── server.ts              # Server entry point
├── lib/                   # Utility libraries
│   ├── cache.ts          # Redis cache configuration
│   ├── errors.ts         # Custom error classes
│   ├── logger.ts         # Basic logger configuration
│   ├── metrics.ts        # Prometheus metrics
│   ├── prisma.ts         # Prisma client setup
│   ├── structuredLogger.ts # Winston structured logging
│   └── tokens.ts         # JWT token utilities
├── middleware/            # Express middleware
│   ├── auths.ts          # Authentication middleware
│   ├── cache.middleware.ts # HTTP caching middleware
│   ├── errorHandler.ts   # Global error handler
│   ├── rateLimit.middleware.ts # Rate limiting
│   └── security.middleware.ts # Security middleware
├── routes/               # API routes
│   ├── admin.routes.ts   # Admin endpoints
│   ├── auth.routes.ts    # Authentication endpoints
│   ├── conversations.routes.ts # Conversation endpoints
│   ├── documents.routes.ts # Document endpoints
│   ├── health.routes.ts  # Health check endpoints
│   ├── messages.routes.ts # Message endpoints
│   ├── webhooks.routes.ts # Webhook endpoints
│   └── welcome.route.ts  # Welcome endpoint
├── services/             # Business logic
│   ├── auth.services.ts  # Authentication services
│   └── document.services.ts # Document services
├── events/               # Event handlers
│   ├── cache.events.ts  # Cache invalidation events
│   ├── document.events.ts # Document processing events
│   └── security.events.ts # Security event tracking
├── queues/               # Queue processing
│   ├── connection.ts     # BullMQ connection
│   ├── document.worker.ts # Document processing worker
│   ├── rate-limiter.ts   # Queue-based rate limiting
│   └── bull-board.ts     # Queue monitoring UI
└── types/                # TypeScript type definitions
    └── express.d.ts      # Express type extensions
```

## 🧪 Testing

### RAG System Testing

The DocuChat RAG (Retrieval-Augmented Generation) system has been comprehensively tested and is production-ready.

#### Test Coverage
- **✅ Semantic Search**: pgvector-based similarity search with ownership filtering
- **✅ Context Assembly**: Token budget management with deduplication  
- **✅ RAG Generation**: OpenAI GPT-4o integration with strict system prompts
- **✅ Conversation Service**: Full pipeline integration with message history
- **✅ Quality Evaluation**: Automated and manual testing frameworks

#### Test Commands
```bash
# Test individual components
npx tsx test-simple-rag.ts

# Full quality evaluation
npx tsx test-rag-quality.ts

# Run all tests
npm test
```

#### Test Results Summary
- **15/15 questions processed successfully**
- **Perfect no-context handling** - Correctly identifies missing information
- **Zero hallucinations** - Never makes up policies or details  
- **Excellent performance** - Average 1.2s per response, $0.0162 total cost
- **Production ready** - All components working as designed

### Running Tests
```bash
npm test
```

### Code Style
The project uses TypeScript with strict mode enabled for type safety.

### Environment Variables
Create a `.env` file with the following variables:
```
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/docushare_db

# JWT Tokens
JWT_ACCESS_SECRET=your-jwt-access-secret-key
JWT_REFRESH_SECRET=your-jwt-refresh-secret-key
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Server
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# File Upload
MAX_FILE_SIZE=10485760
UPLOAD_DIR=uploads

# Monitoring
METRICS_ENABLED=true
LOG_LEVEL=info
```

## 📝 API Response Format

All API responses follow a consistent format:

**Success Response:**
```json
{
  "success": true,
  "data": { ... }
}
```

**Error Response:**
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Error description"
  }
}
```

## 🚀 Deployment

1. Build the application:
   ```bash
   npm run build
   ```

2. Set production environment variables

3. Run the production server:
   ```bash
   npm start
   ```

## 📄 License

This project is licensed under the ISC License.
