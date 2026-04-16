import express from "express"
import dotenv from "dotenv"
import documentRoutes from "./routes/documents.routes"
import authRoutes from "./routes/auth.routes"
import conversationRoutes from "./routes/conversations.routes"
import messageRoutes from "./routes/messages.routes"
import welcomeRoutes from "./routes/welcome.route"
import { errorHandler } from "./middleware/errorHandler"
import { logger, customLogger } from "./lib/logger"

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

app.use(errorHandler)

export default app