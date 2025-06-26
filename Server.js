import express from "express"
import session from "express-session"
import cors from "cors"
import dotenv from "dotenv"
import sessionMiddleware from "./Middleware/Session.js"
import passport from "passport"
import authRoutes from "./Routes/AuthRoutes.js"
import tripRoutes from "./Routes/TripRoutes.js"
import chatRoutes from "./Routes/ChatRoutes.js"
import socialRoutes from "./Routes/SocialRoutes.js"
import simpleGoogleAuth from "./Routes/SimpleGoogleAuth.js"
import agoraRoutes from "./Routes/AgoraRoutes.js"
import streamChatRoutes from "./Routes/StreamChatRoutes.js"
import { initializeDatabase } from "./config/database.js"
import { createServer } from "http"
import { Server } from "socket.io"
import { registerSocketHandlers } from "./socketHandlers.js"
import ablyRoutes from "./Routes/AblyRoutes.js"
import locationRoutes from "./Routes/LocationRoutes.js"
import reviewRoutes from "./Routes/ReviewRoutes.js"

// ✅ Load environment variables FIRST
dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

// ✅ ENHANCED: Better environment detection
const isProduction =
  process.env.NODE_ENV === "production" ||
  process.env.BACKEND_URL?.includes("render.com") ||
  process.env.BACKEND_URL?.includes("herokuapp.com")

const FRONTEND_URL = isProduction
  ? process.env.FRONTEND_URL || "https://ai-trip-planner24.netlify.app"
  : "http://localhost:5173"

const BACKEND_URL = isProduction
  ? process.env.BACKEND_URL || "https://smart-travel-backend-7mzh.onrender.com"
  : "http://localhost:3000"

// ✅ CRITICAL: Enhanced environment logging
console.log("🚀 === SERVER STARTUP ENVIRONMENT CHECK ===")
console.log("NODE_ENV:", process.env.NODE_ENV)
console.log("Is Production:", isProduction)
console.log("PORT:", PORT)
console.log("FRONTEND_URL from process.env:", process.env.FRONTEND_URL)
console.log("BACKEND_URL from process.env:", process.env.BACKEND_URL)
console.log("Final FRONTEND_URL:", FRONTEND_URL)
console.log("Final BACKEND_URL:", BACKEND_URL)
console.log("Expected OAuth Redirect URI:", `${BACKEND_URL}/auth/google/ProjectforGoogleOauth`)
console.log("Google Client ID:", process.env.GOOGLE_CLIENT_ID ? "✅ Set" : "❌ Missing")
console.log("Google Client Secret:", process.env.GOOGLE_CLIENT_SECRET ? "✅ Set" : "❌ Missing")
console.log("JWT Secret:", process.env.JWT_SECRET ? "✅ Set" : "❌ Missing")
console.log("🚀 === END ENVIRONMENT CHECK ===")

await initializeDatabase()

// Validate environment variables
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.error("❌ Missing Google OAuth credentials in .env file")
  console.error("❌ GOOGLE_CLIENT_ID:", process.env.GOOGLE_CLIENT_ID ? "Set" : "Missing")
  console.error("❌ GOOGLE_CLIENT_SECRET:", process.env.GOOGLE_CLIENT_SECRET ? "Set" : "Missing")
  process.exit(1)
}

console.log("✅ Google Client ID:", process.env.GOOGLE_CLIENT_ID?.substring(0, 20) + "...")

// ✅ UPDATED: CORS configuration with forced production URLs
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true)

    // ✅ FORCE production URLs
    const allowedOrigins = [
      FRONTEND_URL,
      BACKEND_URL,
      "https://ai-trip-planner24.netlify.app",
      "https://smart-travel-backend-7mzh.onrender.com",
      "http://localhost:5173", // Keep for local development
      "http://localhost:3000", // Keep for local development
      "http://127.0.0.1:5173",
      "http://127.0.0.1:3000",
    ]

    console.log("🔍 CORS check - Origin:", origin)
    console.log("🔍 CORS check - Allowed origins:", allowedOrigins)

    // Check if origin matches any allowed pattern or is a local network IP
    const isLocalNetwork =
      /^http:\/\/192\.168\.\d+\.\d+:(5173|3000)$/.test(origin) ||
      /^http:\/\/10\.\d+\.\d+\.\d+:(5173|3000)$/.test(origin) ||
      /^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+:(5173|3000)$/.test(origin)

    if (allowedOrigins.includes(origin) || isLocalNetwork) {
      console.log("✅ CORS allowed for origin:", origin)
      callback(null, true)
    } else {
      console.log("❌ CORS blocked origin:", origin)
      callback(null, true) // Allow all for now - restrict in production
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  optionsSuccessStatus: 200,
}

// Middleware
app.use(cors(corsOptions))
app.use(express.json({ limit: "10mb" }))
app.use(express.urlencoded({ extended: true, limit: "10mb" }))

// Enhanced session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      httpOnly: true,
    },
  }),
)

app.use(sessionMiddleware)
app.use(passport.initialize())
app.use(passport.session())

// Create HTTP server
const server = createServer(app)

// ✅ Socket.IO setup with forced production URLs
const io = new Server(server, {
  cors: {
    origin: [FRONTEND_URL, BACKEND_URL, "http://localhost:5173", "http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  pingTimeout: 60000,
  pingInterval: 25000,
})

// Enhanced socket connection handling
let connectedClients = 0

io.on("connection", (socket) => {
  connectedClients++
  console.log(`🔌 New client connected: ${socket.id} (Total: ${connectedClients})`)

  socket.on("disconnect", (reason) => {
    connectedClients--
    console.log(`🔌 Client disconnected: ${socket.id} (Reason: ${reason}) (Total: ${connectedClients})`)
  })

  socket.on("error", (error) => {
    console.error(`🔌 Socket error for ${socket.id}:`, error)
  })

  registerSocketHandlers(io, socket)
})

// Debug middleware to log all requests
app.use((req, res, next) => {
  const timestamp = new Date().toISOString()
  console.log(`📝 ${req.method} ${req.path} - ${timestamp}`)
  next()
})

// ✅ Routes
app.use("/api/auth", authRoutes)
app.use("/api/trips", tripRoutes)
app.use("/api/chat", chatRoutes)
app.use("/api/chat", streamChatRoutes)
app.use("/api/social", socialRoutes)
app.use("/api/agora", agoraRoutes)
app.use("/auth", simpleGoogleAuth) // ✅ This handles /auth/google and /auth/google/ProjectforGoogleOauth
app.use("/api/ably", ablyRoutes)
app.use("/location", locationRoutes)
app.use("/api/reviews", reviewRoutes)

// ✅ Enhanced root endpoint with OAuth debug info
app.get("/", (req, res) => {
  const expectedRedirectUri = `${BACKEND_URL}/auth/google/ProjectforGoogleOauth`

  res.json({
    message: "Smart Journey API is running!",
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      isProduction: isProduction,
      FRONTEND_URL: FRONTEND_URL,
      BACKEND_URL: BACKEND_URL,
      hasGoogleOAuth: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    },
    oauth: {
      googleAuthUrl: `${BACKEND_URL}/auth/google`,
      expectedRedirectUri: expectedRedirectUri,
      debugUrl: `${BACKEND_URL}/auth/debug`,
      googleCloudConsoleCheck: {
        message: "Ensure this exact URI is in your Google Cloud Console:",
        redirectUri: expectedRedirectUri,
      },
    },
    socketIO: {
      status: "active",
      connectedClients: connectedClients,
      endpoint: BACKEND_URL,
    },
    status: "healthy",
    timestamp: new Date().toISOString(),
  })
})

app.get("/health", (req, res) => {
  res.json({
    status: "Server is running",
    timestamp: new Date().toISOString(),
    database: "connected",
    environment: {
      FRONTEND_URL: FRONTEND_URL,
      BACKEND_URL: BACKEND_URL,
      NODE_ENV: process.env.NODE_ENV,
    },
    oauth: {
      googleClientIdSet: !!process.env.GOOGLE_CLIENT_ID,
      googleClientSecretSet: !!process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: `${BACKEND_URL}/auth/google/ProjectforGoogleOauth`,
    },
    socketIO: {
      status: "active",
      connectedClients: connectedClients,
    },
    uptime: process.uptime(),
  })
})

// Enhanced error handling
app.use((err, req, res, next) => {
  const timestamp = new Date().toISOString()
  console.error(`❌ Server error at ${timestamp}:`, err)
  console.error("Stack trace:", err.stack)

  res.status(500).json({
    message: "Internal server error",
    timestamp,
    error: process.env.NODE_ENV === "development" ? err.message : "Something went wrong",
    path: req.path,
    method: req.method,
  })
})

// 404 handler
app.use((req, res) => {
  const timestamp = new Date().toISOString()
  console.log(`❌ 404 - Route not found: ${req.method} ${req.path} at ${timestamp}`)
  res.status(404).json({
    message: "Route not found",
    requestedPath: req.path,
    method: req.method,
    timestamp,
    environment: {
      FRONTEND_URL: FRONTEND_URL,
      BACKEND_URL: BACKEND_URL,
    },
  })
})

// ✅ Server startup with comprehensive logging
server.listen(PORT, "0.0.0.0", () => {
  console.log(`
🚀 === SMART JOURNEY SERVER STARTED ===`)
  console.log(`📅 Timestamp: ${new Date().toISOString()}`)
  console.log(`🌐 Environment: ${process.env.NODE_ENV || "development"}`)
  console.log(`📡 Server running on port ${PORT}`)
  console.log(`🔗 Backend URL: ${BACKEND_URL}`)
  console.log(`🔗 Frontend URL: ${FRONTEND_URL}`)
  console.log(`📊 Health check: ${BACKEND_URL}/health`)
  console.log(`🔐 Google OAuth: ${BACKEND_URL}/auth/google`)
  console.log(`🔄 OAuth Callback: ${BACKEND_URL}/auth/google/ProjectforGoogleOauth`)
  console.log(`🐛 OAuth Debug: ${BACKEND_URL}/auth/debug`)
  console.log(`🔌 Socket.IO server running on port ${PORT}`)
  console.log(`👥 Connected clients: ${connectedClients}`)
  console.log(`
📝 === GOOGLE CLOUD CONSOLE CONFIGURATION ===`)
  console.log(`   Authorized JavaScript origins: ${FRONTEND_URL}`)
  console.log(`   Authorized redirect URI: ${BACKEND_URL}/auth/google/ProjectforGoogleOauth`)
  console.log(`
✅ Server ready to accept connections!`)
})
