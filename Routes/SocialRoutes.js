import express from "express"
import {
  findMatches,
  discoverTravelers,
  getConnectedChats,
  getNearbyTravelers,
  updateLocation,
  toggleDiscovery,
  getUserLocationForSocial,
  getConnectedUserLocation,
  getUserNotifications,
  clearUserNotifications,
} from "../controllers/SocialController.js"
import { authenticateToken } from "../Middleware/Auth.js"

const router = express.Router()

// Enhanced routes with better organization
router.get("/matches", authenticateToken, findMatches)
router.get("/discover", authenticateToken, discoverTravelers)
router.get("/chats", authenticateToken, getConnectedChats)
router.get("/nearby", authenticateToken, getNearbyTravelers)
router.get("/nearby-distance", authenticateToken, getNearbyTravelers)

// Location routes
router.post("/location", authenticateToken, updateLocation)
router.post("/discovery", authenticateToken, toggleDiscovery)
router.get("/location/:targetUserId", authenticateToken, getUserLocationForSocial)
router.get("/user-location/:targetUserId", authenticateToken, getConnectedUserLocation)

// ✅ NEW: Notification routes for global notification system
router.get("/notifications", authenticateToken, getUserNotifications)
router.post("/notifications/clear", authenticateToken, clearUserNotifications)

export default router
