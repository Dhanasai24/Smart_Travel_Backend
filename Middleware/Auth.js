import jwt from "jsonwebtoken"

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"]
  const token = authHeader && authHeader.split(" ")[1] // Bearer TOKEN

  console.log("🔐 Auth middleware - Token present:", !!token)

  if (!token) {
    console.log("❌ No token provided")
    return res.status(401).json({
      message: "Access token required",
      error: "MISSING_TOKEN",
    })
  }

  jwt.verify(token, process.env.JWT_SECRET || "fallback-secret", (err, user) => {
    if (err) {
      console.log("❌ Token verification failed:", err.message)
      return res.status(403).json({
        message: "Invalid or expired token",
        error: "INVALID_TOKEN",
      })
    }

    console.log("✅ Token verified for user:", user.userId)
    req.user = user
    next()
  })
}

export const generateToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
    },
    process.env.JWT_SECRET || "fallback-secret",
    { expiresIn: "24h" },
  )
}
