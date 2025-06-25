import session from "express-session"
import connectPgSimple from "connect-pg-simple"
import pool from "../config/database.js"

const PgSession = connectPgSimple(session)

// Create the session table if it doesn't exist
const createSessionTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
      )
    `)
    console.log("✅ Session table created or verified")

    // Create index for faster lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")
    `)
  } catch (error) {
    console.error("❌ Error creating session table:", error)
  }
}

// Initialize the session table
createSessionTable()

// Configure the session middleware with PostgreSQL store
const sessionConfig = {
  store: new PgSession({
    pool,
    tableName: "session", // Use the session table we created
    createTableIfMissing: true, // Create table if it doesn't exist
  }),
  name: "smart_journey_sid", // Custom cookie name for better security
  secret: process.env.SESSION_SECRET || "fallback-session-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production", // Only use secure cookies in production
    httpOnly: true, // Prevent JavaScript access to the cookie
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: "lax", // Protection against CSRF
  },
}

export default session(sessionConfig)
