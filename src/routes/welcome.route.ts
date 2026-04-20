import { Router } from "express"
import type { Request, Response } from "express"
const router = Router()

router.get("/", async (req: Request, res: Response) =>{
res.status(201).json({
      success: true,
      data: {
        message: "Welcome to DocuChat!"
      }
    })
})

export default router