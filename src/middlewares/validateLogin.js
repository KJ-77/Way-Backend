import { loginSchema } from "./Validators.js";

export const validateLogin = (req, res, next) => {
  // Basic sanitization
  if (req.body.email) {
    req.body.email = req.body.email.trim().toLowerCase();
  }

  const { error, value } = loginSchema.validate(req.body);
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
