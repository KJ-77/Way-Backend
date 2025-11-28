import User from "../../Modules/User.model.js";
import { comparePasswords, hashPassword } from "../../utils/hashing.js";
import jwt from "jsonwebtoken";

// Authenticate user for login
export const authenticateUser = async (credentials) => {
  const { email, password } = credentials;

  // Find user with necessary fields
  const user = await User.findOne({ email }).select(
    "+password +accountLocked +accountLockedUntil +failedLoginAttempts"
  );

  if (!user) {
    throw new Error("invalid_credentials");
  }

  // Check account lock status
  if (user.accountLocked) {
    if (user.accountLockedUntil && user.accountLockedUntil > new Date()) {
      const remainingTime = Math.ceil(
        (user.accountLockedUntil - new Date()) / (60 * 1000)
      );
      throw new Error(`account_locked:${remainingTime}`);
    } else {
      // Reset lock if expired
      user.accountLocked = false;
      user.failedLoginAttempts = 0;
      await user.save();
    }
  }

  // Verify password
  const isPasswordValid = await comparePasswords(password, user.password);

  if (!isPasswordValid) {
    // Handle failed login
    user.failedLoginAttempts += 1;

    if (user.failedLoginAttempts >= 5) {
      user.accountLocked = true;
      user.accountLockedUntil = new Date(Date.now() + 30 * 60 * 1000);
      await user.save();
      throw new Error("account_locked:30");
    }

    await user.save();
    throw new Error("invalid_credentials");
  }

  // Reset failed attempts on success
  user.failedLoginAttempts = 0;
  await user.save();

  // Generate token
  const token = jwt.sign(
    {
      userId: user._id,
      email: user.email,
      verified: user.verified,
    },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );

  // Return user and token
  return {
    user: {
      _id: user._id,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      email: user.email,
      verified: user.verified,
      createdAt: user.createdAt,
    },
    token,
  };
};

// Register new user
export const registerUser = async (userData) => {
  const { email, password, fullName, phoneNumber } = userData;

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new Error("user_exists");
  }

  // Hash password
  const hashedPassword = await hashPassword(password);

  // Create user
  const user = new User({
    fullName,
    phoneNumber,
    email,
    password: hashedPassword,
  });

  await user.save();

  // Generate token
  const token = jwt.sign(
    {
      userId: user._id,
      email: user.email,
      verified: user.verified,
    },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );

  // Return user and token
  return {
    user: {
      _id: user._id,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      email: user.email,
      verified: user.verified,
      createdAt: user.createdAt,
    },
    token,
  };
};
