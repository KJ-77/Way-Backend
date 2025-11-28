import express from "express";
import {
  createOrUpdateAboutUsController,
  getAboutUsController,
  deleteAboutUsController,
} from "../Controllers/AboutUsController.js";
import { AdminIdentifier } from "../middlewares/AdminIdentifications.js";
import { upload, handleMulterError } from "../middlewares/fileUpload.js";
import { addSecurityHeaders } from "../middlewares/securityHeadersMiddleware.js";

const router = express.Router();

// Apply security headers to all routes
router.use(addSecurityHeaders);

// Public routes (GET operations)
router.get("/", getAboutUsController);

// Protected routes (Admin only - CREATE, UPDATE, DELETE)
router.post(
  "/",
  AdminIdentifier,
  upload.fields([
    { name: "banner_image", maxCount: 1 }, // Single banner image
    { name: "coffee_bar_gallery", maxCount: 10 }, // Multiple images for coffee bar gallery
    { name: "our_tutors_gallery", maxCount: 10 }, // Multiple images for our tutors gallery
  ]),
  handleMulterError,
  createOrUpdateAboutUsController
);

router.put(
  "/",
  AdminIdentifier,
  upload.fields([
    { name: "banner_image", maxCount: 1 }, // Single banner image
    { name: "coffee_bar_gallery", maxCount: 10 }, // Multiple images for coffee bar gallery
    { name: "our_tutors_gallery", maxCount: 10 }, // Multiple images for our tutors gallery
  ]),
  handleMulterError,
  createOrUpdateAboutUsController
);

router.delete("/", AdminIdentifier, deleteAboutUsController);

export default router;
