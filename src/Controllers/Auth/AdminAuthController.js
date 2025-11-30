import {
  authenticateAdmin,
  createAdmin,
} from "../../Services/crud/AdminAuthService.js";
import Admin from "../../Modules/Admin.model.js";

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

    // Create admin - service layer will hash the password
    const newAdmin = await createAdmin(req.body);

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

// Get single admin by ID (only accessible by super_admin)
export const getAdminById = async (req, res) => {
  try {
    const { id } = req.params;

    // Find admin by ID, exclude sensitive fields
    const admin = await Admin.findById(id).select(
      "-password -failedLoginAttempts -accountLocked -accountLockedUntil"
    );

    if (!admin) {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Admin not found",
        data: null,
      });
    }

    res.status(200).json({
      status: 200,
      success: true,
      message: "Admin retrieved successfully",
      data: admin,
    });
  } catch (error) {
    console.error("Error fetching admin by ID:", error);
    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while retrieving admin",
      data: null,
    });
  }
};

// Update admin by ID (only accessible by super_admin)
export const updateAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, email, role, password } = req.body;

    // Only super_admin can update admins
    if (req.admin.role !== "super_admin") {
      return res.status(403).json({
        status: 403,
        success: false,
        message: "Only super admin can update admin accounts",
      });
    }

    // Find the admin
    const admin = await Admin.findById(id);

    if (!admin) {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Admin not found",
        data: null,
      });
    }

    // Update fields if provided
    if (fullName) admin.fullName = fullName;
    if (email) admin.email = email;
    if (role) admin.role = role;

    // Update password if provided
    if (password) {
      const bcrypt = await import("bcryptjs");
      const salt = await bcrypt.genSalt(10);
      admin.password = await bcrypt.hash(password, salt);
    }

    // Save the updated admin
    await admin.save();

    // Return updated admin without sensitive data
    const updatedAdmin = await Admin.findById(id).select(
      "-password -failedLoginAttempts -accountLocked -accountLockedUntil"
    );

    res.status(200).json({
      status: 200,
      success: true,
      message: "Admin updated successfully",
      data: updatedAdmin,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        status: 409,
        success: false,
        message: "An admin with this email already exists",
        data: null,
      });
    }

    console.error("Error updating admin:", error);
    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while updating admin",
      data: null,
    });
  }
};

// Delete admin by ID (only accessible by super_admin)
export const deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    // Only super_admin can delete admins
    if (req.admin.role !== "super_admin") {
      return res.status(403).json({
        status: 403,
        success: false,
        message: "Only super admin can delete admin accounts",
      });
    }

    // Prevent deleting yourself
    if (req.admin.adminId === id) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "You cannot delete your own admin account",
        data: null,
      });
    }

    // Find and delete the admin
    const admin = await Admin.findByIdAndDelete(id);

    if (!admin) {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Admin not found",
        data: null,
      });
    }

    res.status(200).json({
      status: 200,
      success: true,
      message: "Admin deleted successfully",
      data: null,
    });
  } catch (error) {
    console.error("Error deleting admin:", error);
    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while deleting admin",
      data: null,
    });
  }
};
