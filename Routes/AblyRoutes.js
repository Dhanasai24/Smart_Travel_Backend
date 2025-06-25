import express from "express"
import Ably from "ably"
import jwt from "jsonwebtoken"

const router = express.Router()

// Validate Ably API key
if (!process.env.ABLY_API_KEY) {
  console.error("❌ ABLY_API_KEY not found in environment variables")
  process.exit(1)
}

console.log("✅ Ably API Key configured:", process.env.ABLY_API_KEY.substring(0, 20) + "...")

// Initialize Ably with API key from environment
const ably = new Ably.Realtime(process.env.ABLY_API_KEY)

// Middleware to verify user authentication
const authenticateUser = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No valid authorization token provided" })
    }

    const token = authHeader.substring(7)
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "your-secret-key")
    req.user = decoded
    next()
  } catch (error) {
    console.error("Authentication error:", error)
    return res.status(401).json({ error: "Invalid or expired token" })
  }
}

// Token endpoint - handle both GET and POST requests (Ably can use either)
router.all("/token", async (req, res) => {
  try {
    // Handle both GET (query params) and POST (body) requests
    const clientId = req.body?.clientId || req.query?.clientId || `user_${Date.now()}`

    console.log(`🔑 Generating Ably token for clientId: ${clientId}`)
    console.log("Request method:", req.method)
    console.log("Request body:", req.body)
    console.log("Request query:", req.query)

    // Generate token request with comprehensive capabilities
    const tokenRequest = await ably.auth.createTokenRequest({
      clientId: clientId,
      capability: {
        // Global social channel
        "social-travel": ["*"],

        // User-specific channels - allow all users to subscribe to any user channel
        "user:*": ["*"],

        // Room channels for chat
        "room:*": ["*"],

        // Global updates
        "global-updates": ["subscribe"],

        // Call channels
        "call:*": ["*"],

        // Presence channels
        "presence:*": ["*"],
      },
      ttl: 3600000, // 1 hour
    })

    console.log(`✅ Ably token generated successfully for clientId: ${clientId}`)

    // Return the token request in the format Ably expects
    res.json(tokenRequest)
  } catch (error) {
    console.error("❌ Error creating Ably token:", error)
    res.status(500).json({
      error: "Failed to create Ably token",
      details: error.message,
      timestamp: new Date().toISOString(),
    })
  }
})

// Refresh token endpoint
router.post("/refresh-token", authenticateUser, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId
    const { clientId } = req.body

    const finalClientId = clientId || `user_${userId}`

    console.log(`🔄 Refreshing Ably token for user: ${userId}`)

    const tokenRequest = await ably.auth.createTokenRequest({
      clientId: finalClientId,
      capability: {
        "social-travel": ["*"],
        [`user:${userId}`]: ["*"],
        "user:*": ["subscribe", "presence"],
        "room:*": ["*"],
        "global-updates": ["subscribe"],
        "call:*": ["*"],
        "presence:*": ["*"],
      },
      ttl: 3600000, // 1 hour
    })

    console.log(`✅ Ably token refreshed successfully for user: ${userId}`)

    res.json({
      success: true,
      tokenRequest,
      clientId: finalClientId,
      userId: userId,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    })
  } catch (error) {
    console.error("❌ Error refreshing Ably token:", error)
    res.status(500).json({
      error: "Failed to refresh Ably token",
      details: error.message,
    })
  }
})

// Health check endpoint
router.get("/health", (req, res) => {
  try {
    res.json({
      status: "Ably service healthy",
      timestamp: new Date().toISOString(),
      connection: ably.connection.state,
      features: {
        tokenGeneration: "enabled",
        realTimeMessaging: "enabled",
        presence: "enabled",
        channels: "enabled",
      },
    })
  } catch (error) {
    console.error("❌ Ably health check error:", error)
    res.status(500).json({
      status: "Ably service unhealthy",
      error: error.message,
      timestamp: new Date().toISOString(),
    })
  }
})

// Get connection stats
router.get("/stats", authenticateUser, (req, res) => {
  try {
    res.json({
      success: true,
      stats: {
        connectionState: ably.connection.state,
        connectionId: ably.connection.id,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      },
    })
  } catch (error) {
    console.error("❌ Error getting Ably stats:", error)
    res.status(500).json({
      error: "Failed to get Ably stats",
      details: error.message,
    })
  }
})

// Publish message to channel (for server-side messaging)
router.post("/publish", authenticateUser, async (req, res) => {
  try {
    const { channelName, eventName, data } = req.body
    const userId = req.user?.id || req.user?.userId

    if (!channelName || !eventName || !data) {
      return res.status(400).json({
        error: "Missing required fields: channelName, eventName, data",
      })
    }

    console.log(`📤 Publishing message to channel: ${channelName}, event: ${eventName}`)

    const channel = ably.channels.get(channelName)
    await channel.publish(eventName, {
      ...data,
      serverTimestamp: Date.now(),
      publishedBy: userId,
    })

    console.log(`✅ Message published successfully to ${channelName}`)

    res.json({
      success: true,
      message: "Message published successfully",
      channelName,
      eventName,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("❌ Error publishing message:", error)
    res.status(500).json({
      error: "Failed to publish message",
      details: error.message,
    })
  }
})

// Get channel presence
router.get("/presence/:channelName", authenticateUser, async (req, res) => {
  try {
    const { channelName } = req.params

    console.log(`👥 Getting presence for channel: ${channelName}`)

    const channel = ably.channels.get(channelName)
    const presence = await channel.presence.get()

    res.json({
      success: true,
      channelName,
      presence: presence.map((member) => ({
        clientId: member.clientId,
        data: member.data,
        action: member.action,
        timestamp: member.timestamp,
      })),
      count: presence.length,
    })
  } catch (error) {
    console.error("❌ Error getting channel presence:", error)
    res.status(500).json({
      error: "Failed to get channel presence",
      details: error.message,
    })
  }
})

// Debug endpoint to list active channels
router.get("/channels", authenticateUser, async (req, res) => {
  try {
    // Note: Ably doesn't provide a direct way to list all channels
    // This is a placeholder for debugging purposes
    res.json({
      success: true,
      message: "Channel listing not directly available via Ably API",
      commonChannels: ["social-travel", `user:${req.user?.id || req.user?.userId}`, "global-updates"],
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("❌ Error listing channels:", error)
    res.status(500).json({
      error: "Failed to list channels",
      details: error.message,
    })
  }
})

export default router
