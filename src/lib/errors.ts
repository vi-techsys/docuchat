export class AppError extends Error {
 constructor(
  public message: string,
  public statusCode: number,
  public code: string
 ) {
  super(message)
 }
}

export class UnauthorizedError extends AppError {
 constructor(message = "Unauthorized") {
  super(message, 401, "UNAUTHORIZED")
 }
}

export class NotFoundError extends AppError {
 constructor(message = "Not Found") {
  super(message, 404, "NOT_FOUND")
 }
}