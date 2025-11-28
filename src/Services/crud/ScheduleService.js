import Schedule from "../../Modules/Schedule.model.js";
import generateSlug from "../../utils/generateSlug.js";
import path from "path";
import fs from "fs";
import mongoose from "mongoose";
import transporter from "../../middlewares/SendMail.js";

// Debug function to dump object details safely
const debugObject = (obj) => {
  try {
    return JSON.stringify(
      obj,
      (key, value) => {
        if (key === "path" || key === "originalname" || key === "filename")
          return value;
        if (typeof value === "object" && value !== null) {
          return Object.keys(value).length ? value : "[Object]";
        }
        return value;
      },
      2
    );
  } catch (e) {
    return `[Error serializing object: ${e.message}]`;
  }
};

// Helper function to sanitize schedule images
const sanitizeScheduleImages = async (schedule) => {
  if (!schedule) return null;

  // Check if images array has undefined values
  if (schedule.images && Array.isArray(schedule.images)) {
    // Check if any invalid images exist
    const hasInvalidImages = schedule.images.some(
      (image) => !image || typeof image !== "string"
    );

    if (hasInvalidImages) {
      console.log(
        `Found schedule with invalid images: ${schedule._id}, slug: ${schedule.slug}`
      );

      // Filter out invalid images
      const validImages = schedule.images.filter(
        (image) => image && typeof image === "string"
      );
      console.log(
        `Sanitizing images array: before=${schedule.images.length}, after=${validImages.length}`
      );

      // Update the schedule in the database
      await Schedule.updateOne(
        { _id: schedule._id },
        { $set: { images: validImages } }
      );

      // Return a schedule with sanitized images
      return {
        ...(schedule._doc || schedule),
        images: validImages,
      };
    }
  }

  return schedule;
};

// Create a new schedule
export const createSchedule = async (scheduleData, files) => {
  try {
    // Generate slug from text
    const slug = generateSlug(scheduleData.text);

    // Check if slug already exists
    const existingSchedule = await Schedule.findOne({ slug });
    if (existingSchedule) {
      throw new Error("schedule_slug_exists");
    }

    // Process uploaded images
    const imagePaths = [];
    if (files && files.length > 0) {
      files.forEach((file) => {
        try {
          // Ensure the file.path exists
          if (!file || !file.path) {
            console.error("Invalid file object:", file);
            return;
          }

          let relativePath;
          // Handle both path formats - with or without "backend" in the path
          if (file.path.includes("backend")) {
            relativePath = path
              .relative(path.join(process.cwd(), "backend"), file.path)
              .replace(/\\/g, "/");
          } else {
            // If the path doesn't include "backend", extract just the filename
            relativePath = file.path.split("uploads/")[1];
          }

          if (relativePath) {
            imagePaths.push(`/uploads/${relativePath}`);
          } else {
            console.error("Unable to process file path:", file.path);
          }
        } catch (pathError) {
          console.error("Error processing file path:", pathError);
        }
      });
    }

    // Parse sessions (may arrive as JSON string via multipart form)
    let sessions = [];
    if (scheduleData.sessions) {
      sessions = Array.isArray(scheduleData.sessions)
        ? scheduleData.sessions
        : (() => {
            try {
              return JSON.parse(scheduleData.sessions);
            } catch (e) {
              return [];
            }
          })();
    }

    // Basic validation for sessions
    if (!sessions || sessions.length === 0) {
      throw new Error("sessions_required");
    }

    // Normalize sessions shape { startDate, endDate, time, capacity, tutor }
    const normalizedSessions = sessions.map((s) => ({
      startDate: s.startDate ? new Date(s.startDate) : null,
      endDate: s.endDate ? new Date(s.endDate) : null,
      time: typeof s.time === "string" ? s.time.trim() : "",
      period: typeof s.period === "string" ? s.period.trim() : "2hours", // Default to "2hours" if not provided
      capacity: parseInt(s.capacity, 10),
      tutor: s.tutor,
    }));

    // Create schedule document
    const schedule = new Schedule({
      title: scheduleData.title,
      text: scheduleData.text,
      price: scheduleData.price !== undefined ? scheduleData.price : 0,
      status: scheduleData.status || 'draft',
      images: imagePaths,
      sessions: normalizedSessions,
      slug: slug,
    });

    await schedule.save();
    return schedule;
  } catch (error) {
    // Clean up uploaded files if schedule creation fails
    if (files && files.length > 0) {
      files.forEach((file) => {
        try {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        } catch (cleanupError) {
          console.error("Error cleaning up file:", cleanupError);
        }
      });
    }
    throw error;
  }
};

// Update schedule by slug
export const updateScheduleBySlug = async (slug, scheduleData, files) => {
  try {
    const existingSchedule = await Schedule.findOne({ slug });
    if (!existingSchedule) {
      throw new Error("schedule_not_found");
    }

    // Sanitize existing schedule if needed
    await sanitizeScheduleImages(existingSchedule);

    // Generate new slug if text changed
    let newSlug = slug;
    if (scheduleData.text && scheduleData.text !== existingSchedule.text) {
      newSlug = generateSlug(scheduleData.text);

      // Check if new slug already exists (and it's not the same document)
      const slugExists = await Schedule.findOne({
        slug: newSlug,
        _id: { $ne: existingSchedule._id },
      });
      if (slugExists) {
        throw new Error("schedule_slug_exists");
      }
    }

    // Process new uploaded images
    const imagePaths = [];

    // Debug output for troubleshooting
    console.log(
      "Files received for processing:",
      files ? `${files.length} files` : "no files",
      files ? debugObject(files) : ""
    );

    if (files && files.length > 0) {
      // Delete old images
      console.log(
        "Existing schedule images:",
        existingSchedule.images ? existingSchedule.images.join(", ") : "none"
      );

      if (existingSchedule.images && existingSchedule.images.length > 0) {
        existingSchedule.images.forEach((imagePath) => {
          try {
            if (!imagePath) {
              console.warn("Found undefined image path in database");
              return;
            }

            const fullPath = path.join(process.cwd(), "backend", imagePath);
            console.log("Attempting to delete image at:", fullPath);

            if (fs.existsSync(fullPath)) {
              fs.unlinkSync(fullPath);
              console.log("Successfully deleted image");
            } else {
              console.warn("Image file doesn't exist:", fullPath);
            }
          } catch (error) {
            console.error("Error deleting old image:", error);
          }
        });
      }

      // Add new images
      files.forEach((file) => {
        try {
          // Ensure the file.path exists
          if (!file || !file.path) {
            console.error("Invalid file object:", file);
            return;
          }

          console.log("Processing file path:", file.path);

          let relativePath;
          // Handle both path formats - with or without "backend" in the path
          if (file.path.includes("backend")) {
            relativePath = path
              .relative(path.join(process.cwd(), "backend"), file.path)
              .replace(/\\/g, "/");
            console.log("Path with 'backend', relativePath:", relativePath);
          } else if (file.path.includes("uploads/")) {
            // If the path contains "uploads/", extract everything after that
            relativePath = file.path.split("uploads/")[1];
            console.log("Path with 'uploads/', relativePath:", relativePath);
          } else {
            // For paths that don't match expected patterns, use the filename
            const filename = file.originalname || path.basename(file.path);
            relativePath = filename;
            console.log(
              "Using filename as fallback, relativePath:",
              relativePath
            );
          }

          if (relativePath) {
            // Make sure the path starts with /uploads/
            const imagePath = relativePath.startsWith("/uploads/")
              ? relativePath
              : `/uploads/${relativePath}`;

            console.log("Final image path to store:", imagePath);
            imagePaths.push(imagePath);
          } else {
            console.error("Unable to process file path:", file.path);
          }
        } catch (pathError) {
          console.error("Error processing file path:", pathError);
        }
      });
    } else if (existingSchedule.images && existingSchedule.images.length > 0) {
      // Keep existing images if no new images uploaded
      imagePaths.push(...existingSchedule.images);
    }

    // Prepare update data
    const updateData = {
      title: scheduleData.title || existingSchedule.title,
      text: scheduleData.text || existingSchedule.text,
      images: imagePaths,
      slug: newSlug,
    };

    // Update price if provided
    if (scheduleData.price !== undefined) {
      updateData.price = scheduleData.price;
    }

    // Update status if provided
    if (scheduleData.status !== undefined) {
      updateData.status = scheduleData.status;
    }

    // Update sessions if provided
    if (scheduleData.sessions !== undefined) {
      let sessions = Array.isArray(scheduleData.sessions)
        ? scheduleData.sessions
        : (() => {
            try {
              return JSON.parse(scheduleData.sessions);
            } catch (e) {
              return [];
            }
          })();

      const normalizedSessions = sessions.map((s) => ({
        _id: s._id, // allow existing session ids to persist if passed
        startDate: s.startDate ? new Date(s.startDate) : null,
        endDate: s.endDate ? new Date(s.endDate) : null,
        time: typeof s.time === "string" ? s.time.trim() : "",
        period: typeof s.period === "string" ? s.period.trim() : "2hours", // Default to "2hours" if not provided
        capacity: parseInt(s.capacity, 10),
        tutor: s.tutor,
      }));

      updateData.sessions = normalizedSessions;
    }

    // Update schedule
    const updatedSchedule = await Schedule.findOneAndUpdate(
      { slug },
      updateData,
      { new: true, runValidators: true }
    );

    return updatedSchedule;
  } catch (error) {
    // Clean up uploaded files if update fails
    if (files && files.length > 0) {
      files.forEach((file) => {
        try {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        } catch (cleanupError) {
          console.error("Error cleaning up file:", cleanupError);
        }
      });
    }
    throw error;
  }
};

// Delete schedule by slug
export const deleteScheduleBySlug = async (slug, forceDelete = false) => {
  try {
    const schedule = await Schedule.findOne({ slug });
    if (!schedule) {
      throw new Error("schedule_not_found");
    }

    // Import ScheduleRegistration model
    const ScheduleRegistration = mongoose.model("ScheduleRegistration");

    // Check if there are any registrations for this schedule
    const registrationCount = await ScheduleRegistration.countDocuments({
      scheduleId: schedule._id,
    });

    if (registrationCount > 0 && !forceDelete) {
      throw new Error("schedule_has_registrations");
    }

    // If force delete and has registrations, send email notifications
    if (registrationCount > 0 && forceDelete) {
      // Get all registrations with user details
      const registrations = await ScheduleRegistration.find({
        scheduleId: schedule._id,
      }).populate("userId", "fullName email");

      // Send cancellation emails to all registered users
      await sendScheduleCancellationEmails(schedule, registrations);

      // Delete all registrations
      await ScheduleRegistration.deleteMany({ scheduleId: schedule._id });
    }

    // Delete associated images
    if (schedule.images && schedule.images.length > 0) {
      schedule.images.forEach((imagePath) => {
        try {
          const fullPath = path.join(process.cwd(), "backend", imagePath);
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
          }
        } catch (error) {
          console.error("Error deleting image:", error);
        }
      });
    }

    // Delete schedule document
    await Schedule.findOneAndDelete({ slug });
    return { deleted: true, notifiedUsers: registrationCount };
  } catch (error) {
    throw error;
  }
};

// Get all schedules
export const getAllSchedules = async (options = {}) => {
  try {
    const { page = 1, limit = 10, sort = { createdAt: -1 }, includeAll = false } = options;
    const skip = (page - 1) * limit;

    // Only show published schedules for public API, show all for admin
    const query = includeAll ? {} : { status: "published" };

    let schedules = await Schedule.find(query)
      .populate({ path: "sessions.tutor", select: "name email bio avatar" })
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean();

    // Backward-compatibility: add computed startAt to each session
    schedules = (schedules || []).map((sch) => ({
      ...sch,
      sessions: (sch.sessions || []).map((sess) => ({
        ...sess,
        startAt:
          sess && sess.startDate && sess.time
            ? new Date(
                `${new Date(sess.startDate).toISOString().split("T")[0]}T${
                  sess.time
                }:00.000Z`
              )
            : sess.startAt || null,
      })),
    }));

    const total = await Schedule.countDocuments({});

    return {
      schedules,
      pagination: {
        current: page,
        total: Math.ceil(total / limit),
        count: schedules.length,
        totalDocuments: total,
      },
    };
  } catch (error) {
    throw error;
  }
};

// Get schedule by slug
export const getScheduleBySlug = async (slug) => {
  try {
    const scheduleDoc = await Schedule.findOne({ slug })
      .populate({ path: "sessions.tutor", select: "name email bio avatar" })
      .lean();

    if (!scheduleDoc) {
      throw new Error("schedule_not_found");
    }

    // Backward-compatibility: add computed startAt to each session
    const schedule = {
      ...scheduleDoc,
      sessions: (scheduleDoc.sessions || []).map((sess) => ({
        ...sess,
        startAt:
          sess && sess.startDate && sess.time
            ? new Date(
                `${new Date(sess.startDate).toISOString().split("T")[0]}T${
                  sess.time
                }:00.000Z`
              )
            : sess.startAt || null,
      })),
    };

    // Sanitize schedule images if needed
    const sanitizedSchedule = await sanitizeScheduleImages(schedule);
    return sanitizedSchedule || schedule;
  } catch (error) {
    throw error;
  }
};

// Get schedule by ID
export const getScheduleById = async (scheduleId) => {
  try {
    // Validate if the ID is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(scheduleId)) {
      throw new Error("invalid_schedule_id");
    }

    const scheduleDoc = await Schedule.findById(scheduleId)
      .populate({ path: "sessions.tutor", select: "name email bio avatar" })
      .lean();

    if (!scheduleDoc) {
      throw new Error("schedule_not_found");
    }

    // Backward-compatibility: add computed startAt to each session
    const schedule = {
      ...scheduleDoc,
      sessions: (scheduleDoc.sessions || []).map((sess) => ({
        ...sess,
        startAt:
          sess && sess.startDate && sess.time
            ? new Date(
                `${new Date(sess.startDate).toISOString().split("T")[0]}T${
                  sess.time
                }:00.000Z`
              )
            : sess.startAt || null,
      })),
    };

    // Sanitize schedule images if needed
    const sanitizedSchedule = await sanitizeScheduleImages(schedule);
    return sanitizedSchedule || schedule;
  } catch (error) {
    throw error;
  }
};

// Sanitize all existing schedules with invalid images
// Send schedule cancellation emails to all registered users
const sendScheduleCancellationEmails = async (schedule, registrations) => {
  try {
    const emailPromises = registrations.map(async (registration) => {
      if (!registration.userId || !registration.userId.email) {
        console.warn(`No email for registration ${registration._id}`);
        return;
      }

      const emailContent = `
        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e3e3e3; border-radius: 8px;">
          <div style="text-align: center; background: #dc3545; color: white; padding: 30px; border-radius: 8px 8px 0 0; margin: -20px -20px 30px -20px;">
            <h1 style="margin: 0; font-size: 28px;">⚠️ Schedule Cancelled</h1>
          </div>

          <div style="padding: 0 10px;">
            <p style="font-size: 18px; color: #333;">Dear <strong>${registration.userId.fullName}</strong>,</p>

            <p style="font-size: 16px; line-height: 1.6; color: #444;">
              We regret to inform you that the following schedule has been cancelled:
            </p>

            <div style="background-color: #f8d7da; border-left: 4px solid #dc3545; padding: 15px; margin: 20px 0; border-radius: 5px;">
              <p style="margin-top: 0; font-size: 18px;"><strong>${schedule.title}</strong></p>
              <p style="margin: 5px 0; color: #721c24;">This schedule is no longer available.</p>
            </div>

            <p style="font-size: 16px; line-height: 1.6; color: #444;">
              We apologize for any inconvenience this may cause. If you have any questions or need assistance, please don't hesitate to contact us.
            </p>

            <p style="font-size: 16px; color: #333; margin-top: 30px;">
              Best regards,<br>
              <strong>Way Team</strong>
            </p>
          </div>
        </div>
      `;

      const textContent = `Dear ${registration.userId.fullName},

We regret to inform you that the following schedule has been cancelled:

${schedule.title}

This schedule is no longer available.

We apologize for any inconvenience this may cause. If you have any questions or need assistance, please don't hesitate to contact us.

Best regards,
Way Team`;

      await transporter.sendMail({
        from: process.env.SENDER_EMAIL,
        to: registration.userId.email,
        subject: `Schedule Cancelled: ${schedule.title}`,
        text: textContent,
        html: emailContent,
      });

      console.log(`Cancellation email sent to ${registration.userId.email}`);
    });

    await Promise.all(emailPromises);
    console.log(`Sent cancellation emails to ${registrations.length} users`);
  } catch (error) {
    console.error("Error sending cancellation emails:", error);
    throw error;
  }
};

export const sanitizeAllScheduleImages = async () => {
  try {
    console.log("Starting to sanitize all schedules...");
    const schedules = await Schedule.find({});
    let sanitizedCount = 0;

    for (const schedule of schedules) {
      const originalImageCount = schedule.images ? schedule.images.length : 0;

      if (schedule.images && Array.isArray(schedule.images)) {
        // Filter out invalid images
        const validImages = schedule.images.filter(
          (img) => img && typeof img === "string"
        );

        if (validImages.length !== originalImageCount) {
          // Update the schedule if we filtered out any images
          await Schedule.updateOne(
            { _id: schedule._id },
            { $set: { images: validImages } }
          );
          sanitizedCount++;
          console.log(
            `Sanitized schedule ${schedule._id}, removed ${
              originalImageCount - validImages.length
            } invalid images`
          );
        }
      }
    }

    console.log(`Sanitization complete. Fixed ${sanitizedCount} schedules.`);
    return sanitizedCount;
  } catch (error) {
    console.error("Error sanitizing schedules:", error);
    throw error;
  }
};
