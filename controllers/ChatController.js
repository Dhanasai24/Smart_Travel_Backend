import pool from "../config/database.js"

// ✅ ULTRA-FLEXIBLE: Works with ANY authentication system
export const connectUsers = async (req, res) => {
  try {
    console.log("🔗 === CONNECTION REQUEST DEBUG ===")
    console.log("📋 Full request body:", JSON.stringify(req.body, null, 2))
    console.log("👤 Full req.user object:", JSON.stringify(req.user, null, 2))
    console.log("🔑 Authorization header:", req.headers.authorization)

    const { targetUserId } = req.body

    // ✅ ULTRA-FLEXIBLE USER ID EXTRACTION - Works with ANY auth system
    let userId = null

    // Try all possible user ID field names
    if (req.user) {
      userId = req.user.id || req.user.userId || req.user.user_id || req.user._id || req.user.ID
    }

    // If still no userId, try to extract from token directly
    if (!userId && req.headers.authorization) {
      try {
        const token = req.headers.authorization.replace("Bearer ", "")
        const base64Payload = token.split(".")[1]
        const payload = JSON.parse(Buffer.from(base64Payload, "base64").toString())
        userId = payload.id || payload.userId || payload.user_id || payload.sub
        console.log("🔓 Extracted from token payload:", JSON.stringify(payload, null, 2))
      } catch (tokenError) {
        console.log("⚠️ Could not extract from token:", tokenError.message)
      }
    }

    console.log(`🆔 Final extracted userId: ${userId} (type: ${typeof userId})`)
    console.log(`🎯 Target userId: ${targetUserId} (type: ${typeof targetUserId})`)

    // ✅ BASIC VALIDATION - Very permissive
    if (!userId) {
      console.error("❌ No user ID found anywhere")
      return res.status(400).json({
        success: false,
        message: "User authentication failed - no user ID found",
        debug: {
          reqUser: req.user,
          hasAuth: !!req.headers.authorization,
        },
      })
    }

    if (!targetUserId) {
      console.error("❌ No target user ID provided")
      return res.status(400).json({
        success: false,
        message: "Target user ID is required",
        debug: {
          requestBody: req.body,
        },
      })
    }

    // ✅ FLEXIBLE CONVERSION - Handle any format
    let userIdInt, targetUserIdInt

    // Convert userId
    if (typeof userId === "string") {
      userIdInt = Number.parseInt(userId)
    } else if (typeof userId === "number") {
      userIdInt = userId
    } else {
      userIdInt = Number.parseInt(String(userId))
    }

    // Convert targetUserId
    if (typeof targetUserId === "string") {
      targetUserIdInt = Number.parseInt(targetUserId)
    } else if (typeof targetUserId === "number") {
      targetUserIdInt = targetUserId
    } else {
      targetUserIdInt = Number.parseInt(String(targetUserId))
    }

    console.log(`🔢 Converted IDs - userId: ${userIdInt}, targetUserId: ${targetUserIdInt}`)

    // Final validation
    if (isNaN(userIdInt) || userIdInt <= 0) {
      console.error("❌ Invalid userId after conversion:", userIdInt)
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
        debug: {
          originalUserId: userId,
          convertedUserId: userIdInt,
        },
      })
    }

    if (isNaN(targetUserIdInt) || targetUserIdInt <= 0) {
      console.error("❌ Invalid targetUserId after conversion:", targetUserIdInt)
      return res.status(400).json({
        success: false,
        message: "Invalid target user ID format",
        debug: {
          originalTargetUserId: targetUserId,
          convertedTargetUserId: targetUserIdInt,
        },
      })
    }

    // Prevent self-connection
    if (userIdInt === targetUserIdInt) {
      console.log("❌ Self-connection attempt blocked")
      return res.status(400).json({
        success: false,
        message: "Cannot connect to yourself",
      })
    }

    console.log(`✅ VALIDATION PASSED - User ${userIdInt} connecting to ${targetUserIdInt}`)

    // Generate room ID
    const roomId = `room_${Math.min(userIdInt, targetUserIdInt)}_${Math.max(userIdInt, targetUserIdInt)}`
    console.log(`🏠 Room ID: ${roomId}`)

    // Check existing connection
    console.log("🔍 Checking for existing connection...")
    const existingConnectionQuery = `
      SELECT * FROM user_connections
      WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $3 AND user2_id = $4)
    `

    const existingConnection = await pool.query(existingConnectionQuery, [
      userIdInt,
      targetUserIdInt,
      targetUserIdInt,
      userIdInt,
    ])

    if (existingConnection.rows.length > 0) {
      console.log("✅ Existing connection found:", existingConnection.rows[0])
      return res.json({
        success: true,
        message: "Connection already exists",
        roomId: existingConnection.rows[0].room_id || roomId,
        status: existingConnection.rows[0].status,
        existing: true,
      })
    }

    // Create new connection
    console.log("📝 Creating new connection...")
    const insertQuery = `
      INSERT INTO user_connections (user1_id, user2_id, status, room_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING *
    `

    const insertResult = await pool.query(insertQuery, [
      Math.min(userIdInt, targetUserIdInt),
      Math.max(userIdInt, targetUserIdInt),
      "pending",
      roomId,
    ])

    console.log("🎉 CONNECTION CREATED SUCCESSFULLY:", insertResult.rows[0])

    res.json({
      success: true,
      message: "Connection request sent successfully",
      roomId,
      status: "pending",
      connection: insertResult.rows[0],
      debug: {
        userId: userIdInt,
        targetUserId: targetUserIdInt,
        roomId,
      },
    })
  } catch (error) {
    console.error("💥 FATAL ERROR in connectUsers:", error)
    console.error("Stack trace:", error.stack)

    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
      debug:
        process.env.NODE_ENV === "development"
          ? {
              stack: error.stack,
              reqUser: req.user,
              reqBody: req.body,
            }
          : undefined,
    })
  }
}

// ✅ FLEXIBLE Accept connection
export const acceptConnectionRequest = async (req, res) => {
  try {
    console.log("✅ === ACCEPT CONNECTION DEBUG ===")
    console.log("📋 Request body:", JSON.stringify(req.body, null, 2))
    console.log("👤 req.user:", JSON.stringify(req.user, null, 2))

    const { fromUserId, roomId } = req.body

    // Flexible user ID extraction
    let toUserId = null
    if (req.user) {
      toUserId = req.user.id || req.user.userId || req.user.user_id || req.user._id
    }

    if (!toUserId || !fromUserId) {
      return res.status(400).json({
        success: false,
        message: "Missing user IDs",
        debug: { toUserId, fromUserId },
      })
    }

    const toUserIdInt = Number.parseInt(String(toUserId))
    const fromUserIdInt = Number.parseInt(String(fromUserId))

    if (isNaN(toUserIdInt) || isNaN(fromUserIdInt)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
        debug: { toUserIdInt, fromUserIdInt },
      })
    }

    console.log(`✅ User ${toUserIdInt} accepting connection from ${fromUserIdInt}`)

    const updateQuery = `
      UPDATE user_connections 
      SET status = $1, updated_at = NOW() 
      WHERE (user1_id = $2 AND user2_id = $3) OR (user1_id = $4 AND user2_id = $5)
      RETURNING *
    `

    const result = await pool.query(updateQuery, ["connected", fromUserIdInt, toUserIdInt, toUserIdInt, fromUserIdInt])

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Connection request not found",
      })
    }

    console.log("🎉 CONNECTION ACCEPTED:", result.rows[0])

    res.json({
      success: true,
      message: "Connection accepted successfully",
      roomId,
      status: "connected",
      connection: result.rows[0],
    })
  } catch (error) {
    console.error("💥 Error accepting connection:", error)
    res.status(500).json({
      success: false,
      message: "Failed to accept connection",
      error: error.message,
    })
  }
}

// ✅ FLEXIBLE Get room
export const getRoomWithUser = async (req, res) => {
  try {
    const { withUserId } = req.query

    // Flexible user ID extraction
    let userId = null
    if (req.user) {
      userId = req.user.id || req.user.userId || req.user.user_id || req.user._id
    }

    if (!userId || !withUserId) {
      return res.status(400).json({
        success: false,
        message: "Missing user IDs",
        debug: { userId, withUserId },
      })
    }

    const userIdInt = Number.parseInt(String(userId))
    const withUserIdInt = Number.parseInt(String(withUserId))

    if (isNaN(userIdInt) || isNaN(withUserIdInt)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      })
    }

    const roomId = `room_${Math.min(userIdInt, withUserIdInt)}_${Math.max(userIdInt, withUserIdInt)}`

    const connectionQuery = `
      SELECT * FROM user_connections
      WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $3 AND user2_id = $4)
    `

    const connection = await pool.query(connectionQuery, [userIdInt, withUserIdInt, withUserIdInt, userIdInt])

    if (connection.rows.length === 0) {
      return res.json({
        success: false,
        message: "No connection found",
      })
    }

    res.json({
      success: true,
      roomId: connection.rows[0].room_id || roomId,
      status: connection.rows[0].status,
    })
  } catch (error) {
    console.error("💥 Error getting room:", error)
    res.status(500).json({
      success: false,
      message: "Failed to get room",
      error: error.message,
    })
  }
}

// ✅ FLEXIBLE Disconnect
export const disconnectUsers = async (req, res) => {
  try {
    const { targetUserId } = req.body

    // Flexible user ID extraction
    let userId = null
    if (req.user) {
      userId = req.user.id || req.user.userId || req.user.user_id || req.user._id
    }

    if (!userId || !targetUserId) {
      return res.status(400).json({
        success: false,
        message: "Missing user IDs",
      })
    }

    const userIdInt = Number.parseInt(String(userId))
    const targetUserIdInt = Number.parseInt(String(targetUserId))

    if (isNaN(userIdInt) || isNaN(targetUserIdInt)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      })
    }

    const deleteQuery = `
      DELETE FROM user_connections 
      WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $3 AND user2_id = $4)
    `

    const deleteResult = await pool.query(deleteQuery, [userIdInt, targetUserIdInt, targetUserIdInt, userIdInt])

    res.json({
      success: true,
      message: "Users disconnected successfully",
      disconnectedFrom: targetUserIdInt,
      affectedRows: deleteResult.rowCount,
    })
  } catch (error) {
    console.error("💥 Error disconnecting users:", error)
    res.status(500).json({
      success: false,
      message: "Failed to disconnect users",
      error: error.message,
    })
  }
}

// ✅ FLEXIBLE Get active connections
export const getActiveConnections = async (req, res) => {
  try {
    // Flexible user ID extraction
    let userId = null
    if (req.user) {
      userId = req.user.id || req.user.userId || req.user.user_id || req.user._id
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID missing",
      })
    }

    const userIdInt = Number.parseInt(String(userId))

    if (isNaN(userIdInt)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      })
    }

    const connectionsQuery = `
      SELECT 
        CASE 
          WHEN uc.user1_id = $1 THEN uc.user2_id 
          ELSE uc.user1_id 
        END as connected_user_id,
        CASE 
          WHEN uc.user1_id = $2 THEN u2.name 
          ELSE u1.name 
        END as connected_user_name,
        uc.status,
        uc.room_id
      FROM user_connections uc
      LEFT JOIN users u1 ON uc.user1_id = u1.id
      LEFT JOIN users u2 ON uc.user2_id = u2.id
      WHERE (uc.user1_id = $3 OR uc.user2_id = $4) AND uc.status = $5
    `

    const connections = await pool.query(connectionsQuery, [userIdInt, userIdInt, userIdInt, userIdInt, "connected"])

    res.json({
      success: true,
      connections: connections.rows.map((conn) => ({
        userId: conn.connected_user_id,
        userName: conn.connected_user_name,
        status: conn.status,
        roomId: conn.room_id,
      })),
    })
  } catch (error) {
    console.error("💥 Error fetching active connections:", error)
    res.status(500).json({
      success: false,
      message: "Failed to fetch active connections",
      error: error.message,
    })
  }
}

// ✅ FLEXIBLE Delete single message
export const deleteMessage = async (req, res) => {
  try {
    console.log("🗑️ === DELETE MESSAGE DEBUG ===")
    console.log("📋 Request body:", JSON.stringify(req.body, null, 2))
    console.log("👤 req.user:", JSON.stringify(req.user, null, 2))

    const { messageId, roomId } = req.body

    // Flexible user ID extraction
    let userId = null
    if (req.user) {
      userId = req.user.id || req.user.userId || req.user.user_id || req.user._id
    }

    if (!userId || !messageId || !roomId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
        debug: { userId, messageId, roomId },
      })
    }

    const userIdInt = Number.parseInt(String(userId))
    const messageIdInt = Number.parseInt(String(messageId))

    if (isNaN(userIdInt) || isNaN(messageIdInt)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ID format",
      })
    }

    console.log(`🗑️ User ${userIdInt} deleting message ${messageIdInt} from room ${roomId}`)

    // Check if message exists and belongs to the user
    const checkMessageQuery = `
      SELECT * FROM chat_messages 
      WHERE id = $1 AND sender_id = $2 AND room_id = $3
    `

    const messageCheck = await pool.query(checkMessageQuery, [messageIdInt, userIdInt, roomId])

    if (messageCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Message not found or you don't have permission to delete it",
      })
    }

    // Delete the message
    const deleteQuery = `
      DELETE FROM chat_messages 
      WHERE id = $1 AND sender_id = $2 AND room_id = $3
      RETURNING *
    `

    const deleteResult = await pool.query(deleteQuery, [messageIdInt, userIdInt, roomId])

    if (deleteResult.rows.length === 0) {
      return res.status(500).json({
        success: false,
        message: "Failed to delete message",
      })
    }

    console.log("✅ Message deleted successfully:", deleteResult.rows[0])

    res.json({
      success: true,
      message: "Message deleted successfully",
      deletedMessage: deleteResult.rows[0],
    })
  } catch (error) {
    console.error("💥 Error deleting message:", error)
    res.status(500).json({
      success: false,
      message: "Failed to delete message",
      error: error.message,
    })
  }
}

// ✅ FLEXIBLE Bulk delete messages
export const bulkDeleteMessages = async (req, res) => {
  try {
    console.log("🗑️ === BULK DELETE MESSAGES DEBUG ===")
    console.log("📋 Request body:", JSON.stringify(req.body, null, 2))
    console.log("👤 req.user:", JSON.stringify(req.user, null, 2))

    const { messageIds, roomId } = req.body

    // Flexible user ID extraction
    let userId = null
    if (req.user) {
      userId = req.user.id || req.user.userId || req.user.user_id || req.user._id
    }

    if (!userId || !messageIds || !Array.isArray(messageIds) || messageIds.length === 0 || !roomId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields or invalid messageIds array",
        debug: { userId, messageIds, roomId },
      })
    }

    const userIdInt = Number.parseInt(String(userId))
    const messageIdsInt = messageIds.map((id) => Number.parseInt(String(id))).filter((id) => !isNaN(id))

    if (isNaN(userIdInt) || messageIdsInt.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid ID format",
      })
    }

    console.log(`🗑️ User ${userIdInt} bulk deleting ${messageIdsInt.length} messages from room ${roomId}`)

    // Check which messages exist and belong to the user
    const checkMessagesQuery = `
      SELECT id FROM chat_messages 
      WHERE id = ANY($1) AND sender_id = $2 AND room_id = $3
    `

    const messageCheck = await pool.query(checkMessagesQuery, [messageIdsInt, userIdInt, roomId])
    const validMessageIds = messageCheck.rows.map((row) => row.id)

    if (validMessageIds.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No valid messages found to delete",
      })
    }

    // Delete the messages
    const deleteQuery = `
      DELETE FROM chat_messages 
      WHERE id = ANY($1) AND sender_id = $2 AND room_id = $3
      RETURNING id
    `

    const deleteResult = await pool.query(deleteQuery, [validMessageIds, userIdInt, roomId])

    console.log(`✅ ${deleteResult.rows.length} messages deleted successfully`)

    res.json({
      success: true,
      message: `${deleteResult.rows.length} messages deleted successfully`,
      deletedCount: deleteResult.rows.length,
      deletedMessageIds: deleteResult.rows.map((row) => row.id),
    })
  } catch (error) {
    console.error("💥 Error bulk deleting messages:", error)
    res.status(500).json({
      success: false,
      message: "Failed to delete messages",
      error: error.message,
    })
  }
}

// Placeholder functions
export const acceptConnection = async (req, res) => {
  res.json({ success: true, message: "Use acceptConnectionRequest instead" })
}

export const rejectConnection = async (req, res) => {
  res.json({ success: true, message: "Connection rejected" })
}

export const getConnectedUsers = async (req, res) => {
  res.json({ success: true, users: [] })
}

export const getRoomMessages = async (req, res) => {
  res.json({ success: true, messages: [] })
}

export const sendMessage = async (req, res) => {
  res.json({ success: true, message: "Message sent" })
}

export const getUserRooms = async (req, res) => {
  res.json({ success: true, rooms: [] })
}

export const getRoomParticipants = async (req, res) => {
  res.json({ success: true, participants: [] })
}

export const getRoomStatus = async (req, res) => {
  res.json({ success: true, status: "none" })
}
