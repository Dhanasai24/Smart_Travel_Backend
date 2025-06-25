import express from "express"
import { authenticateToken } from "../Middleware/Auth.js"
import { register, login, getProfile, logout } from "../controllers/AuthController.js"

const router = express.Router()

// Local authentication routes
router.post("/register", register)
router.post("/login", login)
router.get("/profile", authenticateToken, getProfile)
router.post("/logout", logout)

export default router
