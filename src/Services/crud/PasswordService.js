import User from "../../Modules/User.model.js";
import {
  hashPassword,
  comparePasswords,
  hmacProcess,
} from "../../utils/hashing.js";
import transporter from "../../middlewares/SendMail.js";
import crypto from "crypto";

// Change Password Service
export const validatePasswordChange = async (
  userId,
  oldPassword,
  newPassword,
  confirmPassword
) => {
  try {
    // Explicit check for confirmPassword
    if (newPassword !== confirmPassword) {
      throw new Error("passwords_do_not_match");
    }

    // Find the user
    const user = await User.findById(userId).select("+password");
    if (!user) {
      throw new Error("user_not_found");
    }

    // Check if old password is correct
    const isPasswordValid = await comparePasswords(oldPassword, user.password);
    if (!isPasswordValid) {
      throw new Error("invalid_password");
    }

    // Check if new password is same as old password
    const isSamePassword = await comparePasswords(newPassword, user.password);
    if (isSamePassword) {
      throw new Error("same_as_old");
    }

    // Hash the new password
    const hashedPassword = await hashPassword(newPassword);

    // Update user's password
    user.password = hashedPassword;
    await user.save();

    return true;
  } catch (error) {
    console.error("Service error:", error.message);
    throw error; // Re-throw to controller
  }
};

// Generate OTP for password reset
export const generatePasswordResetOTP = async (email) => {
  // Find user
  const user = await User.findOne({ email });
  if (!user) {
    // Log for monitoring but don't expose to prevent user enumeration
    console.log(`Password reset requested for non-existent email: ${email}`);
    return false;
  }

  // Generate 6-digit code
  const resetCode = Math.floor(100000 + Math.random() * 900000).toString();

  // Store hashed code in user record
  const resetCodeHmac = hmacProcess(resetCode, process.env.HMAC_SECRET);
  user.forgotPasswordCode = resetCodeHmac;
  user.forgotPasswordCodeValidation = Date.now() + 5 * 60 * 1000; // 5 minutes expiry
  await user.save();

  // Send email with code
  await transporter.sendMail({
    from: process.env.SENDER_EMAIL,
    to: user.email,
    subject: "Password Reset Code",
    text: `Your password reset code is: ${resetCode}\nThis code will expire in 5 minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
        <h2>Password Reset Code</h2>
        <p>You requested a password reset. Please use the following code to verify your identity:</p>
        <div style="background-color: #f4f4f4; padding: 10px; text-align: center; font-size: 24px; letter-spacing: 5px; font-weight: bold; margin: 20px 0;">
          ${resetCode}
        </div>
        <p>This code will expire in 5 minutes.</p>
        <p>If you didn't request this code, you can safely ignore this email.</p>
      </div>
    `,
  });

  return true;
};

// Verify OTP code
export const verifyPasswordResetOTP = async (email, code) => {
  const user = await User.findOne({ email }).select(
    "+forgotPasswordCode +forgotPasswordCodeValidation"
  );

  if (!user) {
    throw new Error("user_not_found");
  }

  if (!user.forgotPasswordCode || !user.forgotPasswordCodeValidation) {
    throw new Error("no_code_found");
  }

  // Check if code is expired
  if (Date.now() > user.forgotPasswordCodeValidation) {
    throw new Error("code_expired");
  }

  // Verify code
  const codeHmac = hmacProcess(code.toString(), process.env.HMAC_SECRET);
  if (codeHmac !== user.forgotPasswordCode) {
    throw new Error("invalid_code");
  }

  // Code is valid - we don't clear it yet because it'll be used again
  // for the actual password reset
  return true;
};

// Reset password with OTP
export const resetPasswordWithOTP = async (email, code, newPassword) => {
  // Verify the code again (double check for security)
  await verifyPasswordResetOTP(email, code);

  // Get the user
  const user = await User.findOne({ email });

  // Hash the new password
  const hashedPassword = await hashPassword(newPassword);

  // Update password and clear reset code
  user.password = hashedPassword;
  user.forgotPasswordCode = undefined;
  user.forgotPasswordCodeValidation = undefined;
  await user.save();

  return true;
};

// Request password reset service
export const requestPasswordResetService = async (email) => {
  try {
    // Find the user
    const user = await User.findOne({ email });
    if (!user) {
      throw new Error("user_not_found");
    }

    // Generate a random 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Set expiration time (30 minutes)
    const expirationTime = Date.now() + 30 * 60 * 1000;

    // Save the code to the user document
    user.resetPasswordCode = code;
    user.resetPasswordExpires = expirationTime;
    await user.save({ validateBeforeSave: false });

    // Send the code via email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Password Reset Code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Reset Your Password</h2>
          <p>You have requested to reset your password. Please use the following code to verify your identity:</p>
          <div style="background-color: #f4f4f4; padding: 10px; text-align: center; font-size: 24px; letter-spacing: 5px; font-weight: bold;">
            ${code}
          </div>
          <p>This code will expire in 30 minutes.</p>
          <p>If you did not request this, please ignore this email and your password will remain unchanged.</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("Password reset request error:", error);
    throw error;
  }
};

// Verify reset code service
export const verifyResetCodeService = async (email, code) => {
  try {
    // Find the user
    const user = await User.findOne({
      email,
      resetPasswordCode: code,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      throw new Error("invalid_code");
    }

    // Generate a reset token
    const resetToken = crypto.randomBytes(32).toString("hex");

    // Store the hashed token with secret
    user.resetPasswordToken = hmacProcess(resetToken, process.env.HMAC_SECRET);
    user.resetPasswordExpires = Date.now() + 15 * 60 * 1000; // 15 minutes

    // Clear the code (it's been used)
    user.resetPasswordCode = undefined;

    await user.save({ validateBeforeSave: false });

    return resetToken;
  } catch (error) {
    console.error("Verify reset code error:", error);
    throw error;
  }
};

// Reset password service
export const resetPasswordService = async (
  resetToken,
  password,
  confirmPassword
) => {
  try {
    if (password !== confirmPassword) {
      throw new Error("passwords_do_not_match");
    }

    // Find user with valid token
    const hashedToken = hmacProcess(resetToken, process.env.HMAC_SECRET);
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      throw new Error("token_invalid");
    }

    // Update password
    user.password = await hashPassword(password);

    // Clear reset fields
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();

    return true;
  } catch (error) {
    console.error("Reset password error:", error);
    throw error;
  }
};
