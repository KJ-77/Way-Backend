import express from "express";
import {
  createScheduleController,
  getAllSchedulesController,
  getScheduleBySlugController,
  updateScheduleBySlugController,
  deleteScheduleBySlugController,
  getScheduleByIdController,
} from "../Controllers/ScheduleController.js";
import { getScheduleTutors } from "../Controllers/ScheduleTutorController.js";
import { AdminIdentifier, OptionalAdminAuth } from "../middlewares/AdminIdentifications.js";
import { SuperAdminOnly } from "../middlewares/SuperAdminOnly.js";
import { upload, handleMulterError } from "../middlewares/fileUpload.js";
import { addSecurityHeaders } from "../middlewares/securityHeadersMiddleware.js";
import { sanitizeAllScheduleImages } from "../Services/crud/ScheduleService.js";

const router = express.Router();

// Apply security headers to all routes
router.use(addSecurityHeaders);

// Public routes (with optional admin auth to show drafts to admins)
router.get("/", OptionalAdminAuth, getAllSchedulesController);
router.get("/id/:id", getScheduleByIdController); // New route for getting schedule by ID
router.get("/:slug", getScheduleBySlugController);

// Protected super admin only routes
router.post(
  "/",
  AdminIdentifier,
  SuperAdminOnly,
  upload.array("images", 10), // Allow up to 10 images
  handleMulterError,
  createScheduleController
);

router.put(
  "/:slug",
  AdminIdentifier,
  SuperAdminOnly,
  upload.array("images", 10), // Allow up to 10 images
  handleMulterError,
  updateScheduleBySlugController
);

router.delete("/:slug", AdminIdentifier, SuperAdminOnly, deleteScheduleBySlugController);

// Special route to get tutors for a schedule
router.get("/:slug/tutors", getScheduleTutors);

// Utility route to fix database issues with image paths
router.post("/admin/sanitize-images", AdminIdentifier, async (req, res) => {
  try {
    const count = await sanitizeAllScheduleImages();
    res.status(200).json({
      status: "success",
      message: `Successfully sanitized ${count} schedules`,
      sanitized: count,
    });
  } catch (error) {
    console.error("Error in sanitize route:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to sanitize schedules",
      error: error.message,
    });
  }
});

export default router;
