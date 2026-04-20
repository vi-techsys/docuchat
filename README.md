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

---

### 3. Documents Routes

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
  "status": "pending"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "document-uuid",
    "userId": "user-uuid",
    "title": "Document Title",
    "content": "Document content",
    "status": "pending",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Error Responses:**
- `401` - User not authenticated
- `400` - Validation error or missing required fields

---

## 🛠️ Technology Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Language**: TypeScript
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Authentication**: JWT (JSON Web Tokens)
- **Logging**: Pino
- **Testing**: Jest

## 📁 Project Structure

```
src/
├── app.ts                 # Express app configuration
├── server.ts              # Server entry point
├── lib/                   # Utility libraries
│   ├── errors.ts         # Custom error classes
│   ├── logger.ts         # Logger configuration
│   └── prisma.ts         # Prisma client setup
├── middleware/            # Express middleware
│   ├── auths.ts          # Authentication middleware
│   └── errorHandler.ts   # Global error handler
├── routes/               # API routes
│   ├── auth.routes.ts    # Authentication endpoints
│   ├── documents.routes.ts # Document endpoints
│   └── welcome.route.ts  # Welcome endpoint
├── services/             # Business logic
│   ├── auth.services.ts  # Authentication services
│   └── document.services.ts # Document services
└── types/                # TypeScript type definitions
    └── express.d.ts      # Express type extensions
```

## 🔧 Development

### Running Tests
```bash
npm test
```

### Code Style
The project uses TypeScript with strict mode enabled for type safety.

### Environment Variables
Create a `.env` file with the following variables:
```
DATABASE_URL=postgresql://username:password@localhost:5432/DocuChat
JWT_ACCESS_SECRET=your-jwt-access-secret
JWT_REFRESH_SECRET=your-jwt-refresh-secret
PORT=5000
NODE_ENV=development
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
