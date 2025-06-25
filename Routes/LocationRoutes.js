import express from "express"
import { updateLocation, getLocation, getUserLocation, toggleDiscovery } from "../controllers/LocationController.js"
import { authenticateToken } from "../Middleware/Auth.js"

const router = express.Router()

// Update user's location
router.post("/update", authenticateToken, updateLocation)

// Get user's own location
router.get("/current", authenticateToken, getLocation)

// Get another user's location
router.get("/user/:targetUserId", authenticateToken, getUserLocation)

// Toggle location discovery
router.post("/toggle-discovery", authenticateToken, toggleDiscovery)

export default router
