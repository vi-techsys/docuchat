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

 if (!token) throw new UnauthorizedError()

 // Check if token is blacklisted
 const blacklistedToken = await prisma.blacklistedToken.findUnique({
  where: { token }
 })

 if (blacklistedToken) {
  throw new UnauthorizedError()
 }

 const decoded = jwt.verify(
  token,
  process.env.JWT_ACCESS_SECRET!
) as { sub: string; [key: string]: any }

 req.user = decoded

 next()
}