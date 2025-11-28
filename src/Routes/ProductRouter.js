import express from "express";
import { upload } from "../middlewares/fileUpload.js";
import {
  protect,
  checkPermission,
} from "../middlewares/AdminIdentifications.js";
import { validateProduct } from "../middlewares/validation/productValidation.js";
import {
  createProductController,
  getAllProductsController,
  getProductBySlugController,
  getProductByIdController,
  updateProductBySlugController,
  deleteProductBySlugController,
  getProductsByCategoryController,
} from "../Controllers/ProductController.js";

const router = express.Router();

// Create a new product
router.post(
  "/",
  protect,
  checkPermission("product", "create"),
  upload.single("image"),
  validateProduct,
  createProductController
);

// Get all products
router.get("/", getAllProductsController);

// Get products by category ID
router.get("/category/:categoryId", getProductsByCategoryController);

// Get product by ID
router.get("/id/:id", getProductByIdController);

// Get product by slug
router.get("/:slug", getProductBySlugController);

// Update product by slug
router.patch(
  "/:slug",
  protect,
  checkPermission("product", "update"),
  upload.single("image"),
  updateProductBySlugController
);

// Delete product by slug
router.delete(
  "/:slug",
  protect,
  checkPermission("product", "delete"),
  deleteProductBySlugController
);

export default router;
