import Joi from "joi";

export const signupSchema = Joi.object({
  fullName: Joi.string().required().trim().messages({
    "string.empty": "Full name is required",
    "any.required": "Full name is required",
  }),
  phoneNumber: Joi.string().required().trim().messages({
    "string.empty": "Phone number is required",
    "any.required": "Phone number is required",
  }),
  email: Joi.string()
    .email({
      tlds: {
        allow: ["com", "net"],
      },
      minDomainSegments: 2,
      maxDomainSegments: 3,
    })
    .pattern(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)
    .max(254) // Max RFC email length
    .required()
    .trim()
    .lowercase()
    .messages({
      "string.email": "Please enter a valid email address",
      "string.max": "Email must be less than 254 characters",
      "string.pattern.base": "Please enter a valid email format",
    }),
  password: Joi.string()
    .min(8)
    .pattern(
      new RegExp(
        "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$"
      )
    )
    .required()
    .messages({
      "string.min": "Password must be at least 8 characters",
      "string.pattern.base":
        "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character",
    }),
  confirmPassword: Joi.string().valid(Joi.ref("password")).required().messages({
    "any.only": "Passwords must match",
    "any.required": "Password confirmation is required",
  }),
});

export const loginSchema = Joi.object({
  email: Joi.string()
    .email({
      tlds: {
        allow: ["com", "net"],
      },
      minDomainSegments: 2,
      maxDomainSegments: 3,
    })
    .pattern(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)
    .max(254) // Max RFC email length
    .required()
    .trim()
    .lowercase()
    .messages({
      "string.email": "Please enter a valid email address",
      "string.max": "Email must be less than 254 characters",
      "string.pattern.base": "Please enter a valid email format",
    }),
  password: Joi.string()
    .min(8)
    .pattern(
      new RegExp(
        "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$"
      )
    )
    .required()
    .messages({
      "string.min": "Password must be at least 8 characters",
      "string.pattern.base":
        "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character",
    }),
});

export const acceptedCodeSchema = Joi.object({
  email: Joi.string()
    .email({
      tlds: {
        allow: ["com", "net"],
      },
      minDomainSegments: 2,
      maxDomainSegments: 3,
    })
    .pattern(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)
    .max(254) // Max RFC email length
    .required()
    .trim()
    .lowercase()
    .messages({
      "string.email": "Please enter a valid email address",
      "string.max": "Email must be less than 254 characters",
      "string.pattern.base": "Please enter a valid email format",
    }),
  code: Joi.string().required(),
});

export const changePasswordSchema = Joi.object({
  oldPassword: Joi.string().required().messages({
    "any.required": "Old password is required",
  }),
  newPassword: Joi.string()
    .required()
    .disallow(Joi.ref("oldPassword"))
    .messages({
      "any.required": "New password is required",
      "any.invalid": "New password cannot be the same as old password",
    }),
  confirmPassword: Joi.string()
    .required()
    .valid(Joi.ref("newPassword"))
    .messages({
      "any.only": "Passwords must match",
      "any.required": "Password confirmation is required",
    }),
});
