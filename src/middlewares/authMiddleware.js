import jwt from "jsonwebtoken";
import Admin from "../Modules/Admin.model.js";

// Protect routes - verify token and authenticate
export const protect = async (req, res, next) => {
  let token;

  // Check for token in Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  }
  // Then check cookies as fallback
  else if (req.cookies && req.cookies["admin_authorization"]) {
    const cookieToken = req.cookies["admin_authorization"];
    if (cookieToken.startsWith("Bearer ")) {
      token = cookieToken.split(" ")[1];
    } else {
      token = cookieToken; // In case it's not prefixed
    }
  }

  if (!token) {
    return res.status(401).json({
      status: 401,
      success: false,
      message: "Authentication token is required",
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Find admin by ID
    const admin = await Admin.findById(decoded.adminId);

    if (!admin || !admin.active) {
      return res.status(401).json({
        status: 401,
        success: false,
        message: "Invalid token or account deactivated",
      });
    }

    // Attach admin data to request
    req.admin = {
      id: admin._id,
      email: admin.email,
      role: admin.role,
      permissions: admin.permissions,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      status: 401,
      success: false,
      message: "Invalid or expired token",
    });
  }
};

// Restrict access to specific roles
export const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.admin || !roles.includes(req.admin.role)) {
      return res.status(403).json({
        status: 403,
        success: false,
        message: "You don't have permission to perform this action",
      });
    }
    next();
  };
};
