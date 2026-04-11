/// <reference path="../types/express.d.ts>
import { Router } from "express"
import type { Request, Response } from "express"
import { authenticate } from "../middleware/auths"
import { createDocument, getDocuments } from "../services/document.services"

const router = Router()

router.post("/", authenticate, async (req: Request, res: Response) => {

 if (!req.user) {
  throw new Error("User not authenticated")
}

try {
  
  const doc = await createDocument(req.user.sub, req.body)

  res.json({
    success: true,
    data: doc
  })
} catch (error: any) {
  throw error
}
})

router.get("/", authenticate, async (req: Request, res: Response) => {
  const docs = await getDocuments()
  res.json({
    success: true,
    data: docs
  })
})
export default router