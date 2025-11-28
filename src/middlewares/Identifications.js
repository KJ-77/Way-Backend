import jwt from "jsonwebtoken";
import mongoose from "mongoose";

export const Identifier = async (req, res, next) => {
  let token;

  // Check for token in Authorization header first
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  }
  // Then check cookies as fallback
  else if (req.cookies && req.cookies["authorization"]) {
    const cookieToken = req.cookies["authorization"];
    if (cookieToken.startsWith("Bearer ")) {
      token = cookieToken.split(" ")[1];
    } else {
      token = cookieToken; // In case it's not prefixed
    }
  }

  if (!token) {
    return res.status(401).json({
      status: 401,
      success: false,
      message: "Authentication token is required",
    });
  }

  try {
    const jwtVerified = jwt.verify(token, process.env.JWT_SECRET);
    if (!jwtVerified) {
      return res.status(401).json({
        status: 401,
        success: false,
        message: "Invalid authentication token",
      });
    } else {
      // Normalize user ID field to ensure consistent access
      const userId = jwtVerified.userId || jwtVerified.id || jwtVerified._id;

      req.user = {
        ...jwtVerified,
        _id: userId,
        id: userId,
        userId: userId,
      };

      next();
    }
  } catch (error) {
    console.log(error);
    return res.status(401).json({
      status: 401,
      success: false,
      message: "Invalid or expired token",
    });
  }
};

// Optional identifier middleware - allow unauthenticated access
export const OptionalIdentifier = async (req, res, next) => {
  let token;

  // Check for token in Authorization header first
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  }
  // Then check cookies as fallback
  else if (req.cookies && req.cookies["authorization"]) {
    const cookieToken = req.cookies["authorization"];
    if (cookieToken.startsWith("Bearer ")) {
      token = cookieToken.split(" ")[1];
    } else {
      token = cookieToken; // In case it's not prefixed
    }
  }

  // If no token, continue without authentication
  if (!token) {
    req.user = null; // Explicitly set user to null
    return next();
  }

  try {
    const jwtVerified = jwt.verify(token, process.env.JWT_SECRET);
    if (!jwtVerified) {
      // Invalid token, but continue without authentication
      req.user = null;
    } else {
      // Valid token, set user
      const userId = jwtVerified.userId || jwtVerified.id || jwtVerified._id;

      // Attempt to get the full user with purchases from database
      const User = mongoose.model("User");
      try {
        // Include all purchase data in the lookup
        const user = await User.findById(userId)
          .select("+purchasedItems") // Explicitly select purchasedItems in case it's not included by default
          .populate({
            path: "purchasedItems.courses.courseId",
            select: "_id title slug",
          })
          .populate({
            path: "purchasedItems.books",
            select: "_id title slug",
          });

        if (user) {
          console.log(
            `Optional auth: Found user ${userId} with purchases:`,
            user.purchasedItems
              ? {
                  courses: user.purchasedItems.courses?.length || 0,
                  books: user.purchasedItems.books?.length || 0,
                }
              : "none"
          );
          req.user = user;
        } else {
          // If user not found in DB, use token data
          req.user = {
            ...jwtVerified,
            _id: userId,
            id: userId,
            userId: userId,
          };
        }
      } catch (dbError) {
        console.log("Error fetching user from database:", dbError);
        // Use token data if DB lookup fails
        req.user = {
          ...jwtVerified,
          _id: userId,
          id: userId,
          userId: userId,
        };
      }
    }
    next();
  } catch (error) {
    console.log(
      "Error verifying token (continuing as unauthenticated):",
      error
    );
    req.user = null;
    next();
  }
};
