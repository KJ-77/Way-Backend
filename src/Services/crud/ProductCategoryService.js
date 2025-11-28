import ProductCategory from "../../Modules/ProductCategory.model.js";
import slugify from "slugify";

// Create a new category
export const createProductCategory = async (categoryData) => {
  try {
    // Check if slug already exists
    const slug = slugify(categoryData.title, { lower: true });
    const existingCategory = await ProductCategory.findOne({ slug });

    if (existingCategory) {
      throw new Error("category_slug_exists");
    }

    const newCategory = await ProductCategory.create({
      ...categoryData,
      slug,
    });

    return newCategory;
  } catch (error) {
    throw error;
  }
};

// Get all categories with optional pagination
export const getAllProductCategories = async (options = {}) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      sort = "createdAt",
      order = "desc",
    } = options;

    const query = {};

    if (search) {
      query.title = { $regex: search, $options: "i" };
    }

    const sortOption = { [sort]: order === "desc" ? -1 : 1 };

    const total = await ProductCategory.countDocuments(query);
    const categories = await ProductCategory.find(query)
      .sort(sortOption)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    return {
      categories,
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

// Get category by slug
export const getProductCategoryBySlug = async (slug) => {
  try {
    const category = await ProductCategory.findOne({ slug });

    if (!category) {
      throw new Error("category_not_found");
    }

    return category;
  } catch (error) {
    throw error;
  }
};

// Get category by ID
export const getProductCategoryById = async (id) => {
  try {
    const category = await ProductCategory.findById(id);

    if (!category) {
      throw new Error("category_not_found");
    }

    return category;
  } catch (error) {
    throw error;
  }
};

// Update category by slug
export const updateProductCategoryBySlug = async (slug, categoryData) => {
  try {
    const category = await ProductCategory.findOne({ slug });

    if (!category) {
      throw new Error("category_not_found");
    }

    // Check if title changed, verify new slug doesn't exist
    if (categoryData.title && categoryData.title !== category.title) {
      const newSlug = slugify(categoryData.title, { lower: true });
      const slugExists = await ProductCategory.findOne({
        slug: newSlug,
        _id: { $ne: category._id },
      });

      if (slugExists) {
        throw new Error("category_slug_exists");
      }

      categoryData.slug = newSlug;
    }

    const updatedCategory = await ProductCategory.findOneAndUpdate(
      { slug },
      categoryData,
      { new: true }
    );

    return updatedCategory;
  } catch (error) {
    throw error;
  }
};

// Delete category by slug
export const deleteProductCategoryBySlug = async (slug) => {
  try {
    const category = await ProductCategory.findOne({ slug });

    if (!category) {
      throw new Error("category_not_found");
    }

    // Check if the category has products
    const Product = (await import("../../Modules/Product.model.js")).default;
    const productsCount = await Product.countDocuments({
      category: category._id,
    });

    if (productsCount > 0) {
      throw new Error("category_has_products");
    }

    await ProductCategory.deleteOne({ slug });

    return { message: "Category deleted successfully" };
  } catch (error) {
    throw error;
  }
};
