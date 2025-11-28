import {
  createProductCategory,
  getAllProductCategories,
  getProductCategoryBySlug,
  updateProductCategoryBySlug,
  deleteProductCategoryBySlug,
} from "../Services/crud/ProductCategoryService.js";

// Create a new product category
export const createProductCategoryController = async (req, res) => {
  try {
    const { title } = req.body;

    // Validate required fields
    if (!title || title.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Category title is required",
        data: null,
      });
    }

    const category = await createProductCategory({
      title: title.trim(),
    });

    res.status(201).json({
      status: 201,
      success: true,
      message: "Product category created successfully",
      data: category,
    });
  } catch (error) {
    console.error("Create product category error:", error);

    if (error.message === "category_slug_exists") {
      return res.status(409).json({
        status: 409,
        success: false,
        message: "A category with similar title already exists",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while creating the product category",
      data: null,
    });
  }
};

// Get all product categories with pagination
export const getAllProductCategoriesController = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const sort = req.query.sort || "createdAt";
    const order = req.query.order || "desc";

    const options = {
      page,
      limit,
      search,
      sort,
      order,
    };

    const result = await getAllProductCategories(options);

    res.status(200).json({
      status: 200,
      success: true,
      message: "Product categories retrieved successfully",
      results: result.categories.length,
      pagination: result.pagination,
      data: result.categories,
    });
  } catch (error) {
    console.error("Get all product categories error:", error);

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while retrieving product categories",
      data: null,
    });
  }
};

// Get product category by slug
export const getProductCategoryBySlugController = async (req, res) => {
  try {
    const { slug } = req.params;

    if (!slug) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Category slug is required",
        data: null,
      });
    }

    const category = await getProductCategoryBySlug(slug);

    res.status(200).json({
      status: 200,
      success: true,
      message: "Product category retrieved successfully",
      data: category,
    });
  } catch (error) {
    console.error("Get product category by slug error:", error);

    if (error.message === "category_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Product category not found",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while retrieving the product category",
      data: null,
    });
  }
};

// Update product category by slug
export const updateProductCategoryBySlugController = async (req, res) => {
  try {
    const { slug } = req.params;
    const { title } = req.body;

    if (!slug) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Category slug is required",
        data: null,
      });
    }

    // Validate title if provided
    if (title && title.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Category title cannot be empty",
        data: null,
      });
    }

    const updateData = {};
    if (title) {
      updateData.title = title.trim();
    }

    const updatedCategory = await updateProductCategoryBySlug(slug, updateData);

    res.status(200).json({
      status: 200,
      success: true,
      message: "Product category updated successfully",
      data: updatedCategory,
    });
  } catch (error) {
    console.error("Update product category error:", error);

    if (error.message === "category_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Product category not found",
        data: null,
      });
    }

    if (error.message === "category_slug_exists") {
      return res.status(409).json({
        status: 409,
        success: false,
        message: "A category with similar title already exists",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while updating the product category",
      data: null,
    });
  }
};

// Delete product category by slug
export const deleteProductCategoryBySlugController = async (req, res) => {
  try {
    const { slug } = req.params;

    if (!slug) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Category slug is required",
        data: null,
      });
    }

    await deleteProductCategoryBySlug(slug);

    res.status(200).json({
      status: 200,
      success: true,
      message: "Product category deleted successfully",
      data: null,
    });
  } catch (error) {
    console.error("Delete product category error:", error);

    if (error.message === "category_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Product category not found",
        data: null,
      });
    }

    if (error.message === "category_has_products") {
      return res.status(400).json({
        status: 400,
        success: false,
        message:
          "Cannot delete category that has products. Please remove or reassign products first.",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while deleting the product category",
      data: null,
    });
  }
};
