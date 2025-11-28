import express from "express";
import {
  login,
  register,
  logout,
  sendVerificationCode,
  verifyVerificationCode,
} from "../Controllers/Auth/AuthController.js";
import { tutorLogin } from "../Controllers/auth.controller.js";
import { validateSignup } from "../middlewares/validateSignup.js";
import { validateLogin } from "../middlewares/validateLogin.js";
import { validateVerificationCode } from "../middlewares/validateVerificationCode.js";
import { addSecurityHeaders } from "../middlewares/securityHeadersMiddleware.js";

const router = express.Router();

router.use(addSecurityHeaders);

// User authentication routes
router.post("/register", validateSignup, register);
router.post("/login", validateLogin, login);
router.post("/logout", logout);

// Tutor authentication routes
router.post("/tutor/login", tutorLogin);

// Email verification routes
router.post("/send-verification", sendVerificationCode);
router.post("/verify-email", validateVerificationCode, verifyVerificationCode);

export default router;
