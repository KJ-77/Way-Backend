import Product from "../../Modules/Product.model.js";
import slugify from "slugify";
import fs from "fs";
import path from "path";
import { getProductCategoryById } from "./ProductCategoryService.js";

// Create a new product
export const createProduct = async (productData, file) => {
  try {
    // Verify the category exists
    await getProductCategoryById(productData.category);

    // Check if slug already exists
    const slug = slugify(productData.name, { lower: true });
    const existingProduct = await Product.findOne({ slug });

    if (existingProduct) {
      throw new Error("product_slug_exists");
    }

    // If controller already computed image, respect it; otherwise compute default/derived
    if (!productData.image) {
      if (file) {
        const moduleDir = path.basename(file.destination || "products");
        productData.image = `${moduleDir}/${file.filename}`;
      } else {
        productData.image = "products/placeholder.jpg";
      }
    }

    const newProduct = await Product.create({
      ...productData,
      slug,
    });

    // Populate category data
    const populatedProduct = await Product.findById(newProduct._id).populate(
      "category"
    );

    return populatedProduct;
  } catch (error) {
    // Delete uploaded file if there was an error
    if (file && file.filename) {
      try {
        fs.unlinkSync(path.join("uploads", file.filename));
      } catch (err) {
        console.error("Error deleting file:", err);
      }
    }
    throw error;
  }
};

// Get all products with optional pagination and filtering
export const getAllProducts = async (options = {}) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      sort = "createdAt",
      order = "desc",
      category = "",
    } = options;

    const query = {};

    // Add search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    // Filter by category if provided
    if (category) {
      query.category = category;
    }

    const sortOption = { [sort]: order === "desc" ? -1 : 1 };

    const total = await Product.countDocuments(query);
    let products = await Product.find(query)
      .select(
        "name slug description price image category active createdAt updatedAt"
      )
      .populate("category")
      .sort(sortOption)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    // Ensure all products have the image field and normalize old values
    products = products.map((product) => {
      const productObj = product.toObject();
      if (!productObj.image) {
        productObj.image = "products/placeholder.jpg";
      } else if (
        typeof productObj.image === "string" &&
        !productObj.image.includes("/")
      ) {
        // Backfill records that stored only filename (no subfolder)
        productObj.image = `products/${productObj.image}`;
      }
      return productObj;
    });

    return {
      products,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    };
  } catch (error) {
    throw error;
  }
};

// Get product by slug
export const getProductBySlug = async (slug) => {
  try {
    let product = await Product.findOne({ slug })
      .select(
        "name slug description price image category active createdAt updatedAt"
      )
      .populate("category");

    if (!product) {
      throw new Error("product_not_found");
    }

    // Ensure product has image field and normalize old values
    const productObj = product.toObject();
    if (!productObj.image) {
      productObj.image = "products/placeholder.jpg";
    } else if (
      typeof productObj.image === "string" &&
      !productObj.image.includes("/")
    ) {
      productObj.image = `products/${productObj.image}`;
    }

    return productObj;
  } catch (error) {
    throw error;
  }
};

// Get product by ID
export const getProductById = async (id) => {
  try {
    let product = await Product.findById(id)
      .select(
        "name slug description price image category active createdAt updatedAt"
      )
      .populate("category");

    if (!product) {
      throw new Error("product_not_found");
    }

    // Ensure product has image field and normalize old values
    const productObj = product.toObject();
    if (!productObj.image) {
      productObj.image = "products/placeholder.jpg";
    } else if (
      typeof productObj.image === "string" &&
      !productObj.image.includes("/")
    ) {
      productObj.image = `products/${productObj.image}`;
    }

    return productObj;
  } catch (error) {
    throw error;
  }
};

// Update product by slug
export const updateProductBySlug = async (slug, productData, file) => {
  try {
    const product = await Product.findOne({ slug });

    if (!product) {
      throw new Error("product_not_found");
    }

    // If category is being updated, verify it exists
    if (productData.category) {
      await getProductCategoryById(productData.category);
    }

    // Check if name changed, verify new slug doesn't exist
    if (productData.name && productData.name !== product.name) {
      const newSlug = slugify(productData.name, { lower: true });
      const slugExists = await Product.findOne({
        slug: newSlug,
        _id: { $ne: product._id },
      });

      if (slugExists) {
        throw new Error("product_slug_exists");
      }

      productData.slug = newSlug;
    }

    // Handle file upload
    if (file) {
      // Delete old image if exists and it's not the default placeholder
      if (product.image && product.image !== "products/placeholder.jpg") {
        try {
          fs.unlinkSync(path.join("uploads", product.image));
        } catch (err) {
          console.error("Error deleting old image:", err);
        }
      }
      if (!productData.image) {
        const moduleDir = path.basename(file.destination || "products");
        productData.image = `${moduleDir}/${file.filename}`;
      }
    }
    // Make sure we don't accidentally unset the image field
    else if (!productData.image) {
      productData.image = product.image || "products/placeholder.jpg";
    }

    const updatedProduct = await Product.findOneAndUpdate(
      { slug },
      productData,
      { new: true }
    ).populate("category");

    return updatedProduct;
  } catch (error) {
    // Delete uploaded file if there was an error
    if (file && file.filename) {
      try {
        fs.unlinkSync(path.join("uploads", file.filename));
      } catch (err) {
        console.error("Error deleting file:", err);
      }
    }
    throw error;
  }
};

// Delete product by slug
export const deleteProductBySlug = async (slug) => {
  try {
    const product = await Product.findOne({ slug });

    if (!product) {
      throw new Error("product_not_found");
    }

    // Delete image if exists
    if (product.image) {
      try {
        fs.unlinkSync(path.join("uploads", product.image));
      } catch (err) {
        console.error("Error deleting image:", err);
      }
    }

    await Product.deleteOne({ slug });

    return { message: "Product deleted successfully" };
  } catch (error) {
    throw error;
  }
};

// Get products by category
export const getProductsByCategory = async (categoryId, options = {}) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      sort = "createdAt",
      order = "desc",
    } = options;

    // Verify the category exists
    await getProductCategoryById(categoryId);

    const query = { category: categoryId };

    // Add search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    const sortOption = { [sort]: order === "desc" ? -1 : 1 };

    const total = await Product.countDocuments(query);
    let products = await Product.find(query)
      .select(
        "name slug description price image category active createdAt updatedAt"
      )
      .populate("category")
      .sort(sortOption)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    // Ensure all products have the image field and normalize old values
    products = products.map((product) => {
      const productObj = product.toObject();
      if (!productObj.image) {
        productObj.image = "products/placeholder.jpg";
      } else if (
        typeof productObj.image === "string" &&
        !productObj.image.includes("/")
      ) {
        productObj.image = `products/${productObj.image}`;
      }
      return productObj;
    });

    return {
      products,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    };
  } catch (error) {
    throw error;
  }
};
