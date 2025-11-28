import jwt from "jsonwebtoken";
import Admin from "../Modules/Admin.model.js";

// Middleware to protect routes and verify admin token
export const protect = async (req, res, next) => {
  try {
    let token;

    // Get token from Authorization header or cookie
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      // Extract token from Bearer token in header
      token = req.headers.authorization.split(" ")[1];
    } else if (req.cookies && req.cookies.admin_authorization) {
      // Extract token from cookie
      token = req.cookies.admin_authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({
        status: 401,
        success: false,
        message: "You are not logged in. Please log in to get access",
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if admin still exists
    const currentAdmin = await Admin.findById(decoded.adminId); // CHANGED: from decoded.id to decoded.adminId

    if (!currentAdmin) {
      return res.status(401).json({
        status: 401,
        success: false,
        message: "The user belonging to this token no longer exists",
      });
    }

    // Check if admin is active
    if (!currentAdmin.active) {
      return res.status(401).json({
        status: 401,
        success: false,
        message: "This admin account has been deactivated",
      });
    }

    // Grant access to protected route
    req.admin = {
      adminId: currentAdmin._id,
      email: currentAdmin.email,
      role: currentAdmin.role,
      permissions: currentAdmin.permissions,
      isAdmin: true,
    };

    next();
  } catch (error) {
    // Handle JWT errors more specifically
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        status: 401,
        success: false,
        message: "Invalid token. Please log in again.",
      });
    }

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        status: 401,
        success: false,
        message: "Your session has expired! Please log in again.",
      });
    }

    // Generic error response
    return res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred during authentication",
    });
  }
};

// Middleware to check specific permissions
export const checkPermission = (resource, action) => {
  return (req, res, next) => {
    // If admin doesn't exist in request (protect middleware not used), deny access
    if (!req.admin) {
      return res.status(401).json({
        status: 401,
        success: false,
        message: "Authentication required",
      });
    }

    // Super admins always have all permissions
    if (req.admin.role === "super_admin") {
      return next();
    }

    // Check if admin has the required permission
    if (
      req.admin.permissions &&
      req.admin.permissions[resource] &&
      req.admin.permissions[resource][action]
    ) {
      return next();
    }

    // Permission denied
    return res.status(403).json({
      status: 403,
      success: false,
      message: "You do not have permission to perform this action",
    });
  };
};

// Optional admin authentication - doesn't fail if no token, but sets req.admin if valid token exists
export const OptionalAdminAuth = async (req, res, next) => {
  try {
    let token;

    // Get token from Authorization header or cookie
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    } else if (req.cookies && req.cookies.admin_authorization) {
      token = req.cookies.admin_authorization.split(" ")[1];
    }

    // If no token, continue without setting req.admin
    if (!token) {
      return next();
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if admin still exists
    const currentAdmin = await Admin.findById(decoded.adminId);

    if (currentAdmin && currentAdmin.active) {
      // Set admin in request
      req.admin = {
        adminId: currentAdmin._id,
        email: currentAdmin.email,
        role: currentAdmin.role,
        permissions: currentAdmin.permissions,
        isAdmin: true,
      };
    }

    next();
  } catch (error) {
    // On error, just continue without admin auth (don't fail the request)
    next();
  }
};

// Add this new export for backward compatibility
export const AdminIdentifier = protect;
