import type { Request, Response, NextFunction } from "express"
import { AppError } from "../lib/errors"
import { logger } from "../lib/logger"

export function errorHandler(
 err: Error,
 req: Request,
 res: Response,
 next: NextFunction
) {
 if (err instanceof AppError) {
  logger.warn(err.message)

  return res.status(err.statusCode).json({
   success: false,
   error: {
    code: err.code,
    message: err.message
   }
  })
 }

 logger.error(err)

 return res.status(500).json({
  success: false,
  error: {
   code: "INTERNAL_ERROR",
   message: "Unexpected error"
  }
 })
}