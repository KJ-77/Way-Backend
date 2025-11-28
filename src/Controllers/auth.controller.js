import jwt from "jsonwebtoken";
import Admin from "../Modules/Admin.model.js";
import Tutor from "../Modules/Tutor.model.js";

// Secret key for JWT - should be in .env in production
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const JWT_EXPIRES_IN = "1d";

// Generate JWT token
const generateToken = (id, role) => {
  return jwt.sign({ id, role }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
};

// Admin login
export const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        status: "fail",
        message: "Please provide email and password",
      });
    }

    // Check if admin exists and password is correct
    const admin = await Admin.findOne({ email }).select("+password");

    if (!admin || !(await admin.comparePassword(password))) {
      return res.status(401).json({
        status: "fail",
        message: "Incorrect email or password",
      });
    }

    // Check if account is locked
    if (admin.accountLocked && admin.accountLockedUntil > Date.now()) {
      return res.status(401).json({
        status: "fail",
        message: "Account locked. Please try again later.",
      });
    }

    // Reset failed login attempts
    admin.failedLoginAttempts = 0;
    admin.lastLogin = Date.now();
    await admin.save({ validateBeforeSave: false });

    // Generate token
    const token = generateToken(admin._id, "admin");

    res.status(200).json({
      status: "success",
      token,
      data: {
        id: admin._id,
        fullName: admin.fullName,
        email: admin.email,
        role: admin.role,
        permissions: admin.permissions,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "An error occurred during login",
    });
  }
};

// Tutor login
export const tutorLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        status: "fail",
        message: "Please provide email and password",
      });
    }

    // Check if tutor exists and password is correct
    const tutor = await Tutor.findOne({ email }).select("+password");

    if (!tutor || !(await tutor.comparePassword(password))) {
      return res.status(401).json({
        status: "fail",
        message: "Incorrect email or password",
      });
    }

    // Generate token
    const token = generateToken(tutor._id, "tutor");

    res.status(200).json({
      status: "success",
      token,
      data: {
        id: tutor._id,
        name: tutor.name,
        email: tutor.email,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "An error occurred during login",
    });
  }
};

// Authentication middleware
export const protect = async (req, res, next) => {
  try {
    let token;

    // Check if token exists in header
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({
        status: "fail",
        message: "You are not logged in. Please log in to get access.",
      });
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if user still exists
    let currentUser;

    // Handle different token structures
    if (decoded.role === "admin") {
      currentUser = await Admin.findById(decoded.id);
      if (currentUser) req.role = "admin";
    } else if (decoded.role === "tutor") {
      currentUser = await Tutor.findById(decoded.id);
      if (currentUser) req.role = "tutor";
    } else if (decoded.userId) {
      // This is a regular user token
      const User = (await import("../Modules/User.model.js")).default;
      currentUser = await User.findById(decoded.userId);
      if (currentUser) req.role = "user";
    }

    if (!currentUser) {
      return res.status(401).json({
        status: "fail",
        message: "The user belonging to this token no longer exists.",
      });
    }

    // Grant access to protected route
    req.user = currentUser;
    next();
  } catch (error) {
    res.status(401).json({
      status: "fail",
      message: "Invalid token or token expired",
    });
  }
};

// Role restriction middleware
export const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.role)) {
      return res.status(403).json({
        status: "fail",
        message: "You do not have permission to perform this action",
      });
    }
    next();
  };
};
