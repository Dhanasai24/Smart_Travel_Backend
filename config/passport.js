import passport from "passport"
import { Strategy as GoogleStrategy } from "passport-google-oauth20"
import { Strategy as LocalStrategy } from "passport-local"
import bcrypt from "bcryptjs"
import pool from "./database"

// Google Strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3000/auth/google/ProjectforGoogleOauth",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        console.log("Google Profile:", profile)

        // Check if user exists
        const existingUser = await pool.query("SELECT * FROM users WHERE email = $1", [profile.emails[0].value])

        if (existingUser.rows.length > 0) {
          return done(null, existingUser.rows[0])
        }

        // Create new user
        const newUser = await pool.query(
          "INSERT INTO users (email, name, google_id, avatar_url, provider) VALUES ($1, $2, $3, $4, $5) RETURNING *",
          [profile.emails[0].value, profile.displayName, profile.id, profile.photos[0]?.value, "google"],
        )

        return done(null, newUser.rows[0])
      } catch (error) {
        console.error("Google OAuth error:", error)
        return done(error, null)
      }
    },
  ),
)

// Local Strategy
passport.use(
  new LocalStrategy(
    {
      usernameField: "email",
    },
    async (email, password, done) => {
      try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email])

        if (result.rows.length === 0) {
          return done(null, false, { message: "User not found" })
        }

        const user = result.rows[0]

        // Check if user registered with Google
        if (user.provider === "google" && !user.password) {
          return done(null, false, { message: "Please sign in with Google" })
        }

        const isValidPassword = await bcrypt.compare(password, user.password)

        if (!isValidPassword) {
          return done(null, false, { message: "Invalid password" })
        }

        return done(null, user)
      } catch (error) {
        return done(error)
      }
    },
  ),
)

// Serialize/Deserialize
passport.serializeUser((user, done) => {
  done(null, user.id)
})

passport.deserializeUser(async (id, done) => {
  try {
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [id])
    if (result.rows.length === 0) {
      return done(null, false)
    }
    done(null, result.rows[0])
  } catch (error) {
    done(error, null)
  }
})

export default passport
