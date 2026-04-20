import express from "express"
import dotenv from "dotenv"
import documentRoutes from "./routes/documents.routes"
import authRoutes from "./routes/auth.routes"
import conversationRoutes from "./routes/conversations.routes"
import messageRoutes from "./routes/messages.routes"
import webhookRoutes from "./routes/webhooks.routes"
import welcomeRoutes from "./routes/welcome.route"
import { errorHandler } from "./middleware/errorHandler"
import { logger, customLogger } from "./lib/logger"
// Import document events to ensure they're loaded
import "./events/document.events"
// Import worker and Bull Board for queue processing
import "./queues/document.worker"
import { setupBullBoard } from "./queues/bull-board"

dotenv.config()

const app = express()

customLogger.info("Server starting...")

app.use(express.json())
app.use(logger)

app.use("/api/v1", welcomeRoutes)
app.use("/api/v1/documents", documentRoutes)
app.use("/api/v1/auth", authRoutes)
app.use("/api/v1/conversations", conversationRoutes)
app.use("/api/v1/conversations", messageRoutes)

app.use("/api/v1/webhooks", express.raw({ type: 'application/json' }));
app.use("/api/v1/webhooks", webhookRoutes)

// Setup Bull Board for queue monitoring
setupBullBoard(app)

app.use(errorHandler)

export default app