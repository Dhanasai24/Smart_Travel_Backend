import express from "express"
import passport from "passport"
import jwt from "jsonwebtoken"

const router = express.Router()

// ✅ UPDATED: Use environment variables for URLs
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173"

console.log("🔗 Passport OAuth Frontend URL:", FRONTEND_URL)

// Google OAuth initiation - simple string path
router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  }),
)

// Google OAuth callback - simple string path
router.get("/google/ProjectforGoogleOauth", (req, res, next) => {
  passport.authenticate("google", (err, user, info) => {
    if (err) {
      console.error("Authentication error:", err)
      // ✅ FIXED: Redirect to frontend login page
      return res.redirect(`${FRONTEND_URL}/login?error=auth_failed`)
    }

    if (!user) {
      console.error("No user found:", info)
      // ✅ FIXED: Redirect to frontend login page
      return res.redirect(`${FRONTEND_URL}/login?error=auth_failed`)
    }

    req.logIn(user, (err) => {
      if (err) {
        console.error("Login error:", err)
        // ✅ FIXED: Redirect to frontend login page
        return res.redirect(`${FRONTEND_URL}/login?error=auth_failed`)
      }

      // Generate JWT token
      const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET || "your-secret-key", {
        expiresIn: "24h",
      })

      // ✅ FIXED: Redirect to frontend trips page instead of auth-success
      const redirectUrl = `${FRONTEND_URL}/my-trips?token=${token}&auth=success`
      console.log("🔄 Redirecting to:", redirectUrl)

      return res.redirect(redirectUrl)
    })
  })(req, res, next)
})

export default router
