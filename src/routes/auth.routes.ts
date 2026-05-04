import { Router } from "express"
import type { Request, Response } from "express"
import { register, login, logout } from "../services/auth.services"
import { authenticate } from "../middleware/auths"
import { noCache } from "../middleware/cache.middleware"
import { prisma } from "../lib/prisma"

const router = Router()

// Apply no-cache to all auth routes
router.use(noCache())

router.post("/register", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password are required"
      })
    }

    const user = await register(email, password)
    
    res.status(201).json({
      success: true,
      data: {
        id: user.id,
        email: user.email
      }
    })
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Registration failed"
    })
  }
})

router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password are required"
      })
    }

    const ip = req.ip || req.connection.remoteAddress
    const userAgent = req.get('User-Agent')
    
    const tokens = await login(email, password, ip, userAgent)
    
    res.json({
      success: true,
      data: tokens
    })
  } catch (error) {
    res.status(401).json({
      success: false,
      error: error instanceof Error ? error.message : "Login failed"
    })
  }
})

router.post("/logout", authenticate, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: "User not authenticated"
      })
    }

    const token = req.headers.authorization?.split(" ")[1]
    await logout(req.user.sub, token!)
    
    res.json({
      success: true,
      data: {
        message: "Logged out successfully"
      }
    })
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Logout failed"
    })
  }
})

// Admin registration endpoint (for initial setup)
router.post("/register-admin", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password are required"
      })
    }

    // Check if any admin users already exist
    const existingAdmin = await prisma.user.findFirst({
      where: { 
        role: 'admin',
        deletedAt: null 
      }
    })

    if (existingAdmin) {
      return res.status(403).json({
        success: false,
        error: "Admin user already exists. Use regular registration and role update."
      })
    }

    // Create admin user
    const user = await prisma.user.create({
      data: { 
        email, 
        passwordHash: await (await import('bcryptjs')).hash(password, 12),
        role: 'admin',
        tier: 'enterprise'
      }
    })
    
    res.status(201).json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        role: user.role,
        tier: user.tier,
        message: "Admin user created successfully"
      }
    })
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Admin registration failed"
    })
  }
})

export default router
