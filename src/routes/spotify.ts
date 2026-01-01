import { Router, Request, Response } from 'express'

const router = Router()

// Placeholder for additional Spotify API routes
// These can be extended as needed for server-side Spotify operations

router.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' })
})

export default router
