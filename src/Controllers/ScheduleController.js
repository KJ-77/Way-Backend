import {
  createSchedule,
  updateScheduleBySlug,
  deleteScheduleBySlug,
  getAllSchedules,
  getScheduleBySlug,
  getScheduleById,
} from "../Services/crud/ScheduleService.js";
import ScheduleRegistration from "../Modules/ScheduleRegistration.model.js";
import mongoose from "mongoose";

// Create a new schedule
export const createScheduleController = async (req, res) => {
  try {
    const { title, text, price, status, sessions } = req.body;

    // Validate required fields
    if (!title || title.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Schedule title is required",
        data: null,
      });
    }

    if (!text || text.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Schedule text is required",
        data: null,
      });
    }

    // Create schedule with uploaded files
    const schedule = await createSchedule(
      {
        title: title.trim(),
        text: text.trim(),
        price: price !== undefined ? Number(price) : 0,
        status: status || 'draft',
        sessions,
      },
      req.files || []
    );

    // Ensure image paths are correctly returned
    if (schedule.images && Array.isArray(schedule.images)) {
      schedule.images = schedule.images
        .filter((image) => image && typeof image === "string") // Filter out undefined or non-string values
        .map((image) => {
          // Format image URL
          return `${req.protocol}://${req.get("host")}/${image.replace(
            /^\//,
            ""
          )}`;
        });

      console.log(
        "Image paths in createSchedule:",
        JSON.stringify(schedule.images)
      );
    } else {
      schedule.images = []; // Ensure images is always an array
    }

    res.status(201).json({
      status: 201,
      success: true,
      message: "Schedule created successfully",
      data: schedule,
    });
  } catch (error) {
    console.error("Create schedule error:", error);

    if (error.message === "schedule_slug_exists") {
      return res.status(409).json({
        status: 409,
        success: false,
        message: "A schedule with similar content already exists",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while creating the schedule",
      data: null,
    });
  }
};

// Get all schedules
export const getAllSchedulesController = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const sort = req.query.sort || "createdAt";
    const order = req.query.order === "asc" ? 1 : -1;

    // Check if request has admin authentication (for dashboard)
    const isAdmin = req.admin && req.admin.isAdmin;

    const options = {
      page,
      limit,
      sort: { [sort]: order },
      includeAll: isAdmin, // Show all schedules (including drafts) for admins
    };

    const result = await getAllSchedules(options);

    // Get enrollment counts for all schedules in a single aggregation
    const scheduleIds = result.schedules.map(
      (schedule) => new mongoose.Types.ObjectId(schedule._id)
    );

    // Compute paid counts per schedule (sum of sessions) for legacy isFull indicator
    const enrollmentCounts = await ScheduleRegistration.aggregate([
      {
        $match: {
          scheduleId: { $in: scheduleIds },
          paymentStatus: "paid",
        },
      },
      {
        $group: {
          _id: "$scheduleId",
          paid: { $sum: 1 },
        },
      },
    ]);

    // Create lookup map for faster access
    const enrollmentMap = {};
    enrollmentCounts.forEach((item) => {
      enrollmentMap[item._id.toString()] = item.paid;
    });

    // Ensure image paths are correctly returned for all schedules
    if (result.schedules && result.schedules.length > 0) {
      result.schedules = result.schedules.map((schedule) => {
        // Add enrollment data to each schedule
        const totalPaid = enrollmentMap[schedule._id.toString()] || 0;
        const totalCapacity = (schedule.sessions || []).reduce(
          (sum, s) => sum + (s.capacity || 0),
          0
        );
        const isFull = totalCapacity > 0 ? totalPaid >= totalCapacity : false;

        // Process images
        let processedImages = [];
        if (
          schedule.images &&
          Array.isArray(schedule.images) &&
          schedule.images.length > 0
        ) {
          processedImages = schedule.images
            .filter((image) => image && typeof image === "string")
            .map((image) => image.replace(/^\//, ""));
        }

        return {
          ...schedule,
          images: processedImages,
          enrolledStudents: totalPaid,
          isFull,
        };
      });
    }

    res.status(200).json({
      status: 200,
      success: true,
      message: "Schedules retrieved successfully",
      results: result.schedules.length,
      pagination: result.pagination,
      data: result.schedules,
    });
  } catch (error) {
    console.error("Get all schedules error:", error);

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while retrieving schedules",
      data: null,
    });
  }
};

// Get schedule by slug
export const getScheduleBySlugController = async (req, res) => {
  try {
    const { slug } = req.params;

    if (!slug) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Schedule slug is required",
        data: null,
      });
    }

    const schedule = await getScheduleBySlug(slug);

    // Get enrollment data for this specific schedule (sum across sessions)
    const enrolledStudents = await ScheduleRegistration.countDocuments({
      scheduleId: schedule._id,
      paymentStatus: "paid",
    });
    const totalCapacity = (schedule.sessions || []).reduce(
      (sum, s) => sum + (s.capacity || 0),
      0
    );
    const isFull =
      totalCapacity > 0 ? enrolledStudents >= totalCapacity : false;

    // Ensure image paths are correctly returned
    let processedImages = [];
    if (schedule.images && Array.isArray(schedule.images)) {
      processedImages = schedule.images
        .filter((image) => image && typeof image === "string")
        .map((image) => image.replace(/^\//, ""));
    }

    // Add enrollment data to the schedule response
    const scheduleWithEnrollment = {
      ...schedule,
      images: processedImages,
      enrolledStudents,
      isFull,
    };

    res.status(200).json({
      status: 200,
      success: true,
      message: "Schedule retrieved successfully",
      data: scheduleWithEnrollment,
    });
  } catch (error) {
    console.error("Get schedule by slug error:", error);

    if (error.message === "schedule_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Schedule not found",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while retrieving the schedule",
      data: null,
    });
  }
};

// Get schedule by ID
export const getScheduleByIdController = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Schedule ID is required",
        data: null,
      });
    }

    const schedule = await getScheduleById(id);

    // Get enrollment data for this specific schedule
    const enrolledStudents = await ScheduleRegistration.countDocuments({
      scheduleId: schedule._id,
      paymentStatus: "paid", // Count only paid registrations as enrolled
    });

    const isFull = enrolledStudents >= schedule.studentCapacity;

    // Ensure image paths are correctly returned
    let processedImages = [];
    if (schedule.images && Array.isArray(schedule.images)) {
      processedImages = schedule.images
        .filter((image) => image && typeof image === "string")
        .map((image) => image.replace(/^\//, ""));
    }

    // Add enrollment data to the schedule response
    const scheduleWithEnrollment = {
      ...schedule,
      images: processedImages,
      enrolledStudents,
      isFull,
    };

    res.status(200).json({
      status: 200,
      success: true,
      message: "Schedule retrieved successfully",
      data: scheduleWithEnrollment,
    });
  } catch (error) {
    console.error("Get schedule by ID error:", error);

    if (error.message === "invalid_schedule_id") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Invalid schedule ID format",
        data: null,
      });
    }

    if (error.message === "schedule_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Schedule not found",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while retrieving the schedule",
      data: null,
    });
  }
};

// Update schedule by slug
export const updateScheduleBySlugController = async (req, res) => {
  try {
    const { slug } = req.params;
    const { title, text, price, status, sessions } = req.body;

    console.log("Update request for schedule with slug:", slug);
    console.log(
      "Files received:",
      req.files
        ? JSON.stringify(req.files.map((f) => f.originalname || f.name))
        : "none"
    );
    console.log("Request body:", JSON.stringify(req.body));

    // sessions are handled in service; ensure raw body retains it

    if (!slug) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Schedule slug is required",
        data: null,
      });
    }

    // Validate title if provided
    if (title && title.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Schedule title cannot be empty",
        data: null,
      });
    }

    // Validate text if provided
    if (text && text.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Schedule text cannot be empty",
        data: null,
      });
    }

    const updateData = {};
    if (title !== undefined) {
      updateData.title = title.trim();
    }
    if (text !== undefined) {
      updateData.text = text.trim();
    }
    if (price !== undefined) {
      updateData.price = Number(price);
    }
    if (status !== undefined) {
      updateData.status = status;
    }
    // no-op for classTime/studentCapacity/tutors (deprecated)
    if (sessions !== undefined) {
      updateData.sessions = sessions;
    }

    console.log("Update data prepared:", JSON.stringify(updateData));

    let updatedSchedule;
    try {
      // Add debug info about the files
      console.log("Files for update:", req.files ? "present" : "not present");
      if (req.files) {
        console.log("Number of files:", req.files.length);
        req.files.forEach((f, i) => {
          console.log(
            `File ${i}:`,
            f.originalname || f.name,
            f.path || "no path"
          );
        });
      }

      // Wrap in try-catch to get more specific error information
      updatedSchedule = await updateScheduleBySlug(
        slug,
        updateData,
        Array.isArray(req.files) ? req.files : []
      );

      console.log(
        "Service returned updated schedule:",
        updatedSchedule ? "success" : "null"
      );
    } catch (serviceError) {
      console.error("Service error details:", serviceError);
      console.error("Error stack:", serviceError.stack);

      // Determine if it's a known error or needs to be treated as a generic error
      if (
        serviceError.message === "schedule_not_found" ||
        serviceError.message === "schedule_slug_exists"
      ) {
        throw serviceError; // Re-throw known errors to be caught by the outer catch
      }

      // Return a 500 for service-specific errors
      return res.status(500).json({
        status: 500,
        success: false,
        message: "Error in schedule service: " + serviceError.message,
        error: serviceError.stack,
        data: null,
      });
    }

    // Safety check for the returned data
    if (!updatedSchedule) {
      return res.status(500).json({
        status: 500,
        success: false,
        message: "Schedule update failed - no data returned",
        data: null,
      });
    }

    // Ensure image paths are correctly returned in the update response
    if (updatedSchedule.images && Array.isArray(updatedSchedule.images)) {
      updatedSchedule.images = updatedSchedule.images
        .filter((image) => image) // Filter out any undefined, null or empty strings
        .map((image) => {
          // Handle both relative and absolute paths
          if (!image) {
            console.warn("Encountered empty image path");
            return null; // Will be filtered out below
          }
          if (typeof image !== "string") {
            console.warn("Non-string image path:", image);
            return null; // Will be filtered out below
          }
          if (image.startsWith("http")) {
            return image;
          }
          // Ensure the path is valid before adding the host
          return `${req.protocol}://${req.get("host")}/${image.replace(
            /^\//,
            ""
          )}`;
        })
        .filter((url) => url); // Filter out any nulls that were introduced
    } else {
      // Ensure images is always an array
      updatedSchedule.images = [];
    }

    // Add debugging for final image URLs
    console.log("Final image URLs:", JSON.stringify(updatedSchedule.images));

    res.status(200).json({
      status: 200,
      success: true,
      message: "Schedule updated successfully",
      data: updatedSchedule,
    });
  } catch (error) {
    console.error("Update schedule error:", error);
    console.error("Error stack:", error.stack);

    if (error.message === "schedule_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Schedule not found",
        data: null,
      });
    }

    if (error.message === "schedule_slug_exists") {
      return res.status(409).json({
        status: 409,
        success: false,
        message: "A schedule with similar content already exists",
        data: null,
      });
    }

    // More specific error message based on the error type
    const errorMessage =
      error.code === "LIMIT_FILE_SIZE"
        ? "One or more files exceed the size limit"
        : error.code === "LIMIT_FILE_COUNT"
        ? "Too many files uploaded"
        : "An error occurred while updating the schedule";

    res.status(500).json({
      status: 500,
      success: false,
      message: errorMessage,
      error: error.message,
      data: null,
    });
  }
};

// Delete schedule by slug
export const deleteScheduleBySlugController = async (req, res) => {
  try {
    const { slug } = req.params;
    const { forceDelete } = req.query;

    if (!slug) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Schedule slug is required",
        data: null,
      });
    }

    const result = await deleteScheduleBySlug(slug, forceDelete === "true");

    res.status(200).json({
      status: 200,
      success: true,
      message: result.notifiedUsers > 0
        ? `Schedule deleted successfully. ${result.notifiedUsers} users were notified.`
        : "Schedule deleted successfully",
      data: result,
    });
  } catch (error) {
    console.error("Delete schedule error:", error);

    if (error.message === "schedule_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Schedule not found",
        data: null,
      });
    }

    if (error.message === "schedule_has_registrations") {
      return res.status(400).json({
        status: 400,
        success: false,
        message:
          "Cannot delete schedule with existing registrations. Use forceDelete=true to override.",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while deleting the schedule",
      data: null,
    });
  }
};
