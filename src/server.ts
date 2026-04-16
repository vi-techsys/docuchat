import app from "./app"
import { customLogger } from "./lib/logger"

const PORT = process.env.PORT || 5000

app.listen(PORT, () =>
 customLogger.info(`Server running on port ${PORT}`)
)