import type { Request, Response, NextFunction } from "express"
import { AppError } from "../lib/errors"
import { customLogger } from "../lib/logger"

export function errorHandler(
 err: Error,
 req: Request,
 res: Response,
 next: NextFunction
) {
 if (err instanceof AppError) {
  customLogger.warn(err.message)

  return res.status(err.statusCode).json({
   success: false,
   error: {
    code: err.code,
    message: err.message
   }
  })
 }

 customLogger.error(err.message || err.stack || String(err))

 return res.status(500).json({
  success: false,
  error: {
   code: "INTERNAL_ERROR",
   message: "Unexpected error"
  }
 })
}