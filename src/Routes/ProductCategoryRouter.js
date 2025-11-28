import express from "express";
import {
  protect,
  checkPermission,
} from "../middlewares/AdminIdentifications.js";
import { validateProductCategory } from "../middlewares/validation/productValidation.js";
import {
  createProductCategoryController,
  getAllProductCategoriesController,
  getProductCategoryBySlugController,
  updateProductCategoryBySlugController,
  deleteProductCategoryBySlugController,
} from "../Controllers/ProductCategoryController.js";

const router = express.Router();

// Create a new product category
router.post(
  "/",
  protect,
  checkPermission("productCategory", "create"),
  validateProductCategory,
  createProductCategoryController
);

// Get all product categories
router.get("/", getAllProductCategoriesController);

// Get product category by slug
router.get("/:slug", getProductCategoryBySlugController);

// Update product category by slug
router.patch(
  "/:slug",
  protect,
  checkPermission("productCategory", "update"),
  updateProductCategoryBySlugController
);

// Delete product category by slug
router.delete(
  "/:slug",
  protect,
  checkPermission("productCategory", "delete"),
  deleteProductCategoryBySlugController
);

export default router;
