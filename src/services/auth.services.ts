import bcrypt from "bcryptjs"
import { prisma } from "../lib/prisma"
import { generateAccessToken, generateRefreshToken } from "../lib/tokens"

export async function register(email: string, password: string) {

 const hash = await bcrypt.hash(password, 12)

 return prisma.user.create({
  data: { email, passwordHash: hash }
 })
}

export async function login(email: string, password: string) {

 const user = await prisma.user.findFirst({
  where: { email, deletedAt: null }
 })

 if (!user) throw Error("Invalid credentials")

 const valid = await bcrypt.compare(password, user.passwordHash)

 if (!valid) throw Error("Invalid credentials")

 const refreshToken = generateRefreshToken(user.id)
  
  // Store refresh token in database
  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    }
  })

  return {
    accessToken: generateAccessToken(user.id),
    refreshToken
  }
}

export async function logout(userId: string, accessToken: string) {
  // Soft delete all refresh tokens for this user
  await prisma.refreshToken.updateMany({
    where: { userId, deletedAt: null },
    data: { deletedAt: new Date() }
  })
  
  // Blacklist the access token to invalidate it immediately
  await prisma.blacklistedToken.create({
    data: {
      token: accessToken,
      userId,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes from now
    }
  })
  
  return { success: true }
}

export async function softDeleteUser(userId: string) {
  return prisma.user.update({
    where: { id: userId },
    data: { deletedAt: new Date() }
  })
}

export async function getUserById(userId: string) {
  return prisma.user.findFirst({
    where: { id: userId, deletedAt: null }
  })
}