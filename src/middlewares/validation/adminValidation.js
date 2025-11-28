import Joi from "joi";

// Validation schema for admin login
export const validateAdminLogin = (req, res, next) => {
  const schema = Joi.object({
    email: Joi.string().email().required().messages({
      "string.email": "Please provide a valid email address",
      "string.empty": "Email is required",
      "any.required": "Email is required",
    }),
    password: Joi.string().required().messages({
      "string.empty": "Password is required",
      "any.required": "Password is required",
    }),
  });

  const { error, value } = schema.validate(req.body, { abortEarly: false });

  if (error) {
    const errorMessages = error.details.map((detail) => detail.message);
    return res.status(400).json({
      status: 400,
      success: false,
      message: "Validation failed",
      errors: errorMessages,
    });
  }

  // Store validated data and proceed
  req.validatedData = value;
  next();
};

// Validation schema for creating a new admin
export const validateAdminCreation = (req, res, next) => {
  const schema = Joi.object({
    fullName: Joi.string().required().min(2).max(100).messages({
      "string.empty": "Full name is required",
      "string.min": "Full name must be at least 2 characters long",
      "string.max": "Full name cannot exceed 100 characters",
      "any.required": "Full name is required",
    }),
    email: Joi.string().email().required().messages({
      "string.email": "Please provide a valid email address",
      "string.empty": "Email is required",
      "any.required": "Email is required",
    }),
    password: Joi.string().min(8).required().messages({
      "string.empty": "Password is required",
      "string.min": "Password must be at least 8 characters long",
      "any.required": "Password is required",
    }),
    phoneNumber: Joi.string().allow("").optional(),
    role: Joi.string()
      .valid("super_admin", "admin", "read_only")
      .required()
      .messages({
        "any.only": "Role must be one of: super_admin, admin, or read_only",
        "any.required": "Role is required",
      }),
    permissions: Joi.object().optional(),
  });

  const { error, value } = schema.validate(req.body, { abortEarly: false });

  if (error) {
    const errorMessages = error.details.map((detail) => detail.message);
    return res.status(400).json({
      status: 400,
      success: false,
      message: "Validation failed",
      errors: errorMessages,
    });
  }

  // Store validated data and proceed
  req.validatedData = value;
  next();
};
