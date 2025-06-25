import express from "express"
import {
  createReview,
  getPublicReviews,
  getUserReviews,
  getReviewById,
  voteOnReview,
  getDestinationsWithReviews,
  updateReview,
  deleteReview,
  addToFavorites,
  removeFromFavorites,
  getUserFavorites,
  checkFavoriteStatus,
} from "../controllers/ReviewController.js"
import { authenticateToken } from "../Middleware/Auth.js"

const router = express.Router()

// Public routes (no authentication required)
router.get("/public", getPublicReviews)
router.get("/destinations", getDestinationsWithReviews)
router.get("/:id", getReviewById)

// Protected routes (authentication required)
router.use(authenticateToken) // Apply authentication middleware to all routes below

router.post("/", createReview)
router.get("/user/my-reviews", getUserReviews)
router.put("/:id", updateReview)
router.delete("/:id", deleteReview)
router.post("/:id/vote", voteOnReview)

// Favorite routes
router.post("/:id/favorite", addToFavorites)
router.delete("/:id/favorite", removeFromFavorites)
router.get("/user/favorites", getUserFavorites)
router.post("/favorites/check", checkFavoriteStatus)

export default router
