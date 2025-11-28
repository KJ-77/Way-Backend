import express from "express";
import {
  protect,
  checkPermission,
} from "../middlewares/AdminIdentifications.js";
import {
  createProductRequestController,
  getAllProductRequestsController,
  getProductRequestByIdController,
  updateProductRequestStatusController,
  sendMessageToCustomerController,
} from "../Controllers/ProductRequestController.js";

const router = express.Router();

// Create a new product request (public route - no auth required)
router.post("/", createProductRequestController);

// Get all product requests (admin only)
router.get(
  "/",
  protect,
  checkPermission("productRequest", "read"),
  getAllProductRequestsController
);

// Get product request by ID (admin only)
router.get(
  "/:id",
  protect,
  checkPermission("productRequest", "read"),
  getProductRequestByIdController
);

// Update product request status (admin only)
router.patch(
  "/:id/status",
  protect,
  checkPermission("productRequest", "update"),
  updateProductRequestStatusController
);

// Send message to customer (admin only)
router.post(
  "/:id/send-message",
  protect,
  checkPermission("productRequest", "update"),
  sendMessageToCustomerController
);

export default router;
