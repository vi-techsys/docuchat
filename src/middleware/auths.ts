/// <reference path="../types/express.d.ts" />
import type { Request, Response, NextFunction } from "express"
import jwt from "jsonwebtoken"
import { UnauthorizedError } from "../lib/errors"
import { prisma } from "../lib/prisma"

export const authenticate = async (
 req: Request,
 res: Response,
 next: NextFunction
) => {
 const token = req.headers.authorization?.split(" ")[1]

 if (!token) {
  return res.status(401).json({
   success: false,
   error: {
    code: "UNAUTHENTICATED",
    message: "Authentication required"
   }
  })
 }

 // Check if token is blacklisted
 const blacklistedToken = await prisma.blacklistedToken.findUnique({
  where: { token }
 })

 if (blacklistedToken) {
  return res.status(401).json({
   success: false,
   error: {
    code: "UNAUTHENTICATED",
    message: "Token has been revoked"
   }
  })
 }

 try {
  const decoded = jwt.verify(
   token,
   process.env.JWT_ACCESS_SECRET!
  ) as { sub: string; [key: string]: any }

  req.user = decoded
  next()
 } catch (error) {
  // Handle specific JWT errors
  if (error instanceof jwt.TokenExpiredError) {
   return res.status(401).json({
    success: false,
    error: {
     code: "TOKEN_EXPIRED",
     message: "Authentication token has expired"
    }
   })
  }
  
  if (error instanceof jwt.JsonWebTokenError) {
   return res.status(401).json({
    success: false,
    error: {
     code: "INVALID_TOKEN",
     message: "Invalid authentication token"
    }
   })
  }

  // Generic authentication error
  return res.status(401).json({
   success: false,
   error: {
    code: "UNAUTHENTICATED",
    message: "Authentication failed"
   }
  })
 }
}