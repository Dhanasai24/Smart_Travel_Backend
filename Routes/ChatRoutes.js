import express from "express"
import { authenticateToken } from "../Middleware/Auth.js"
import {
  connectUsers,
  acceptConnection,
  disconnectUsers,
  rejectConnection,
  getRoomWithUser,
  getConnectedUsers,
  getRoomMessages,
  sendMessage,
  getUserRooms,
  getRoomParticipants,
  getRoomStatus,
  getActiveConnections,
  acceptConnectionRequest,
  deleteMessage,
  bulkDeleteMessages,
} from "../controllers/ChatController.js"

const router = express.Router()

// ✅ Connection Management Routes
router.post("/connect", authenticateToken, connectUsers)
router.post("/accept", authenticateToken, acceptConnection)
router.post("/accept-connection", authenticateToken, acceptConnectionRequest)
router.post("/disconnect", authenticateToken, disconnectUsers)
router.post("/reject", authenticateToken, rejectConnection)

// ✅ Room Management Routes
router.get("/room-with-user", authenticateToken, getRoomWithUser)
router.get("/connected-users", authenticateToken, getConnectedUsers)
router.get("/rooms", authenticateToken, getUserRooms)
router.get("/room-status/:roomId", authenticateToken, getRoomStatus)
router.get("/active-connections", authenticateToken, getActiveConnections)

// ✅ Message Routes
router.get("/rooms/:roomId/messages", authenticateToken, getRoomMessages)
router.post("/rooms/:roomId/messages", authenticateToken, sendMessage)
router.get("/rooms/:roomId/participants", authenticateToken, getRoomParticipants)

// ✅ Message Deletion Routes
router.post("/messages/delete", authenticateToken, deleteMessage)
router.post("/messages/bulk-delete", authenticateToken, bulkDeleteMessages)

// ✅ Legacy route for backward compatibility
router.get("/room", authenticateToken, getRoomWithUser)

export default router
