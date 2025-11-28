// backend/src/middlewares/validateVerificationCode.js
import { acceptedCodeSchema } from "../middlewares/Validators.js";

export const validateVerificationCode = (req, res, next) => {
  // Basic sanitization
  if (req.body.email) {
    req.body.email = req.body.email.trim().toLowerCase();
  }

  const { error, value } = acceptedCodeSchema.validate(req.body);
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
