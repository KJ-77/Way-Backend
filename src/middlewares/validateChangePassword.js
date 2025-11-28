import { changePasswordSchema } from "./Validators.js";

export const validateChangePassword = (req, res, next) => {
  try {
    const { error, value } = changePasswordSchema.validate(req.body);
    if (error) {
      // Log within the middleware function where req is defined
      console.log("Validation error:", error.details[0].message, {
        body: req.body, // This is fine inside the middleware function
      });

      return res.status(400).json({
        status: 400,
        success: false,
        message: error.details[0].message,
        data: null,
      });
    }

    req.validatedData = value;
    next();
  } catch (err) {
    console.error("Error in validation middleware:", err);
    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred during validation",
      data: null,
    });
  }
};
