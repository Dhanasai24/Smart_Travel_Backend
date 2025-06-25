import express from "express"
import pkg from "agora-access-token"
const { RtcTokenBuilder, RtmTokenBuilder, RtcRole } = pkg
import { authenticateToken } from "../Middleware/Auth.js"

const router = express.Router()

// Agora credentials from environment variables
const APP_ID = process.env.APP_ID || "575ee05e13944b2fa1611a6088081542"
const APP_CERTIFICATE = process.env.APP_CERTIFICATE || "03361c614ed8420a830cbb95f8e06d0b"

// ✅ Generate RTC Token for Audio/Video calls
router.post("/rtc-token", authenticateToken, async (req, res) => {
  try {
    const { channelName, userId, role = "publisher" } = req.body

    if (!channelName || !userId) {
      return res.status(400).json({
        success: false,
        message: "Channel name and user ID are required",
      })
    }

    console.log(`🎫 Generating RTC token for channel: ${channelName}, user: ${userId}`)

    // Check if APP_CERTIFICATE is set
    if (!APP_CERTIFICATE || APP_CERTIFICATE === "03361c614ed8420a830cbb95f8e06d0b") {
      console.warn("⚠️ APP_CERTIFICATE not set, returning null token")
      return res.json({
        success: true,
        token: null,
        message: "No certificate configured - using null token for development",
        appId: APP_ID,
        channelName,
        userId,
      })
    }

    // Set token expiration time (24 hours from now)
    const expirationTimeInSeconds = Math.floor(Date.now() / 1000) + 24 * 3600

    // Determine role
    const rtcRole = role === "audience" ? RtcRole.AUDIENCE : RtcRole.PUBLISHER

    // Generate RTC token
    const token = RtcTokenBuilder.buildTokenWithUid(
      APP_ID,
      APP_CERTIFICATE,
      channelName,
      Number.parseInt(userId),
      rtcRole,
      expirationTimeInSeconds,
    )

    console.log("✅ RTC token generated successfully")

    res.json({
      success: true,
      token,
      appId: APP_ID,
      channelName,
      userId,
      role,
      expiresAt: expirationTimeInSeconds,
    })
  } catch (error) {
    console.error("❌ Error generating RTC token:", error)
    res.status(500).json({
      success: false,
      message: "Failed to generate RTC token",
      error: error.message,
    })
  }
})

// ✅ Generate RTM Token for messaging
router.post("/rtm-token", authenticateToken, async (req, res) => {
  try {
    const { userId } = req.body

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      })
    }

    console.log(`🎫 Generating RTM token for user: ${userId}`)

    // Check if APP_CERTIFICATE is set
    if (!APP_CERTIFICATE || APP_CERTIFICATE === "03361c614ed8420a830cbb95f8e06d0b") {
      console.warn("⚠️ APP_CERTIFICATE not set, returning null token")
      return res.json({
        success: true,
        token: null,
        message: "No certificate configured - using null token for development",
        appId: APP_ID,
        userId,
      })
    }

    // Set token expiration time (24 hours from now)
    const expirationTimeInSeconds = Math.floor(Date.now() / 1000) + 24 * 3600

    // Generate RTM token
    const token = RtmTokenBuilder.buildToken(APP_ID, APP_CERTIFICATE, userId.toString(), expirationTimeInSeconds)

    console.log("✅ RTM token generated successfully")

    res.json({
      success: true,
      token,
      appId: APP_ID,
      userId,
      expiresAt: expirationTimeInSeconds,
    })
  } catch (error) {
    console.error("❌ Error generating RTM token:", error)
    res.status(500).json({
      success: false,
      message: "Failed to generate RTM token",
      error: error.message,
    })
  }
})

// ✅ Get token information
router.post("/token-info", authenticateToken, async (req, res) => {
  try {
    const { token } = req.body

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Token is required",
      })
    }

    // For now, just return basic info
    // In production, you might want to decode and validate the token
    res.json({
      success: true,
      appId: APP_ID,
      isValid: true,
      message: "Token info retrieved",
    })
  } catch (error) {
    console.error("❌ Error getting token info:", error)
    res.status(500).json({
      success: false,
      message: "Failed to get token info",
      error: error.message,
    })
  }
})

// ✅ Test endpoint
router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "Agora routes working",
    appId: APP_ID,
    hasCertificate: !!(APP_CERTIFICATE && APP_CERTIFICATE !== "03361c614ed8420a830cbb95f8e06d0b"),
  })
})

export default router
