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
import streamChatRoutes from "./Routes/StreamChatRoutes.js" // Added import
import { initializeDatabase } from "./config/database.js"
import { createServer } from "http"
import { Server } from "socket.io"
import { registerSocketHandlers } from "./socketHandlers.js"
import ablyRoutes from "./Routes/AblyRoutes.js"
import locationRoutes from "./Routes/LocationRoutes.js" // ✅ NEW: Import location routes
import reviewRoutes from "./Routes/ReviewRoutes.js"

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

await initializeDatabase()

// Validate environment variables
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.error("❌ Missing Google OAuth credentials in .env file")
  process.exit(1)
}

console.log("✅ Google Client ID:", process.env.GOOGLE_CLIENT_ID?.substring(0, 20) + "...")

// ✅ PRESERVED: Your original CORS configuration with network IP support
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true)

    // Allow localhost and your network IP
    const allowedOrigins = [
      "http://localhost:5173",
      "http://localhost:3000",
      "http://127.0.0.1:5173",
      // Add your network IP here - replace with your actual IP
      "http://192.168.1.100:5173", // Example - replace with your IP
      "http://192.168.0.100:5173", // Another common range
      "http://10.0.0.100:5173", // Another common range
    ]

    // Check if origin matches any allowed pattern or is a local network IP
    const isLocalNetwork =
      /^http:\/\/192\.168\.\d+\.\d+:5173$/.test(origin) ||
      /^http:\/\/10\.\d+\.\d+\.\d+:5173$/.test(origin) ||
      /^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+:5173$/.test(origin)

    if (allowedOrigins.includes(origin) || isLocalNetwork) {
      callback(null, true)
    } else {
      console.log("CORS blocked origin:", origin)
      callback(new Error("Not allowed by CORS"))
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  optionsSuccessStatus: 200,
}

// Middleware
app.use(cors(corsOptions))
app.use(express.json({ limit: "10mb" })) // Increased limit for larger payloads
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

// ✅ PRESERVED: Socket.IO setup with call support (keeping your original config)
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin
      if (!origin) return callback(null, true)

      const allowedOrigins = ["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"]

      // Check if origin matches any allowed pattern or is a local network IP
      const isLocalNetwork =
        /^http:\/\/192\.168\.\d+\.\d+:5173$/.test(origin) ||
        /^http:\/\/10\.\d+\.\d+\.\d+:5173$/.test(origin) ||
        /^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+:5173$/.test(origin)

      if (allowedOrigins.includes(origin) || isLocalNetwork) {
        callback(null, true)
      } else {
        callback(null, true) // Allow all for development - restrict in production
      }
    },
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

  // ✅ PRESERVED: Register existing socket handlers (includes enhanced call features)
  registerSocketHandlers(io, socket)
})

// Debug middleware to log all requests
app.use((req, res, next) => {
  const timestamp = new Date().toISOString()
  console.log(`📝 ${req.method} ${req.path} - ${timestamp}`)
  if (req.body && Object.keys(req.body).length > 0) {
    console.log("📦 Request body:", JSON.stringify(req.body, null, 2))
  }
  next()
})

// ✅ PRESERVED: Your original routes + NEW Agora routes + NEW StreamChat routes
app.use("/api/auth", authRoutes)
app.use("/api/trips", tripRoutes)
app.use("/api/chat", chatRoutes)
app.use("/api/chat", streamChatRoutes) // Added StreamChat routes
app.use("/api/social", socialRoutes)
app.use("/api/agora", agoraRoutes)
app.use("/auth", simpleGoogleAuth)
app.use("/api/ably", ablyRoutes)
app.use("/location", locationRoutes) // ✅ NEW: Add location routes
app.use("/api/reviews", reviewRoutes) // ✅ NEW: Add review routes

// ✅ PRESERVED: Your original basic routes
app.get("/", (req, res) => {
  res.json({
    message: "Smart Journey API is running!",
    socketIO: {
      status: "active",
      connectedClients,
      endpoint: `http://localhost:${PORT}`,
    },
    googleOAuth: "http://localhost:3000/auth/google",
    redirectUri: "http://localhost:3000/auth/google/ProjectforGoogleOauth",
    status: "healthy",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    availableRoutes: {
      auth: "/api/auth/*",
      trips: "/api/trips/*",
      chat: "/api/chat/*",
      streamChat: "/api/chat/stream-token, /api/chat/channels/*",
      social: "/api/social/*",
      agora: "/api/agora/*",
      ably: "/api/ably/*",
      googleAuth: "/auth/google",
      reviews: "/api/reviews/*",
    },
    features: {
      "social-travel": "enabled",
      "real-time-chat": "enabled",
      "stream-chat": "enabled",
      "voice-video-calls": "enabled",
      "agora-communication": "enabled",
      "location-based": "enabled",
      "smart-matching": "enabled",
      "enhanced-location": "enabled", // ✅ NEW: Added enhanced location feature
      "review-system": "enabled",
    },
  })
})

app.get("/health", (req, res) => {
  res.json({
    status: "Server is running",
    timestamp: new Date().toISOString(),
    database: "connected",
    socketIO: {
      status: "active",
      connectedClients,
    },
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    features: {
      "enhanced-social": "active",
      "call-system": "ready",
      "agora-rtm": "ready",
      "agora-rtc": "ready",
      "location-services": "enabled",
      "enhanced-location": "enabled", // ✅ NEW: Added enhanced location feature
    },
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

// ✅ PRESERVED: Your original 404 handler with added Agora endpoints
app.use((req, res) => {
  const timestamp = new Date().toISOString()
  console.log(`❌ 404 - Route not found: ${req.method} ${req.path} at ${timestamp}`)
  res.status(404).json({
    message: "Route not found",
    requestedPath: req.path,
    method: req.method,
    timestamp,
    availableRoutes: [
      "GET /",
      "GET /health",
      "POST /api/trips",
      "GET /api/trips",
      "GET /api/trips/:id",
      "POST /api/auth/login",
      "POST /api/auth/register",
      "GET /auth/google",
      "POST /api/chat/connect",
      "GET /api/chat/rooms/:roomId/messages",
      "POST /api/chat/rooms/:roomId/messages",
      "POST /api/chat/call/initiate",
      "POST /api/chat/call/accept",
      "POST /api/chat/call/reject",
      "POST /api/agora/rtm-token",
      "POST /api/agora/rtc-token",
      "GET /api/social/discover",
      "GET /api/social/matches",
      "GET /api/social/chats",
      "GET /api/social/nearby",
      "GET /api/social/nearby-distance",
      "POST /api/social/location",
      "GET /api/social/user-location/:targetUserId", // ✅ NEW: Added enhanced location endpoint
    ],
  })
})

// ✅ PRESERVED: Your original server startup message with enhanced Agora features
server.listen(PORT, "0.0.0.0", () => {
  console.log(`
🚀 Enhanced Smart Journey Server Started Successfully!`)
  console.log(`📅 Timestamp: ${new Date().toISOString()}`)
  console.log(`🌐 Environment: ${process.env.NODE_ENV || "development"}`)
  console.log(`📡 Server running on port ${PORT}`)
  console.log(`📊 Health check: http://localhost:${PORT}/health`)
  console.log(`🔐 Google OAuth: http://localhost:${PORT}/auth/google`)
  console.log(`🔄 Callback URI: http://localhost:${PORT}/auth/google/callback`)
  console.log(`💾 Trip endpoints: http://localhost:${PORT}/api/trips`)
  console.log(`💬 Chat endpoints: http://localhost:${PORT}/api/chat`)
  console.log(`🌐 Social endpoints: http://localhost:${PORT}/api/social`)
  console.log(`📞 Agora endpoints: http://localhost:${PORT}/api/agora`)
  console.log(`📞 Call system: Ready for voice/video calls`)
  console.log(`🎧 Agora RTM: Real-time messaging enabled`)
  console.log(`🎥 Agora RTC: Audio/Video calls enabled`)
  console.log(`📍 Location services: Enabled`)
  console.log(`🗺️ Enhanced location: Address conversion enabled`) // ✅ NEW: Added enhanced location log
  console.log(`🔌 Socket.IO server running on port ${PORT}`)
  console.log(`👥 Connected clients: ${connectedClients}`)
  console.log(`
📝 Add this to Google Cloud Console:`)
  console.log(`   Authorized redirect URI: http://localhost:${PORT}/auth/google/callback`)
  console.log(`
✅ Enhanced Social Travel Server ready to accept connections!`)
  console.log(
    `🎯 Features: Social Travel • Real-time Chat • Voice/Video Calls • Agora Communication • Enhanced Location Services`,
  )

  // ✅ PRESERVED: Network access instructions
  console.log(`
🌐 For network access from other devices:`)
  console.log(`   1. Find your IP: ipconfig (Windows) or ifconfig (Mac/Linux)`)
  console.log(`   2. Access from other devices: http://YOUR_IP:${PORT}`)
  console.log(`   3. Update CORS origins in server if needed`)
})
