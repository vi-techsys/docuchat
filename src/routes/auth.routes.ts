import { Router } from "express"
import type { Request, Response } from "express"
import { register, login, logout } from "../services/auth.services"
import { authenticate } from "../middleware/auths"
import { noCache } from "../middleware/cache.middleware"

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

    const tokens = await login(email, password)
    
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
export default router
