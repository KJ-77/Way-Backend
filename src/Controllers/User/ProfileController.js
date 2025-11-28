import User from "../../Modules/User.model.js";

// Get user profile
export const getUserProfile = async (req, res) => {
  try {
    const userId = req.user._id;

    // Find user without password
    const user = await User.findById(userId).select("-password");

    if (!user) {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "User not found",
        data: null,
      });
    }

    res.status(200).json({
      status: 200,
      success: true,
      message: "Profile retrieved successfully",
      data: user,
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while retrieving profile",
      data: null,
    });
  }
};

// Update user profile
export const updateUserProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const { fullName, phoneNumber, email } = req.body;

    // Check if email is being changed and if it's already taken
    if (email) {
      const existingUser = await User.findOne({
        email,
        _id: { $ne: userId },
      });

      if (existingUser) {
        return res.status(409).json({
          status: 409,
          success: false,
          message: "Email already in use",
          data: null,
        });
      }
    }

    // Update user data
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        fullName: fullName || req.user.fullName,
        phoneNumber: phoneNumber || req.user.phoneNumber,
        email: email || req.user.email,
        // If email changed, require verification again
        verified: email && email !== req.user.email ? false : req.user.verified,
      },
      { new: true, runValidators: true }
    ).select("-password");

    if (!updatedUser) {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "User not found",
        data: null,
      });
    }

    // If email was changed, send verification email
    if (email && email !== req.user.email) {
      // Import here to avoid circular dependency
      const { sendVerificationEmail } = await import(
        "../../Services/crud/VerificationService.js"
      );
      await sendVerificationEmail(email, updatedUser.fullName);
    }

    res.status(200).json({
      status: 200,
      success: true,
      message:
        email && email !== req.user.email
          ? "Profile updated successfully. Please verify your new email address."
          : "Profile updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    console.error("Update profile error:", error);

    if (error.name === "ValidationError") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: Object.values(error.errors)
          .map((err) => err.message)
          .join(", "),
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while updating profile",
      data: null,
    });
  }
};
