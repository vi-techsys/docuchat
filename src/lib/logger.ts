import morgan from "morgan"
import fs from "fs"
import path from "path"

const logFormat = process.env.NODE_ENV === 'production' 
  ? 'combined' 
  : 'dev'

const logStream = process.env.NODE_ENV === 'production' 
  ? fs.createWriteStream(path.join(process.cwd(), 'access.log'), { flags: 'a' })
  : process.stdout

export const logger = morgan(logFormat, {
  stream: logStream
})

export const customLogger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  error: (message: string) => console.error(`[ERROR] ${message}`),
  warn: (message: string) => console.warn(`[WARN] ${message}`)
}