import express from "express";
import {
  createProductionHandler,
  getAllProductionsHandler,
  getProductionBySlugHandler,
  updateProductionBySlugHandler,
  deleteProductionBySlugHandler,
} from "../Controllers/ProductionController.js";
import { AdminIdentifier } from "../middlewares/AdminIdentifications.js";
import { upload, handleMulterError } from "../middlewares/fileUpload.js";
import { addSecurityHeaders } from "../middlewares/securityHeadersMiddleware.js";

const router = express.Router();

// Apply security headers to all routes
router.use(addSecurityHeaders);

// Public routes
router.get("/", getAllProductionsHandler);
router.get("/:slug", getProductionBySlugHandler);

// Admin routes
router.post(
  "/",
  AdminIdentifier,
  upload.array("images", 10),
  handleMulterError,
  createProductionHandler
);
router.put(
  "/:slug",
  AdminIdentifier,
  upload.array("images", 10),
  handleMulterError,
  updateProductionBySlugHandler
);
router.delete("/:slug", AdminIdentifier, deleteProductionBySlugHandler);

export default router;
