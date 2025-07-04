import jwt from "jsonwebtoken"

export const googleAuth = (req, res, next) => {
  // This will be handled by passport middleware
  next()
}

export const googleCallback = async (req, res) => {
  try {
    // Generate JWT for Google user
    const token = jwt.sign(
      { userId: req.user.id, email: req.user.email },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    )

    // Redirect to frontend with token
    res.redirect(`${process.env.FRONTEND_URL}/auth-success?token=${token}`)
  } catch (error) {
    console.error("Google callback error:", error)
    res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`)
  }
}
