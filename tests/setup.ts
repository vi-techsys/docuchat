// Global test setup
import '@jest/globals'

// Mock the global types for Jest
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

export {};
