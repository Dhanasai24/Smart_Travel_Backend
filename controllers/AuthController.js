import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import pool from "../config/database.js"

export const register = async (req, res) => {
  try {
    const { email, password, name } = req.body

    // Validate input
    if (!email || !password || !name) {
      return res.status(400).json({
        message: "Email, password, and name are required",
      })
    }

    // Check if user exists
    const existingUser = await pool.query("SELECT * FROM users WHERE email = $1", [email])

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: "User already exists" })
    }

    // Hash password
    const saltRounds = 10
    const hashedPassword = await bcrypt.hash(password, saltRounds)

    // Create user with all required fields
    const newUser = await pool.query(
      `INSERT INTO users (email, password, name, provider) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, email, name, avatar_url, provider, created_at`,
      [email, hashedPassword, name, "local"],
    )

    // Generate JWT
    const token = jwt.sign(
      {
        userId: newUser.rows[0].id,
        email: newUser.rows[0].email,
        name: newUser.rows[0].name,
      },
      process.env.JWT_SECRET || "fallback-secret-key",
      { expiresIn: "24h" },
    )

    console.log("✅ User registered successfully:", newUser.rows[0].email)

    res.status(201).json({
      message: "User created successfully",
      token,
      user: newUser.rows[0],
    })
  } catch (error) {
    console.error("Registration error:", error)
    res.status(500).json({
      message: "Server error during registration",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

export const login = async (req, res) => {
  try {
    const { email, password } = req.body

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      })
    }

    // Find user with provider check
    const user = await pool.query("SELECT * FROM users WHERE email = $1 AND provider = $2", [email, "local"])

    if (user.rows.length === 0) {
      return res.status(400).json({ message: "Invalid credentials" })
    }

    // Check if user has a password (local account)
    if (!user.rows[0].password) {
      return res.status(400).json({
        message: "This account was created with Google. Please use Google Sign-In.",
      })
    }

    // Check password
    const validPassword = await bcrypt.compare(password, user.rows[0].password)
    if (!validPassword) {
      return res.status(400).json({ message: "Invalid credentials" })
    }

    // Generate JWT
    const token = jwt.sign(
      {
        userId: user.rows[0].id,
        email: user.rows[0].email,
        name: user.rows[0].name,
      },
      process.env.JWT_SECRET || "fallback-secret-key",
      { expiresIn: "24h" },
    )

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user.rows[0]

    console.log("✅ User logged in successfully:", user.rows[0].email)

    res.json({
      message: "Login successful",
      token,
      user: userWithoutPassword,
    })
  } catch (error) {
    console.error("Login error:", error)
    res.status(500).json({
      message: "Server error during login",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
}

export const getProfile = async (req, res) => {
  try {
    const user = await pool.query("SELECT id, email, name, avatar_url, provider, created_at FROM users WHERE id = $1", [
      req.user.userId,
    ])

    if (user.rows.length === 0) {
      return res.status(404).json({ message: "User not found" })
    }

    res.json({ user: user.rows[0] })
  } catch (error) {
    console.error("Profile error:", error)
    res.status(500).json({ message: "Server error" })
  }
}

export const logout = (req, res) => {
  res.json({ message: "Logged out successfully" })
}
