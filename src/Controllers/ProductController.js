import {
  createProduct,
  getAllProducts,
  getProductBySlug,
  getProductById,
  updateProductBySlug,
  deleteProductBySlug,
  getProductsByCategory,
} from "../Services/crud/ProductService.js";
import path from "path";

// Create a new product
export const createProductController = async (req, res) => {
  try {
    const { name, description, price, category } = req.body;

    // Validate required fields
    if (!name || name.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Product name is required",
        data: null,
      });
    }

    if (!description || description.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Product description is required",
        data: null,
      });
    }

    if (!price || isNaN(parseFloat(price)) || parseFloat(price) < 0) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Valid product price is required",
        data: null,
      });
    }

    if (!category) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Product category is required",
        data: null,
      });
    }

    // Prepare image path if file uploaded
    let imagePath = undefined;
    if (req.file && req.file.destination && req.file.filename) {
      // Use multer's destination to get module subfolder (e.g., products)
      const moduleDir = path.basename(req.file.destination);
      imagePath = `${moduleDir}/${req.file.filename}`;
    }

    // Debug: log file metadata
    if (req.file) {
      console.log("[PRODUCT CREATE] file:", {
        fieldname: req.file.fieldname,
        destination: req.file.destination,
        filename: req.file.filename,
        path: req.file.path,
      });
    } else {
      console.log("[PRODUCT CREATE] no file received");
    }

    // Create product with uploaded file
    const product = await createProduct(
      {
        name: name.trim(),
        description: description.trim(),
        price: parseFloat(price),
        category,
        ...(imagePath ? { image: imagePath } : {}),
      },
      req.file
    );

    res.status(201).json({
      status: 201,
      success: true,
      message: "Product created successfully",
      data: product,
    });
  } catch (error) {
    console.error("Create product error:", error);

    if (error.message === "product_slug_exists") {
      return res.status(409).json({
        status: 409,
        success: false,
        message: "A product with similar name already exists",
        data: null,
      });
    }

    if (error.message === "category_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "The specified category does not exist",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while creating the product",
      data: null,
    });
  }
};

// Get all products with pagination and filtering
export const getAllProductsController = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const sort = req.query.sort || "createdAt";
    const order = req.query.order || "desc";
    const category = req.query.category || "";

    const options = {
      page,
      limit,
      search,
      sort,
      order,
      category,
    };

    const result = await getAllProducts(options);

    // Ensure image field exists for all products
    const productsWithImage = result.products.map((product) => {
      const obj =
        typeof product.toObject === "function" ? product.toObject() : product;
      return {
        ...obj,
        image: obj.image || "products/placeholder.jpg",
      };
    });

    res.status(200).json({
      status: 200,
      success: true,
      message: "Products retrieved successfully",
      results: productsWithImage.length,
      pagination: result.pagination,
      data: productsWithImage,
    });
  } catch (error) {
    console.error("Get all products error:", error);

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while retrieving products",
      data: null,
    });
  }
};

// Get product by slug
export const getProductBySlugController = async (req, res) => {
  try {
    const { slug } = req.params;

    if (!slug) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Product slug is required",
        data: null,
      });
    }

    const product = await getProductBySlug(slug);

    // Ensure image field exists
    const productWithImage = {
      ...(typeof product.toObject === "function"
        ? product.toObject()
        : product),
      image: (product && product.image) || "products/placeholder.jpg",
    };

    res.status(200).json({
      status: 200,
      success: true,
      message: "Product retrieved successfully",
      data: productWithImage,
    });
  } catch (error) {
    console.error("Get product by slug error:", error);

    if (error.message === "product_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Product not found",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while retrieving the product",
      data: null,
    });
  }
};

// Get product by ID
export const getProductByIdController = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Product ID is required",
        data: null,
      });
    }

    const product = await getProductById(id);

    // Ensure image field exists
    const productWithImage = {
      ...(typeof product.toObject === "function"
        ? product.toObject()
        : product),
      image: (product && product.image) || "products/placeholder.jpg",
    };

    res.status(200).json({
      status: 200,
      success: true,
      message: "Product retrieved successfully",
      data: productWithImage,
    });
  } catch (error) {
    console.error("Get product by ID error:", error);

    if (error.message === "product_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Product not found",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while retrieving the product",
      data: null,
    });
  }
};

// Update product by slug
export const updateProductBySlugController = async (req, res) => {
  try {
    const { slug } = req.params;
    const { name, description, price, category } = req.body;

    if (!slug) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Product slug is required",
        data: null,
      });
    }

    // Validate input fields if provided
    if (name && name.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Product name cannot be empty",
        data: null,
      });
    }

    if (description && description.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Product description cannot be empty",
        data: null,
      });
    }

    if (
      price !== undefined &&
      (isNaN(parseFloat(price)) || parseFloat(price) < 0)
    ) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Valid product price is required",
        data: null,
      });
    }

    const updateData = {};

    if (name) {
      updateData.name = name.trim();
    }

    if (description) {
      updateData.description = description.trim();
    }

    if (price !== undefined) {
      updateData.price = parseFloat(price);
    }

    if (category) {
      updateData.category = category;
    }

    // Debug: log file metadata
    if (req.file) {
      console.log("[PRODUCT UPDATE] file:", {
        fieldname: req.file.fieldname,
        destination: req.file.destination,
        filename: req.file.filename,
        path: req.file.path,
      });
    } else {
      console.log("[PRODUCT UPDATE] no file received");
    }

    // Prepare image path if file uploaded
    let imagePath = undefined;
    if (req.file && req.file.destination && req.file.filename) {
      const moduleDir = path.basename(req.file.destination);
      imagePath = `${moduleDir}/${req.file.filename}`;
      updateData.image = imagePath;
    }

    const updatedProduct = await updateProductBySlug(
      slug,
      updateData,
      req.file
    );

    res.status(200).json({
      status: 200,
      success: true,
      message: "Product updated successfully",
      data: updatedProduct,
    });
  } catch (error) {
    console.error("Update product error:", error);

    if (error.message === "product_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Product not found",
        data: null,
      });
    }

    if (error.message === "product_slug_exists") {
      return res.status(409).json({
        status: 409,
        success: false,
        message: "A product with similar name already exists",
        data: null,
      });
    }

    if (error.message === "category_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "The specified category does not exist",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while updating the product",
      data: null,
    });
  }
};

// Delete product by slug
export const deleteProductBySlugController = async (req, res) => {
  try {
    const { slug } = req.params;

    if (!slug) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Product slug is required",
        data: null,
      });
    }

    await deleteProductBySlug(slug);

    res.status(200).json({
      status: 200,
      success: true,
      message: "Product deleted successfully",
      data: null,
    });
  } catch (error) {
    console.error("Delete product error:", error);

    if (error.message === "product_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Product not found",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while deleting the product",
      data: null,
    });
  }
};

// Get products by category ID
export const getProductsByCategoryController = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const sort = req.query.sort || "createdAt";
    const order = req.query.order || "desc";

    if (!categoryId) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Category ID is required",
        data: null,
      });
    }

    const options = {
      page,
      limit,
      search,
      sort,
      order,
    };

    const result = await getProductsByCategory(categoryId, options);

    // Ensure image field exists for all products
    const productsWithImage = result.products.map((product) => {
      const obj =
        typeof product.toObject === "function" ? product.toObject() : product;
      return {
        ...obj,
        image: obj.image || "products/placeholder.jpg",
      };
    });

    res.status(200).json({
      status: 200,
      success: true,
      message: "Products retrieved successfully",
      results: productsWithImage.length,
      pagination: result.pagination,
      data: productsWithImage,
    });
  } catch (error) {
    console.error("Get products by category error:", error);

    if (error.message === "category_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Category not found",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while retrieving products",
      data: null,
    });
  }
};
