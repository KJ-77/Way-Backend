import {
  authenticateAdmin,
  createAdmin,
} from "../../Services/crud/AdminAuthService.js";
import { hashPassword } from "../../utils/hashing.js";
import Admin from "../../Modules/Admin.model.js"; // Add this import

// Admin login
export const adminLogin = async (req, res) => {
  try {
    // Authenticate admin (validation already done in middleware)
    const { admin, token } = await authenticateAdmin(req.validatedData);

    // Calculate cookie expiration
    const expirationTime = 12 * 60 * 60 * 1000; // 12 hours

    // Set cookie and return response
    res
      .cookie("admin_authorization", `Bearer ${token}`, {
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
        message: "Admin logged in successfully",
        data: {
          token: token,
          admin: admin,
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
    console.error("Admin login error:", error);

    // Generic error response
    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred during admin login",
      data: null,
    });
  }
};

// Create new admin (only super admin can do this)
export const createNewAdmin = async (req, res) => {
  try {
    // Only super_admin can create new admins
    if (req.admin.role !== "super_admin") {
      return res.status(403).json({
        status: 403,
        success: false,
        message: "Only super admin can create new admin accounts",
      });
    }

    // Hash password
    const hashedPassword = await hashPassword(req.body.password);

    // Create admin
    const adminData = {
      ...req.body,
      password: hashedPassword,
    };

    const newAdmin = await createAdmin(adminData);

    res.status(201).json({
      status: 201,
      success: true,
      message: "Admin account created successfully",
      data: newAdmin,
    });
  } catch (error) {
    if (error.message === "Admin already exists") {
      return res.status(409).json({
        status: 409,
        success: false,
        message: "Admin with this email already exists",
        data: null,
      });
    }

    console.error("Create admin error:", error);
    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while creating admin account",
      data: null,
    });
  }
};

// Admin logout
export const adminLogout = (req, res) => {
  res.clearCookie("admin_authorization").status(200).json({
    status: 200,
    success: true,
    message: "Admin logged out successfully",
    data: null,
  });
};

// Verify admin token and return admin data
export const verifyAdmin = (req, res) => {
  try {
    // If we reach here, it means the middleware has already verified the token
    // and the admin data is available in req.admin
    const admin = req.admin;

    res.status(200).json({
      status: 200,
      success: true,
      message: "Admin token verified successfully",
      data: {
        admin: {
          id: admin.adminId,
          email: admin.email,
          role: admin.role,
          permissions: admin.permissions,
          isAdmin: admin.isAdmin,
        },
      },
    });
  } catch (error) {
    console.error("Admin verification error:", error);
    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred during admin verification",
      data: null,
    });
  }
};

// Get all admin users (only accessible by super_admin)
export const getAllAdmins = async (req, res) => {
  try {
    // Only list active admins and exclude sensitive fields
    const admins = await Admin.find({ active: true }).select(
      "-password -failedLoginAttempts -accountLocked -accountLockedUntil"
    );

    res.status(200).json({
      status: 200,
      success: true,
      message: "Admin users retrieved successfully",
      data: admins,
    });
  } catch (error) {
    console.error("Error fetching admin users:", error);
    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while retrieving admin users",
      data: null,
    });
  }
};
