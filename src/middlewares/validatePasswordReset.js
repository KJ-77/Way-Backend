import Joi from "joi";

// Schema for requesting password reset OTP
export const requestOtpSchema = Joi.object({
  email: Joi.string()
    .email({
      tlds: {
        allow: ["com", "net"],
      },
      minDomainSegments: 2,
      maxDomainSegments: 3,
    })
    .pattern(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)
    .max(254)
    .required()
    .trim()
    .lowercase()
    .messages({
      "string.email": "Please enter a valid email address",
      "string.max": "Email must be less than 254 characters",
      "string.pattern.base": "Please enter a valid email format",
    }),
});

// Schema for verifying OTP code
export const verifyOtpSchema = Joi.object({
  email: Joi.string()
    .email({
      tlds: {
        allow: ["com", "net"],
      },
      minDomainSegments: 2,
      maxDomainSegments: 3,
    })
    .pattern(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)
    .max(254)
    .required()
    .trim()
    .lowercase()
    .messages({
      "string.email": "Please enter a valid email address",
      "string.max": "Email must be less than 254 characters",
      "string.pattern.base": "Please enter a valid email format",
    }),
  code: Joi.string()
    .length(6)
    .pattern(/^[0-9]+$/)
    .required()
    .messages({
      "string.length": "Verification code must be 6 digits",
      "string.pattern.base": "Verification code must contain only numbers",
    }),
});

// Schema for setting new password using reset token
export const setNewPasswordSchema = Joi.object({
  resetToken: Joi.string().length(64).required().messages({
    "any.required": "Reset token is required",
    "string.length": "Invalid reset token",
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

// Middleware implementations for each schema
export const validateRequestOtp = (req, res, next) => {
  if (req.body.email) {
    req.body.email = req.body.email.trim().toLowerCase();
  }

  const { error, value } = requestOtpSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      status: 400,
      success: false,
      message: error.details[0].message,
      data: null,
    });
  }

  req.validatedData = value;
  next();
};

export const validateVerifyOtp = (req, res, next) => {
  if (req.body.email) {
    req.body.email = req.body.email.trim().toLowerCase();
  }

  const { error, value } = verifyOtpSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      status: 400,
      success: false,
      message: error.details[0].message,
      data: null,
    });
  }

  req.validatedData = value;
  next();
};

export const validateSetNewPassword = (req, res, next) => {
  const { error, value } = setNewPasswordSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      status: 400,
      success: false,
      message: error.details[0].message,
      data: null,
    });
  }

  req.validatedData = value;
  next();
};
