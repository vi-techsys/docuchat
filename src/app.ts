import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import documentRoutes from "./routes/documents.routes"
import authRoutes from "./routes/auth.routes"
import conversationRoutes from "./routes/conversations.routes"
import messageRoutes from "./routes/messages.routes"
import webhookRoutes from "./routes/webhooks.routes"
import adminRoutes from "./routes/admin.routes"
import welcomeRoutes from "./routes/welcome.route"
import healthRoutes from "./routes/health.routes"
import ragRoutes from "./routes/rag.routes"
import agentRoutes from "./routes/agent.routes"
import { errorHandler } from "./middleware/errorHandler"
import { logger, customLogger } from "./lib/logger"
import { metricsHandler } from "./lib/metrics"
import { corsConfig, helmetMiddleware, sanitizeInput } from "./middleware/security.middleware"

// Import event listeners
import "./events/ingestion.events"

// Import and initialize queue workers
import "./queues/document-processing.worker"

dotenv.config()

const app = express()

customLogger.info("Server starting...")

// Security middleware (must be early)
app.use(helmetMiddleware)

// Basic middleware
app.use(cors(corsConfig))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Input sanitization
app.use(sanitizeInput)

// Request logging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// Health check endpoints (no authentication required)
app.use("/health", healthRoutes)

// Metrics endpoint
app.get("/metrics", metricsHandler)

// API routes
app.use("/api/v1", welcomeRoutes)
app.use("/api/v1/documents", documentRoutes)
app.use("/api/v1/rag", ragRoutes)
app.use("/api/v1/agent", agentRoutes)
app.use("/api/v1/auth", authRoutes)
app.use("/api/v1/admin", adminRoutes)
app.use("/api/v1/conversations", conversationRoutes)
app.use("/api/v1/conversations", messageRoutes)

app.use("/api/v1/webhooks", express.raw({ type: 'application/json' }));
app.use("/api/v1/webhooks", webhookRoutes)

app.use(errorHandler)

export default app
