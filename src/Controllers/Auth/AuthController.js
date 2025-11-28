import {
  authenticateUser,
  registerUser,
} from "../../Services/crud/AuthService.js";
import {
  sendVerificationEmail,
  generateAndSendVerificationCode,
  verifyEmailCode,
} from "../../Services/crud/VerificationService.js";

// User login
export const login = async (req, res) => {
  try {
    // Authenticate user (validation already done in middleware)
    const { user, token } = await authenticateUser(req.validatedData);

    // Calculate cookie expiration
    const expirationTime = 12 * 60 * 60 * 1000; // 12 hours

    // Set cookie and return response
    res
      .cookie("authorization", `Bearer ${token}`, {
        httpOnly: true,
        expires: new Date(Date.now() + expirationTime),
        secure: process.env.NODE_ENV !== "development",
        sameSite: "strict",
        maxAge: expirationTime,
      })
      .status(200)
      .json({
        status: 200,
        success: true,
        message: "Logged in successfully",
        data: {
          token: token,
          user: user,
        },
      });
  } catch (error) {
    // Handle specific errors
    if (error.message === "invalid_credentials") {
      return res.status(401).json({
        status: 401,
        success: false,
        message: "Invalid email or password",
        data: null,
      });
    }

    if (error.message.startsWith("account_locked")) {
      const minutes = error.message.split(":")[1];
      return res.status(401).json({
        status: 401,
        success: false,
        message: `Account locked due to too many failed login attempts. Please try again in ${minutes} minutes.`,
        data: null,
      });
    }

    // Log errors for debugging
    console.error("Login error:", error);

    // Generic error response
    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred during login",
      data: null,
    });
  }
};

// User registration
export const register = async (req, res) => {
  try {
    const { user, token } = await registerUser(req.validatedData);

    // Send verification email
    await sendVerificationEmail(user.email, user.fullName);

    res.status(201).json({
      status: 201,
      success: true,
      message:
        "User registered successfully. Please check your email for verification.",
      data: {
        user: user,
        token: token,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);

    if (error.message === "user_exists") {
      return res.status(409).json({
        status: 409,
        success: false,
        message: "User already exists with this email",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred during registration",
      data: null,
    });
  }
};

// Send verification email (for resending verification code)
export const sendVerificationCode = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Email is required",
        data: null,
      });
    }

    await generateAndSendVerificationCode(email);

    res.status(200).json({
      status: 200,
      success: true,
      message: "Verification code sent successfully",
      data: null,
    });
  } catch (error) {
    console.error("Send verification error:", error);

    if (error.message === "user_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "User not found",
        data: null,
      });
    }

    if (error.message === "already_verified") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Email is already verified",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while sending verification code",
      data: null,
    });
  }
};

// Verify verification code
export const verifyVerificationCode = async (req, res) => {
  try {
    const { email, code } = req.validatedData;

    await verifyEmailCode(email, code);

    res.status(200).json({
      status: 200,
      success: true,
      message: "Email verified successfully",
      data: null,
    });
  } catch (error) {
    console.error("Verification error:", error);

    if (error.message === "user_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "User not found",
        data: null,
      });
    }

    if (error.message === "already_verified") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Email is already verified",
        data: null,
      });
    }

    if (error.message === "code_not_found") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "No verification code found. Please request a new one.",
        data: null,
      });
    }

    if (error.message === "code_expired") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Verification code has expired. Please request a new one.",
        data: null,
      });
    }

    if (error.message === "invalid_code") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Invalid verification code",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred during verification",
      data: null,
    });
  }
};

// User logout
export const logout = (req, res) => {
  res.clearCookie("authorization").status(200).json({
    status: 200,
    success: true,
    message: "Logged out successfully",
    data: null,
  });
};
