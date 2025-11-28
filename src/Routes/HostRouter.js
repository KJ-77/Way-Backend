import express from "express";
import {
  createHostHandler,
  getAllHostsHandler,
  getHostBySlugHandler,
  updateHostBySlugHandler,
  deleteHostBySlugHandler,
} from "../Controllers/HostController.js";
import { upload } from "../middlewares/fileUpload.js";
import { AdminIdentifier } from "../middlewares/AdminIdentifications.js";

const router = express.Router();

// Public routes
router.get("/", getAllHostsHandler);
router.get("/:slug", getHostBySlugHandler);

// Protected routes (Admin only)
router.post("/", AdminIdentifier, upload.single("image"), createHostHandler);
router.put(
  "/:slug",
  AdminIdentifier,
  upload.single("image"),
  updateHostBySlugHandler
);
router.delete("/:slug", AdminIdentifier, deleteHostBySlugHandler);

export default router;
