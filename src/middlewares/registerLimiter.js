// Using express-rate-limit
import rateLimit from "express-rate-limit";

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 attempts per IP
  message: {
    status: 429,
    success: false,
    message: "Too many registration attempts, please try again later",
  },
});
