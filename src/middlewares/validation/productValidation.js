// Validation middleware for product-related operations

// Validate product category
export const validateProductCategory = (req, res, next) => {
  try {
    const { title } = req.body;
    const errors = {};

    // Validate title
    if (!title) {
      errors.title = "Category title is required";
    } else if (title.trim().length < 3) {
      errors.title = "Category title must be at least 3 characters";
    } else if (title.trim().length > 50) {
      errors.title = "Category title cannot exceed 50 characters";
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Validation failed",
        errors,
      });
    }

    // If validation passes
    req.validatedData = {
      title: title.trim(),
    };

    next();
  } catch (error) {
    console.error("Product category validation error:", error);
    res.status(500).json({
      status: 500,
      success: false,
      message: "Validation error",
      data: null,
    });
  }
};

// Validate product creation
export const validateProduct = (req, res, next) => {
  try {
    const { name, description, price, category } = req.body;
    const errors = {};

    // Validate name
    if (!name) {
      errors.name = "Product name is required";
    } else if (name.trim().length < 3) {
      errors.name = "Product name must be at least 3 characters";
    } else if (name.trim().length > 100) {
      errors.name = "Product name cannot exceed 100 characters";
    }

    // Validate description
    if (!description) {
      errors.description = "Product description is required";
    } else if (description.trim().length < 10) {
      errors.description = "Product description must be at least 10 characters";
    }

    // Validate price
    if (!price) {
      errors.price = "Product price is required";
    } else if (isNaN(parseFloat(price)) || parseFloat(price) < 0) {
      errors.price = "Price must be a valid non-negative number";
    }

    // Validate category
    if (!category) {
      errors.category = "Product category is required";
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Validation failed",
        errors,
      });
    }

    // If validation passes
    req.validatedData = {
      name: name.trim(),
      description: description.trim(),
      price: parseFloat(price),
      category,
    };

    next();
  } catch (error) {
    console.error("Product validation error:", error);
    res.status(500).json({
      status: 500,
      success: false,
      message: "Validation error",
      data: null,
    });
  }
};
