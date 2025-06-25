import express from "express"
import axios from "axios"
import jwt from "jsonwebtoken"
import pool from "../config/database.js"

const router = express.Router()

// Google OAuth initiation
router.get("/google", (req, res) => {
  // Use exact redirect URI that matches Google Cloud Console
  const redirectUri = "http://localhost:3000/auth/google/ProjectforGoogleOauth"

  const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  googleAuthUrl.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID)
  googleAuthUrl.searchParams.set("redirect_uri", redirectUri)
  googleAuthUrl.searchParams.set("response_type", "code")
  googleAuthUrl.searchParams.set("scope", "profile email")
  googleAuthUrl.searchParams.set("access_type", "offline")
  googleAuthUrl.searchParams.set("prompt", "consent")

  console.log("🔄 Redirecting to Google OAuth with URI:", redirectUri)
  console.log("🔗 Full Google URL:", googleAuthUrl.toString())

  res.redirect(googleAuthUrl.toString())
})

// Google OAuth callback
router.get("/google/ProjectforGoogleOauth", async (req, res) => {
  try {
    const { code, error, error_description } = req.query

    if (error) {
      console.error("❌ Google OAuth error:", error, error_description)
      return res.redirect(`http://localhost:5173/login?error=${encodeURIComponent(error)}`)
    }

    if (!code) {
      console.error("❌ No authorization code received")
      return res.redirect("http://localhost:5173/login?error=no_code")
    }

    console.log("✅ Authorization code received")

    const redirectUri = "http://localhost:3000/auth/google/ProjectforGoogleOauth"

    // Exchange code for tokens
    const tokenResponse = await axios.post("https://oauth2.googleapis.com/token", {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
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

    // Redirect to frontend with token
    res.redirect(`http://localhost:5173/auth-success?token=${token}`)
  } catch (error) {
    console.error("❌ Google OAuth callback error:", error.response?.data || error.message)
    res.redirect("http://localhost:5173/login?error=auth_failed")
  }
})

export default router
