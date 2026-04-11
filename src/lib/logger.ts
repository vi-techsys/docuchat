import pino from "pino"

const loggerOptions = process.env.NODE_ENV === 'test' 
  ? {} 
  : {
      transport: {
        target: "pino-pretty"
      }
    }

export const logger = pino(loggerOptions)