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
import { errorHandler } from "./middleware/errorHandler"
import { logger, customLogger } from "./lib/logger"
import { logger as structuredLogger, correlationIdMiddleware, requestLogger } from "./lib/structuredLogger"
import { metricsMiddleware, metricsHandler } from "./lib/metrics"
import { 
  helmetMiddleware, 
  sanitizeInput, 
  attachFingerprint, 
  trackSuspiciousActivity,
  corsConfig 
} from "./middleware/security.middleware"
import { 
  authLimiter, 
  tieredApiLimiter, 
  tieredUploadLimiter, 
  tieredChatLimiter,
  apiLimiter 
} from "./middleware/rateLimit.middleware"
// Import document events to ensure they're loaded
import "./events/document.events"
// Import cache events to ensure they're loaded
import "./events/cache.events"
// Import security events to ensure they're loaded
import "./events/security.events"
// Import worker and Bull Board for queue processing
import "./queues/document.worker"
import { setupBullBoard } from "./queues/bull-board"

dotenv.config()

const app = express()

structuredLogger.info("Server starting...")

// Security and middleware setup
app.use(helmetMiddleware)
app.use(cors(corsConfig))
app.use(correlationIdMiddleware)
app.use(requestLogger)
app.use(metricsMiddleware)
app.use(attachFingerprint)
app.use(trackSuspiciousActivity)
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.use(sanitizeInput)

// Apply rate limiting to different route groups
app.use("/api/v1/auth", authLimiter)
app.use("/api/v1/auth", tieredApiLimiter)
app.use("/api/v1/documents", tieredApiLimiter)
app.use("/api/v1/documents", tieredUploadLimiter) // For upload endpoints
app.use("/api/v1/conversations", tieredApiLimiter)
app.use("/api/v1/conversations", tieredChatLimiter) // For chat endpoints
app.use("/api/v1/admin", tieredApiLimiter)
app.use("/api/v1", apiLimiter) // General API limiter as fallback

// Health check endpoints (no authentication required)
app.use("/health", healthRoutes)

// Metrics endpoint (no authentication required, but should be protected in production)
app.get("/metrics", metricsHandler)

// API routes
app.use("/api/v1", welcomeRoutes)
app.use("/api/v1/documents", documentRoutes)
app.use("/api/v1/auth", authRoutes)
app.use("/api/v1/admin", adminRoutes)
app.use("/api/v1/conversations", conversationRoutes)
app.use("/api/v1/conversations", messageRoutes)

app.use("/api/v1/webhooks", express.raw({ type: 'application/json' }));
app.use("/api/v1/webhooks", webhookRoutes)

// Setup Bull Board for queue monitoring
setupBullBoard(app)

app.use(errorHandler)

export default app