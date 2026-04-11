import jwt from "jsonwebtoken"

export const generateAccessToken = (userId: string) =>
 jwt.sign(
  { sub: userId },
  process.env.JWT_ACCESS_SECRET!,
  { expiresIn: "15m" }
 )

export const generateRefreshToken = (userId: string) =>
 jwt.sign(
  { sub: userId },
  process.env.JWT_REFRESH_SECRET!,
  { expiresIn: "7d" }
 )