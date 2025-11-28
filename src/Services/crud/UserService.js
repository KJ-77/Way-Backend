import User from "../../Modules/User.model.js";
import { hashPassword } from "../../utils/hashing.js";

export const createUser = async (userData) => {
  const { email, password, confirmPassword, fullName, phoneNumber } = userData;

  // Passwords should already be validated to match by Joi, but double-check
  if (password !== confirmPassword) {
    throw new Error("Passwords do not match");
  }

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new Error("User already exists");
  }

  const hashedPassword = await hashPassword(password);

  const newUser = new User({
    fullName,
    phoneNumber,
    email,
    password: hashedPassword,
    passwordHistory: [hashedPassword],
    isPaid: false,
  });

  const result = await newUser.save();
  return result;
};

/**
 * Get users with pagination, filtering and sorting capabilities
 * @param {Object} options - Query options
 * @param {Number} options.page - Page number (defaults to 1)
 * @param {Number} options.limit - Items per page (defaults to 10)
 * @param {String} options.search - Search term for name, email or phone
 * @param {Boolean} options.isVerified - Filter by verification status
 * @param {Boolean} options.isPaid - Filter by payment status
 * @param {Boolean} options.hasItems - Filter by whether user has purchased items
 * @param {String} options.sortBy - Field to sort by (defaults to 'fullName')
 * @param {String} options.sortOrder - Sort order ('asc' or 'desc', defaults to 'asc')
 * @returns {Object} Object containing users array, pagination info and total count
 */
export const getUsers = async (options = {}) => {
  // Default options
  const page = options.page || 1;
  const limit = options.limit || 10;
  const search = options.search || "";
  const sortBy = options.sortBy || "fullName";
  const sortOrder = options.sortOrder || "asc";

  // Build query
  let query = {};

  // Apply filters if provided
  if (options.isVerified !== undefined) {
    query.verified = options.isVerified;
  }

  if (options.isPaid !== undefined) {
    query.isPaid = options.isPaid;
  }

  // Search by name, email or phone
  if (search) {
    query.$or = [
      { fullName: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { phoneNumber: { $regex: search, $options: "i" } },
    ];
  }

  // Filter by whether user has purchased items
  if (options.hasItems === true) {
    query.$or = [
      { "purchasedItems.books": { $exists: true, $ne: [] } },
      { "purchasedItems.courses": { $exists: true, $ne: [] } },
    ];
  } else if (options.hasItems === false) {
    query.$and = [
      { "purchasedItems.books": { $exists: true, $size: 0 } },
      { "purchasedItems.courses": { $exists: true, $size: 0 } },
    ];
  }

  // Calculate skip value for pagination
  const skip = (page - 1) * limit;

  // Prepare sort options
  const sortOptions = {};
  sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;

  // Execute query with pagination
  const users = await User.find(query)
    .sort(sortOptions)
    .skip(skip)
    .limit(limit)
    .select(
      "-password -failedLoginAttempts -accountLocked -accountLockedUntil -verificationCode -verificationCodeValidation -forgotPasswordCode -forgotPasswordCodeValidation"
    )
    .populate("purchasedItems.books", "title cover price pdf")
    .populate("purchasedItems.courses", "title thumbnail price");

  // Get total count for pagination
  const total = await User.countDocuments(query);

  // Calculate total pages
  const totalPages = Math.ceil(total / limit);

  return {
    users,
    pagination: {
      page,
      limit,
      totalItems: total,
      totalPages,
    },
  };
};
