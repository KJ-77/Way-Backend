import express from "express";
import {
  createBookWithUsHandler,
  getAllBookWithUsHandler,
  getBookWithUsBySlugHandler,
  updateBookWithUsBySlugHandler,
  deleteBookWithUsBySlugHandler,
} from "../Controllers/BookWithUsController.js";
import { upload, handleMulterError } from "../middlewares/fileUpload.js";
import { AdminIdentifier } from "../middlewares/AdminIdentifications.js";
import { addSecurityHeaders } from "../middlewares/securityHeadersMiddleware.js";

const router = express.Router();

// Apply security headers to all routes
router.use(addSecurityHeaders);

// Public routes
router.get("/", getAllBookWithUsHandler);
router.get("/:slug", getBookWithUsBySlugHandler);

// Admin routes
router.post(
  "/",
  AdminIdentifier,
  upload.array("images", 10),
  handleMulterError,
  createBookWithUsHandler
);
router.put(
  "/:slug",
  AdminIdentifier,
  upload.array("images", 10),
  handleMulterError,
  updateBookWithUsBySlugHandler
);
router.delete("/:slug", AdminIdentifier, deleteBookWithUsBySlugHandler);

export default router;
