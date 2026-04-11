import type { Request } from 'express'

declare global {
  namespace Express {
    interface Request {
      user?: {
        sub: string
        [key: string]: any
      }
    }
  }
}
