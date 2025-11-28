import express from "express";
import {
  adminLogin,
  createNewAdmin,
  adminLogout,
  verifyAdmin,
  getAllAdmins,
} from "../Controllers/Auth/AdminAuthController.js";
import {
  validateAdminLogin,
  validateAdminCreation,
} from "../middlewares/validation/adminValidation.js";
import {
  protect,
  checkPermission,
} from "../middlewares/AdminIdentifications.js";

const router = express.Router();

// Auth routes
router.post("/login", validateAdminLogin, adminLogin);
router.post("/logout", adminLogout);
router.get("/verify", protect, verifyAdmin);
router.post(
  "/create",
  protect,
  checkPermission("adminManagement", "write"),
  validateAdminCreation,
  createNewAdmin
);

// Admin management routes
router.get(
  "/users",
  protect,
  checkPermission("adminManagement", "read"),
  getAllAdmins
);

export default router;
