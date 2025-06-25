import express from "express"
import {
  saveTrip,
  getUserTrips,
  getTripById,
  deleteTrip,
  toggleFavorite,
  regenerateThumbnail,
  testUnsplash,
  updateActivityCompletion,
  toggleVisibility,
  getPublicTrips,
  findMatches,
} from "../controllers/TripController.js"
import { authenticateToken } from "../Middleware/Auth.js"

const router = express.Router()

// Debug middleware for trip routes
router.use((req, res, next) => {
  console.log(`🛣️ Trip Route: ${req.method} ${req.path}`)
  console.log(`🔐 Auth header: ${req.headers.authorization ? "Present" : "Missing"}`)
  next()
})

// Test Unsplash API
router.get("/test-unsplash", authenticateToken, testUnsplash)

// Trip CRUD operations
router.post("/", authenticateToken, saveTrip) // POST /api/trips/
router.get("/", authenticateToken, getUserTrips) // GET /api/trips/
router.get("/public", authenticateToken, getPublicTrips) // GET /api/trips/public - NEW
router.get("/matches", authenticateToken, findMatches) // GET /api/trips/matches - NEW
router.get("/:id", authenticateToken, getTripById) // GET /api/trips/:id
router.delete("/:id", authenticateToken, deleteTrip) // DELETE /api/trips/:id

// Trip actions
router.post("/:id/favorite", authenticateToken, toggleFavorite)
router.patch("/:id/visibility", authenticateToken, toggleVisibility) // NEW - PATCH for visibility toggle
router.post("/:id/regenerate-thumbnail", authenticateToken, regenerateThumbnail)
router.post("/:id/activity-completion", authenticateToken, updateActivityCompletion)

// Add a specific /save route as well for backward compatibility
router.post("/save", authenticateToken, saveTrip)

console.log("✅ Trip routes loaded successfully")

export default router
