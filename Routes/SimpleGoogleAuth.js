import express from "express"
import axios from "axios"
import jwt from "jsonwebtoken"
import pool from "../config/database.js"

const router = express.Router()

// ✅ ENHANCED: More robust environment detection
const getRedirectUri = () => {
  // Check if we're in production by looking at the host header or environment
  const isProduction =
    process.env.NODE_ENV === "production" ||
    process.env.BACKEND_URL?.includes("render.com") ||
    process.env.BACKEND_URL?.includes("herokuapp.com")

  if (isProduction) {
    const backendUrl = process.env.BACKEND_URL || "https://smart-travel-backend-7mzh.onrender.com"
    return `${backendUrl}/auth/google/ProjectforGoogleOauth`
  } else {
    return "http://localhost:3000/auth/google/ProjectforGoogleOauth"
  }
}

const getFrontendUrl = () => {
  const isProduction = process.env.NODE_ENV === "production" || process.env.FRONTEND_URL?.includes("netlify.app")

  if (isProduction) {
    return process.env.FRONTEND_URL || "https://ai-trip-planner24.netlify.app"
  } else {
    return "http://localhost:5173"
  }
}

// ✅ ENHANCED: Debug endpoint to check exact URLs being used
router.get("/debug", (req, res) => {
  const redirectUri = getRedirectUri()
  const frontendUrl = getFrontendUrl()

  res.json({
    message: "Google OAuth Debug Info",
    environment: process.env.NODE_ENV || "development",
    isProduction: process.env.NODE_ENV === "production",
    redirectUri: redirectUri,
    frontendUrl: frontendUrl,
    backendUrl: process.env.BACKEND_URL,
    frontendUrlEnv: process.env.FRONTEND_URL,
    hasGoogleClientId: !!process.env.GOOGLE_CLIENT_ID,
    hasGoogleClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
    googleClientIdPreview: process.env.GOOGLE_CLIENT_ID
      ? process.env.GOOGLE_CLIENT_ID.substring(0, 20) + "..."
      : "Not set",
    requestHeaders: {
      host: req.get("host"),
      origin: req.get("origin"),
      referer: req.get("referer"),
    },
    timestamp: new Date().toISOString(),
  })
})

// Google OAuth initiation with enhanced logging
router.get("/google", (req, res) => {
  const redirectUri = getRedirectUri()

  console.log("🔍 === GOOGLE OAUTH INITIATION DEBUG ===")
  console.log("Environment:", process.env.NODE_ENV)
  console.log("Backend URL (env):", process.env.BACKEND_URL)
  console.log("Frontend URL (env):", process.env.FRONTEND_URL)
  console.log("Calculated Redirect URI:", redirectUri)
  console.log("Request Host:", req.get("host"))
  console.log("Request Origin:", req.get("origin"))
  console.log("Google Client ID:", process.env.GOOGLE_CLIENT_ID?.substring(0, 20) + "...")

  const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  googleAuthUrl.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID)
  googleAuthUrl.searchParams.set("redirect_uri", redirectUri)
  googleAuthUrl.searchParams.set("response_type", "code")
  googleAuthUrl.searchParams.set("scope", "profile email")
  googleAuthUrl.searchParams.set("access_type", "offline")
  googleAuthUrl.searchParams.set("prompt", "consent")

  console.log("🔗 Full Google OAuth URL:", googleAuthUrl.toString())
  console.log("🔍 === END DEBUG ===")

  res.redirect(googleAuthUrl.toString())
})

// Google OAuth callback with enhanced error handling
router.get("/google/ProjectforGoogleOauth", async (req, res) => {
  try {
    const { code, error, error_description } = req.query
    const frontendUrl = getFrontendUrl()
    const redirectUri = getRedirectUri()

    console.log("🔍 === GOOGLE OAUTH CALLBACK DEBUG ===")
    console.log("Callback URL used:", redirectUri)
    console.log("Request query params:", req.query)
    console.log("Request host:", req.get("host"))
    console.log("Request URL:", req.url)

    if (error) {
      console.error("❌ Google OAuth error:", error, error_description)
      return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(error)}`)
    }

    if (!code) {
      console.error("❌ No authorization code received")
      return res.redirect(`${frontendUrl}/login?error=no_code`)
    }

    console.log("✅ Authorization code received")

    // Exchange code for tokens with exact same redirect URI
    const tokenResponse = await axios.post("https://oauth2.googleapis.com/token", {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri, // ✅ Use exact same URI
    })

    const { access_token } = tokenResponse.data
    console.log("✅ Access token received")

    // Get user info from Google
    const userResponse = await axios.get(`https://www.googleapis.com/oauth2/v2/userinfo?access_token=${access_token}`)
    const userInfo = userResponse.data

    console.log("✅ User info received:", {
      email: userInfo.email,
      name: userInfo.name,
      id: userInfo.id,
    })

    // Check if user exists in database
    let user
    const existingUser = await pool.query("SELECT * FROM users WHERE email = $1", [userInfo.email])

    if (existingUser.rows.length > 0) {
      user = existingUser.rows[0]
      console.log("✅ Existing user found:", user.email)

      // Update Google ID if not set
      if (!user.google_id && userInfo.id) {
        await pool.query("UPDATE users SET google_id = $1, avatar_url = $2 WHERE id = $3", [
          userInfo.id,
          userInfo.picture,
          user.id,
        ])
        user.google_id = userInfo.id
        user.avatar_url = userInfo.picture
      }
    } else {
      // Create new user with all required fields
      const newUser = await pool.query(
        `INSERT INTO users (email, name, google_id, avatar_url, provider) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING *`,
        [userInfo.email, userInfo.name, userInfo.id, userInfo.picture, "google"],
      )
      user = newUser.rows[0]
      console.log("✅ New Google user created:", user.email)
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        name: user.name,
      },
      process.env.JWT_SECRET || "fallback-secret-key",
      {
        expiresIn: "24h",
      },
    )

    console.log("✅ JWT token generated for user:", user.email)

    // Redirect to auth-success page with token and user info
    const redirectUrl = new URL(`${frontendUrl}/auth-success`)
    redirectUrl.searchParams.set("token", token)
    redirectUrl.searchParams.set(
      "user",
      JSON.stringify({
        id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: user.avatar_url,
      }),
    )
    redirectUrl.searchParams.set("auth", "success")

    console.log("🔄 Redirecting to frontend:", redirectUrl.toString())
    console.log("🔍 === END CALLBACK DEBUG ===")

    res.redirect(redirectUrl.toString())
  } catch (error) {
    console.error("❌ Google OAuth callback error:", error.response?.data || error.message)
    res.redirect(`${getFrontendUrl()}/login?error=auth_failed`)
  }
})

export default router
