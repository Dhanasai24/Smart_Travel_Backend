import express from "express"
import passport from "passport"
import jwt from "jsonwebtoken"

const router = express.Router()

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
      return res.redirect("http://localhost:5173/login?error=auth_failed")
    }

    if (!user) {
      console.error("No user found:", info)
      return res.redirect("http://localhost:5173/login?error=auth_failed")
    }

    req.logIn(user, (err) => {
      if (err) {
        console.error("Login error:", err)
        return res.redirect("http://localhost:5173/login?error=auth_failed")
      }

      // Generate JWT token
      const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET || "your-secret-key", {
        expiresIn: "24h",
      })

      // Redirect to frontend with token
      return res.redirect(`http://localhost:5173/auth-success?token=${token}`)
    })
  })(req, res, next)
})

export default router
