import express from "express";
import { sendContactMessage } from "../Controllers/ContactController.js";
import { addSecurityHeaders } from "../middlewares/securityHeadersMiddleware.js";

const router = express.Router();

// Apply security headers to all routes
router.use(addSecurityHeaders);

// Send contact form message (public route - no auth required)
router.post("/", sendContactMessage);

export default router;
