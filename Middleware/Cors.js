import cors from "cors"

const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
       "https://ai-trip-planner24.netlify.app",
      "http://localhost:5173",
     
    ]

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      console.log("❌ CORS blocked origin:", origin)
      callback(new Error("Not allowed by CORS"))
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
}

export default cors(corsOptions)
