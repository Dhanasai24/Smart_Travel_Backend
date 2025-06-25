import express from "express"
import { StreamChat } from "stream-chat"
import jwt from "jsonwebtoken"

const router = express.Router()

// Initialize Stream Chat client with your actual credentials
const STREAM_API_KEY = "69sdct4v7bn2"
const STREAM_API_SECRET = "3xnw4mc93xubhdja5nvz4jk7ttahkjm6nzzvxpndg5eahv47hmq9cscwa839dfbt"

let serverClient = null

try {
  serverClient = StreamChat.getInstance(STREAM_API_KEY, STREAM_API_SECRET, {
    baseURL: "https://chat.stream-io-api.com",
    timeout: 15000,
  })
  console.log("✅ Stream Chat server client initialized successfully")
} catch (error) {
  console.error("❌ Failed to initialize Stream Chat server client:", error)
}

// Enhanced error handling middleware
const handleStreamError = (error, context = "Unknown") => {
  console.error(`❌ Stream Chat Error in ${context}:`, error)

  let statusCode = 500
  let message = "Internal server error"

  if (error.message?.includes("token")) {
    statusCode = 401
    message = "Invalid or expired token"
  } else if (error.message?.includes("permission") || error.message?.includes("forbidden")) {
    statusCode = 403
    message = "Permission denied"
  } else if (error.message?.includes("not found")) {
    statusCode = 404
    message = "Resource not found"
  } else if (error.message?.includes("validation") || error.message?.includes("invalid")) {
    statusCode = 400
    message = "Invalid request data"
  } else if (error.message?.includes("network") || error.message?.includes("timeout")) {
    statusCode = 503
    message = "Service temporarily unavailable"
  }

  return {
    statusCode,
    error: message,
    details: process.env.NODE_ENV === "development" ? error.message : undefined,
    context,
    timestamp: new Date().toISOString(),
  }
}

// Middleware to verify user authentication
const authenticateUser = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "No valid authorization token provided",
        timestamp: new Date().toISOString(),
      })
    }

    const token = authHeader.substring(7)
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "your-secret-key")

    if (!decoded.id && !decoded.userId) {
      return res.status(401).json({
        error: "Invalid token payload",
        timestamp: new Date().toISOString(),
      })
    }

    req.user = decoded
    next()
  } catch (error) {
    console.error("Authentication error:", error)
    return res.status(401).json({
      error: "Invalid or expired token",
      timestamp: new Date().toISOString(),
    })
  }
}

// Middleware to check Stream Chat client
const checkStreamClient = (req, res, next) => {
  if (!serverClient) {
    return res.status(503).json({
      error: "Stream Chat service unavailable",
      message: "Chat service is temporarily unavailable. Please try again later.",
      timestamp: new Date().toISOString(),
    })
  }
  next()
}

// Generate Stream Chat token
router.post("/stream-token", authenticateUser, checkStreamClient, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId

    if (!userId) {
      return res.status(400).json({
        error: "User ID not found in token",
        timestamp: new Date().toISOString(),
      })
    }

    console.log(`🔑 Generating Stream Chat token for user: ${userId}`)

    // Generate a token for the user with expiration
    const token = serverClient.createToken(userId.toString())

    if (!token) {
      throw new Error("Failed to generate token")
    }

    console.log(`✅ Generated Stream Chat token for user: ${userId}`)

    res.json({
      success: true,
      token,
      userId: userId.toString(),
      apiKey: STREAM_API_KEY,
      expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour expiry
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("❌ Error generating Stream Chat token:", error)
    const errorInfo = handleStreamError(error, "generate token")
    res.status(errorInfo.statusCode).json(errorInfo)
  }
})

// Create a new channel
router.post("/channels", authenticateUser, checkStreamClient, async (req, res) => {
  try {
    const { channelId, otherUserId, channelName, channelType = "messaging" } = req.body
    const userId = req.user?.id || req.user?.userId

    if (!channelId || !otherUserId) {
      return res.status(400).json({
        error: "Missing required fields: channelId, otherUserId",
        timestamp: new Date().toISOString(),
      })
    }

    console.log(`📡 Creating channel: ${channelId} between users ${userId} and ${otherUserId}`)

    // Create a new channel
    const channel = serverClient.channel(channelType, channelId, {
      members: [userId.toString(), otherUserId.toString()],
      name: channelName || `Chat between ${userId} and ${otherUserId}`,
      created_by_id: userId.toString(),
      created_at: new Date().toISOString(),
    })

    const channelResponse = await channel.create()

    console.log(`✅ Channel created successfully: ${channelId}`)

    res.json({
      success: true,
      channelId,
      channel: {
        id: channel.id,
        type: channel.type,
        cid: channel.cid,
        members: channelResponse.members || {},
        created_at: channelResponse.created_at,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("❌ Error creating channel:", error)
    const errorInfo = handleStreamError(error, "create channel")
    res.status(errorInfo.statusCode).json(errorInfo)
  }
})

// Get user's channels
router.get("/channels", authenticateUser, checkStreamClient, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId
    const { limit = 30, offset = 0 } = req.query

    console.log(`📋 Fetching channels for user: ${userId}`)

    // Query channels where the user is a member
    const filter = {
      type: "messaging",
      members: { $in: [userId.toString()] },
    }
    const sort = [{ last_message_at: -1 }]
    const options = {
      watch: false,
      state: true,
      limit: Number.parseInt(limit),
      offset: Number.parseInt(offset),
    }

    const channels = await serverClient.queryChannels(filter, sort, options)

    console.log(`✅ Found ${channels.length} channels for user: ${userId}`)

    res.json({
      success: true,
      channels: channels.map((channel) => ({
        id: channel.id,
        type: channel.type,
        cid: channel.cid,
        name: channel.data.name,
        members: Object.keys(channel.state.members || {}),
        memberCount: Object.keys(channel.state.members || {}).length,
        lastMessage: channel.state.last_message_at,
        lastMessageAt: channel.state.last_message_at,
        unreadCount: channel.state.unread_count || 0,
        createdAt: channel.data.created_at,
        updatedAt: channel.data.updated_at,
      })),
      total: channels.length,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("❌ Error fetching channels:", error)
    const errorInfo = handleStreamError(error, "fetch channels")
    res.status(errorInfo.statusCode).json(errorInfo)
  }
})

// Get channel messages
router.get("/channels/:channelId/messages", authenticateUser, checkStreamClient, async (req, res) => {
  try {
    const { channelId } = req.params
    const { limit = 50, offset = 0 } = req.query
    const userId = req.user?.id || req.user?.userId

    if (!channelId) {
      return res.status(400).json({
        error: "Channel ID is required",
        timestamp: new Date().toISOString(),
      })
    }

    console.log(`📨 Fetching messages for channel: ${channelId}`)

    // Get the channel
    const channel = serverClient.channel("messaging", channelId)

    // Query messages
    const response = await channel.query({
      messages: {
        limit: Number.parseInt(limit),
        offset: Number.parseInt(offset),
      },
      watch: false,
      state: true,
    })

    if (!response.messages) {
      return res.json({
        success: true,
        messages: [],
        total: 0,
        timestamp: new Date().toISOString(),
      })
    }

    console.log(`✅ Found ${response.messages.length} messages for channel: ${channelId}`)

    res.json({
      success: true,
      messages: response.messages.map((msg) => ({
        id: msg.id,
        text: msg.text || "",
        user: {
          id: msg.user?.id,
          name: msg.user?.name,
          image: msg.user?.image,
        },
        created_at: msg.created_at,
        updated_at: msg.updated_at,
        type: msg.type || "text",
        attachments: msg.attachments || [],
        isOwn: msg.user?.id === userId.toString(),
      })),
      total: response.messages.length,
      channel: {
        id: response.channel?.id,
        type: response.channel?.type,
        memberCount: Object.keys(response.members || {}).length,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("❌ Error fetching messages:", error)
    const errorInfo = handleStreamError(error, "fetch messages")
    res.status(errorInfo.statusCode).json(errorInfo)
  }
})

// Send a message
router.post("/channels/:channelId/messages", authenticateUser, checkStreamClient, async (req, res) => {
  try {
    const { channelId } = req.params
    const { text, type = "text", attachments = [] } = req.body
    const userId = req.user?.id || req.user?.userId

    if (!channelId) {
      return res.status(400).json({
        error: "Channel ID is required",
        timestamp: new Date().toISOString(),
      })
    }

    if (!text || !text.trim()) {
      return res.status(400).json({
        error: "Message text is required",
        timestamp: new Date().toISOString(),
      })
    }

    if (text.length > 1000) {
      return res.status(400).json({
        error: "Message too long. Maximum 1000 characters allowed.",
        timestamp: new Date().toISOString(),
      })
    }

    console.log(`📤 Sending message to channel: ${channelId}`)

    // Get the channel
    const channel = serverClient.channel("messaging", channelId)

    // Send a message
    const messageData = {
      text: text.trim(),
      type,
      user_id: userId.toString(),
    }

    if (attachments.length > 0) {
      messageData.attachments = attachments
    }

    const response = await channel.sendMessage(messageData)

    if (!response.message) {
      throw new Error("Failed to send message")
    }

    console.log(`✅ Message sent successfully to channel: ${channelId}`)

    res.json({
      success: true,
      message: {
        id: response.message.id,
        text: response.message.text,
        type: response.message.type,
        user: response.message.user,
        created_at: response.message.created_at,
        attachments: response.message.attachments || [],
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("❌ Error sending message:", error)
    const errorInfo = handleStreamError(error, "send message")
    res.status(errorInfo.statusCode).json(errorInfo)
  }
})

// Update channel
router.patch("/channels/:channelId", authenticateUser, checkStreamClient, async (req, res) => {
  try {
    const { channelId } = req.params
    const { data } = req.body
    const userId = req.user?.id || req.user?.userId

    if (!channelId) {
      return res.status(400).json({
        error: "Channel ID is required",
        timestamp: new Date().toISOString(),
      })
    }

    if (!data || typeof data !== "object") {
      return res.status(400).json({
        error: "Update data is required",
        timestamp: new Date().toISOString(),
      })
    }

    console.log(`🔄 Updating channel: ${channelId}`)

    // Get the channel
    const channel = serverClient.channel("messaging", channelId)

    // Update the channel
    const response = await channel.update(data, {
      user_id: userId.toString(),
    })

    console.log(`✅ Channel updated successfully: ${channelId}`)

    res.json({
      success: true,
      channel: {
        id: response.channel?.id,
        type: response.channel?.type,
        data: response.channel?.data,
        updated_at: response.channel?.updated_at,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("❌ Error updating channel:", error)
    const errorInfo = handleStreamError(error, "update channel")
    res.status(errorInfo.statusCode).json(errorInfo)
  }
})

// Delete a channel
router.delete("/channels/:channelId", authenticateUser, checkStreamClient, async (req, res) => {
  try {
    const { channelId } = req.params

    if (!channelId) {
      return res.status(400).json({
        error: "Channel ID is required",
        timestamp: new Date().toISOString(),
      })
    }

    console.log(`🗑️ Deleting channel: ${channelId}`)

    // Get the channel
    const channel = serverClient.channel("messaging", channelId)

    // Delete the channel
    await channel.delete()

    console.log(`✅ Channel deleted successfully: ${channelId}`)

    res.json({
      success: true,
      message: "Channel deleted successfully",
      channelId,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("❌ Error deleting channel:", error)
    const errorInfo = handleStreamError(error, "delete channel")
    res.status(errorInfo.statusCode).json(errorInfo)
  }
})

// Get user presence/status
router.get("/users/:userId/status", authenticateUser, checkStreamClient, async (req, res) => {
  try {
    const { userId } = req.params

    if (!userId) {
      return res.status(400).json({
        error: "User ID is required",
        timestamp: new Date().toISOString(),
      })
    }

    console.log(`👤 Fetching status for user: ${userId}`)

    // Get user
    const response = await serverClient.queryUsers({
      id: userId.toString(),
    })

    if (!response.users || response.users.length === 0) {
      return res.status(404).json({
        error: "User not found",
        timestamp: new Date().toISOString(),
      })
    }

    const user = response.users[0]

    console.log(`✅ Found user status: ${userId}`)

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        image: user.image,
        online: user.online || false,
        last_active: user.last_active,
        status: user.status,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("❌ Error fetching user status:", error)
    const errorInfo = handleStreamError(error, "fetch user status")
    res.status(errorInfo.statusCode).json(errorInfo)
  }
})

// Update user status
router.patch("/users/:userId/status", authenticateUser, checkStreamClient, async (req, res) => {
  try {
    const { userId } = req.params
    const { status, online } = req.body
    const requestUserId = req.user?.id || req.user?.userId

    if (!userId) {
      return res.status(400).json({
        error: "User ID is required",
        timestamp: new Date().toISOString(),
      })
    }

    // Users can only update their own status
    if (userId !== requestUserId.toString()) {
      return res.status(403).json({
        error: "You can only update your own status",
        timestamp: new Date().toISOString(),
      })
    }

    console.log(`🔄 Updating status for user: ${userId}`)

    const updateData = {
      last_active: new Date().toISOString(),
    }

    if (status !== undefined) {
      updateData.status = status
    }

    if (online !== undefined) {
      updateData.online = online
    }

    // Update user
    const response = await serverClient.partialUpdateUser({
      id: userId.toString(),
      set: updateData,
    })

    console.log(`✅ User status updated: ${userId}`)

    res.json({
      success: true,
      user: response.user,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("❌ Error updating user status:", error)
    const errorInfo = handleStreamError(error, "update user status")
    res.status(errorInfo.statusCode).json(errorInfo)
  }
})

// Health check endpoint
router.get("/health", (req, res) => {
  const isHealthy = !!serverClient

  res.status(isHealthy ? 200 : 503).json({
    success: isHealthy,
    service: "Stream Chat",
    status: isHealthy ? "healthy" : "unhealthy",
    apiKey: STREAM_API_KEY,
    baseURL: "https://chat.stream-io-api.com",
    timestamp: new Date().toISOString(),
  })
})

export default router
