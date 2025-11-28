// Middleware to restrict access to super admin only
export const SuperAdminOnly = (req, res, next) => {
  // Check if admin exists in request (protect middleware must be used before this)
  if (!req.admin) {
    return res.status(401).json({
      status: 401,
      success: false,
      message: "Authentication required",
    });
  }

  // Check if admin is super admin
  if (req.admin.role !== "super_admin") {
    return res.status(403).json({
      status: 403,
      success: false,
      message: "Access denied. Super admin privileges required.",
    });
  }

  next();
};
