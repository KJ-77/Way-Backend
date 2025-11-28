// backend/src/middlewares/loginLimiter.js
import rateLimit from "express-rate-limit";

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per IP
  message: {
    status: 429,
    success: false,
    message: "Too many login attempts, please try again later",
    data: null,
  },
  standardHeaders: true,
  legacyHeaders: false,
});
