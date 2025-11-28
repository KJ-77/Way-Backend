import express from "express";
import {
  createHomeController,
  getAllHomesController,
  getHomeBySlugController,
  updateHomeBySlugController,
  deleteHomeBySlugController,
  cleanupHomeLegacyDataController,
} from "../Controllers/HomeController.js";
import { AdminIdentifier } from "../middlewares/AdminIdentifications.js";
import { upload, handleMulterError } from "../middlewares/fileUpload.js";
import { addSecurityHeaders } from "../middlewares/securityHeadersMiddleware.js";

const router = express.Router();

// Apply security headers to all routes
router.use(addSecurityHeaders);

// Public routes (GET operations)
router.get("/", getAllHomesController);
router.get("/:slug", getHomeBySlugController);

// Protected routes (Admin only - CREATE, UPDATE, DELETE)
router.post(
  "/",
  AdminIdentifier,
  upload.single("video"), // Single video upload for home
  handleMulterError,
  createHomeController
);

router.put(
  "/:slug",
  AdminIdentifier,
  upload.single("video"), // Single video upload for home
  handleMulterError,
  updateHomeBySlugController
);

router.delete("/:slug", AdminIdentifier, deleteHomeBySlugController);

// Cleanup legacy data (Admin only)
router.post("/cleanup", AdminIdentifier, cleanupHomeLegacyDataController);

export default router;
