// backend/src/middlewares/verificationLimiter.js
import rateLimit from "express-rate-limit";

export const verificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 attempts per IP per hour
  message: {
    status: 429,
    success: false,
    message: "Too many verification attempts, please try again later",
    data: null,
  },
  standardHeaders: true,
  legacyHeaders: false,
});
