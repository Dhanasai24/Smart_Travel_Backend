import cors from "cors"

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true)

    // Get URLs from environment variables with fallbacks
    const frontendUrl = process.env.FRONTEND_URL || process.env.DEV_FRONTEND_URL || "http://localhost:5173"
    const backendUrl = process.env.BACKEND_URL || process.env.DEV_BACKEND_URL || "http://localhost:3000"

    // Production and development URLs
    const allowedOrigins = [
      // Production URLs from environment
      "https://ai-trip-planner24.netlify.app",
      "https://smart-travel-backend-7mzh.onrender.com",
      frontendUrl,
      backendUrl,
      // Development URLs
      "http://localhost:5173",
      "http://localhost:3000",
      "http://127.0.0.1:5173",
      // Network IPs for local development
      "http://192.168.1.100:5173",
      "http://192.168.0.100:5173",
      "http://10.0.0.100:5173",
    ]

    // Check if origin matches any allowed pattern or is a local network IP
    const isLocalNetwork =
      /^http:\/\/192\.168\.\d+\.\d+:5173$/.test(origin) ||
      /^http:\/\/10\.\d+\.\d+\.\d+:5173$/.test(origin) ||
      /^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+:5173$/.test(origin)

    if (allowedOrigins.includes(origin) || isLocalNetwork) {
      console.log("✅ CORS allowed for origin:", origin)
      callback(null, true)
    } else {
      console.log("❌ CORS blocked origin:", origin)
      console.log("🔍 Allowed origins:", allowedOrigins)
      callback(null, true) // Allow all for now to debug - change to callback(new Error("Not allowed by CORS")) in production
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "Access-Control-Request-Method",
    "Access-Control-Request-Headers",
  ],
  exposedHeaders: ["Set-Cookie"],
  optionsSuccessStatus: 200,
  preflightContinue: false,
}

export default cors(corsOptions)
