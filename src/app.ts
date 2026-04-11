import express from "express"
import dotenv from "dotenv"
import documentRoutes from "./routes/documents.routes"
import authRoutes from "./routes/auth.routes"
import welcomeRoutes from "./routes/welcome.route"
import { errorHandler } from "./middleware/errorHandler"

dotenv.config()

const app = express()

import { logger } from "./lib/logger"
logger.info("Server starting...")

app.use(express.json())

app.use("/api/v1", welcomeRoutes)
app.use("/api/v1/documents", documentRoutes)
app.use("/api/v1/auth", authRoutes)

app.use(errorHandler)

export default app