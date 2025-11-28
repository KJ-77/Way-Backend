import {
  validatePasswordChange,
  requestPasswordResetService,
  verifyResetCodeService,
  resetPasswordService,
} from "../../Services/crud/PasswordService.js";

// Change password controller
export const changePassword = async (req, res) => {
  try {
    const userId = req.user._id;
    const { oldPassword, newPassword, confirmPassword } = req.body;

    await validatePasswordChange(
      userId,
      oldPassword,
      newPassword,
      confirmPassword
    );

    res.status(200).json({
      status: 200,
      success: true,
      message: "Password changed successfully",
      data: null,
    });
  } catch (error) {
    console.error("Change password error:", error);

    if (error.message === "user_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "User not found",
        data: null,
      });
    }

    if (error.message === "invalid_password") {
      return res.status(401).json({
        status: 401,
        success: false,
        message: "Current password is incorrect",
        data: null,
      });
    }

    if (error.message === "passwords_do_not_match") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "New password and confirmation do not match",
        data: null,
      });
    }

    if (error.message === "same_as_old") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "New password must be different from current password",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while changing password",
      data: null,
    });
  }
};

// Request password reset (send OTP)
export const requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.validatedData;

    await requestPasswordResetService(email);

    res.status(200).json({
      status: 200,
      success: true,
      message: "Password reset code sent to your email",
      data: null,
    });
  } catch (error) {
    console.error("Request password reset error:", error);

    if (error.message === "user_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "No account found with this email",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while sending reset code",
      data: null,
    });
  }
};

// Verify reset code
export const verifyResetCode = async (req, res) => {
  try {
    const { email, code } = req.validatedData;

    const resetToken = await verifyResetCodeService(email, code);

    res.status(200).json({
      status: 200,
      success: true,
      message: "Code verified successfully",
      data: {
        resetToken,
      },
    });
  } catch (error) {
    console.error("Verify reset code error:", error);

    if (error.message === "user_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "User not found",
        data: null,
      });
    }

    if (error.message === "invalid_code" || error.message === "code_expired") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Invalid or expired code",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while verifying code",
      data: null,
    });
  }
};

// Set new password after reset
export const setNewPassword = async (req, res) => {
  try {
    const { password, confirmPassword, resetToken } = req.validatedData;

    await resetPasswordService(resetToken, password, confirmPassword);

    res.status(200).json({
      status: 200,
      success: true,
      message: "Password has been reset successfully",
      data: null,
    });
  } catch (error) {
    console.error("Set new password error:", error);

    if (
      error.message === "token_invalid" ||
      error.message === "token_expired"
    ) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Invalid or expired reset token",
        data: null,
      });
    }

    if (error.message === "passwords_do_not_match") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Password and confirmation do not match",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while resetting password",
      data: null,
    });
  }
};
