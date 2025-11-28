import express from "express";
import {
  createEventController,
  getAllEventsController,
  getEventBySlugController,
  updateEventBySlugController,
  deleteEventBySlugController,
  handleEventRequestController,
} from "../Controllers/EventController.js";
import { AdminIdentifier } from "../middlewares/AdminIdentifications.js";
import { upload, handleMulterError } from "../middlewares/fileUpload.js";
import { addSecurityHeaders } from "../middlewares/securityHeadersMiddleware.js";

const router = express.Router();

// Apply security headers to all routes
router.use(addSecurityHeaders);

// Public routes (GET operations)
router.get("/", getAllEventsController);
router.get("/:slug", getEventBySlugController);

// Event request endpoint
router.post("/request", handleEventRequestController);

// Protected routes (Admin only - CREATE, UPDATE, DELETE)
router.post(
  "/",
  AdminIdentifier,
  upload.single("image"), // Single image upload for event
  handleMulterError,
  createEventController
);

router.put(
  "/:slug",
  AdminIdentifier,
  upload.single("image"), // Single image upload for event
  handleMulterError,
  updateEventBySlugController
);

router.delete("/:slug", AdminIdentifier, deleteEventBySlugController);

export default router;
