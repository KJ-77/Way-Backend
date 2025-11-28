import ScheduleRegistration from "../../Modules/ScheduleRegistration.model.js";
import Schedule from "../../Modules/Schedule.model.js";
import User from "../../Modules/User.model.js";
import AppError from "../../utils/appError.js";
import { sendEmail } from "../../utils/emailService.js";
import transporter from "../../middlewares/SendMail.js";
import mongoose from "mongoose";

export const createRegistration = async (userId, scheduleId, sessionId) => {
  // Check if user is verified
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError("User not found", 404);
  }

  if (!user.verified) {
    throw new AppError("User must be verified to register for a schedule", 403);
  }

  // Check if schedule and session exist
  const schedule = await Schedule.findById(scheduleId);
  if (!schedule) {
    throw new AppError("Schedule not found", 404);
  }
  const session = schedule.sessions.id(sessionId);
  if (!session) {
    throw new AppError("Session not found", 404);
  }

  // Check if session has already started
  const now = new Date();
  if (now >= new Date(session.startDate)) {
    throw new AppError("Cannot register for a session that has already started", 400);
  }

  // Check if the user is already registered FOR THIS SPECIFIC SESSION
  const existingRegistration = await ScheduleRegistration.findOne({
    userId,
    scheduleId,
    sessionId,
  });

  if (existingRegistration) {
    // Return a proper 409 Conflict status code
    throw new AppError(
      "You have already registered for this specific session",
      409
    );
  }

  // Debug logging to help track registration attempts
  console.log(
    `User ${userId} attempting to register for schedule ${scheduleId}, session ${sessionId}`
  );

  // Get all user's registrations for this schedule to log for debugging
  const userScheduleRegistrations = await ScheduleRegistration.find({
    userId,
    scheduleId,
  });

  // Just log the registrations for debugging - no blocking logic here
  if (userScheduleRegistrations.length > 0) {
    console.log(
      `User already has ${userScheduleRegistrations.length} registrations for this schedule (this is allowed):`
    );
    userScheduleRegistrations.forEach((reg) => {
      console.log(
        `- Session ID: ${reg.sessionId}, Status: ${reg.status}, Payment: ${reg.paymentStatus}`
      );
    });

    // Check if any existing registrations are for other sessions of this schedule
    const otherSessionRegistrations = userScheduleRegistrations.filter(
      (reg) => reg.sessionId.toString() !== sessionId
    );

    if (otherSessionRegistrations.length > 0) {
      console.log(
        `User is registering for a different session of the same schedule (${otherSessionRegistrations.length} other sessions registered)`
      );
    }
  }

  // Check if the session is at capacity based on PAID registrations
  const paidRegistrations = await ScheduleRegistration.countDocuments({
    scheduleId,
    sessionId,
    paymentStatus: "paid",
  });

  if (paidRegistrations >= session.capacity) {
    throw new AppError("This session is already at full capacity", 400);
  }

  // Create registration
  try {
    const registration = await ScheduleRegistration.create({
      userId,
      scheduleId,
      sessionId,
      status: "pending",
      paymentStatus: "unpaid",
    });

    return registration;
  } catch (error) {
    // Improved error handling for duplicate key and other MongoDB errors
    if (error.code === 11000) {
      // This is a duplicate key error
      console.log("Duplicate registration attempt:", {
        userId,
        scheduleId,
        sessionId,
      });
      console.log("Error details:", error);

      // Check if this is a unique constraint violation on the compound index
      if (error.keyPattern) {
        // Check which fields are in the duplicate key error
        const isUserIdDuplicate = error.keyPattern?.userId === 1;
        const isScheduleIdDuplicate = error.keyPattern?.scheduleId === 1;
        const isSessionIdDuplicate = error.keyPattern?.sessionId === 1;

        console.log("Duplicate key details:", {
          isUserIdDuplicate,
          isScheduleIdDuplicate,
          isSessionIdDuplicate,
        });

        // Only if all three fields are duplicated, it's a session-specific duplicate
        if (
          isUserIdDuplicate &&
          isScheduleIdDuplicate &&
          isSessionIdDuplicate
        ) {
          throw new AppError(
            "You have already registered for this specific session date (duplicate record detected)",
            409
          );
        } else if (
          isUserIdDuplicate &&
          isScheduleIdDuplicate &&
          !isSessionIdDuplicate
        ) {
          // Legacy unique index detected on {userId, scheduleId}. Attempt to drop it and retry once.
          try {
            const indexes = await ScheduleRegistration.collection.indexes();
            const legacy = indexes.find(
              (ix) =>
                ix.key &&
                ix.key.userId === 1 &&
                ix.key.scheduleId === 1 &&
                !ix.key.sessionId
            );
            if (legacy && legacy.name) {
              console.warn(
                `Dropping legacy unique index on {userId, scheduleId}: ${legacy.name}`
              );
              await ScheduleRegistration.collection.dropIndex(legacy.name);
              // Retry create once after dropping the legacy index
              const registrationRetry = await ScheduleRegistration.create({
                userId,
                scheduleId,
                sessionId,
                status: "pending",
                paymentStatus: "unpaid",
              });
              return registrationRetry;
            }
          } catch (idxErr) {
            console.error(
              "Failed to drop legacy index or retry create:",
              idxErr
            );
          }
          // Fallback: don't block multiple sessions per schedule
          throw new AppError(
            "Temporary database constraint encountered. Please try again in a moment.",
            500
          );
        } else {
          // Generic duplicate; treat as session-level duplicate for safety
          throw new AppError(
            "Duplicate registration detected for this session",
            409
          );
        }
      }
    }

    // Log the detailed error for debugging
    console.error("Error creating registration:", error);

    // Return a more specific error message if possible
    if (error.name === "ValidationError") {
      throw new AppError(`Validation error: ${error.message}`, 400);
    } else if (error.name === "MongoServerError") {
      throw new AppError(`Database error: ${error.message}`, 500);
    } else {
      throw new AppError(
        "Failed to create registration. Please try again later.",
        500
      );
    }
  }
};

export const getRegistrationsBySchedule = async (
  scheduleId,
  status = null,
  sessionId = null
) => {
  const query = { scheduleId };

  if (status) {
    query.status = status;
  }
  if (sessionId) {
    query.sessionId = sessionId;
  }

  const registrations = await ScheduleRegistration.find(query)
    .populate("userId", "fullName email phoneNumber")
    .populate("scheduleId", "title startDate endDate sessions")
    .sort({ createdAt: -1 });

  return registrations;
};

export const getAllRegistrations = async (
  page = 1,
  limit = 10,
  status = null
) => {
  const skip = (page - 1) * limit;
  const query = {};

  if (status) {
    query.status = status;
  }

  const [registrations, total] = await Promise.all([
    ScheduleRegistration.find(query)
      .populate("userId", "fullName email phoneNumber verified")
      .populate("scheduleId", "title startDate endDate sessions")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    ScheduleRegistration.countDocuments(query),
  ]);

  const totalPages = Math.ceil(total / limit);

  return { registrations, total, totalPages };
};

export const getRegistrationById = async (registrationId) => {
  if (!mongoose.Types.ObjectId.isValid(registrationId)) {
    throw new AppError("Invalid registration ID", 400);
  }

  const registration = await ScheduleRegistration.findById(registrationId)
    .populate("userId", "fullName email phoneNumber verified")
    .populate("scheduleId", "title startDate endDate sessions");

  if (!registration) {
    throw new AppError("Registration not found", 404);
  }

  return registration;
};

export const getRegistrationsByUser = async (userId) => {
  const registrations = await ScheduleRegistration.find({ userId })
    .populate("scheduleId", "title startDate endDate sessions images")
    .sort({ createdAt: -1 });

  return registrations;
};

export const updateRegistrationStatus = async (
  registrationId,
  status,
  notes = ""
) => {
  const registration = await ScheduleRegistration.findById(registrationId)
    .populate("userId", "fullName email")
    .populate("scheduleId", "title startDate endDate classTime");

  if (!registration) {
    throw new AppError("Registration not found", 404);
  }

  // If approving, check capacity based on paid registrations
  if (status === "approved") {
    const schedule = await Schedule.findById(registration.scheduleId);
    const paidCount = await ScheduleRegistration.countDocuments({
      scheduleId: registration.scheduleId,
      sessionId: registration.sessionId,
      paymentStatus: "paid",
    });

    // Allow approval even if paid count is at capacity, since approval doesn't consume a spot
    // Only payment completion consumes the actual spot
    // We might want to warn if there are many approved but unpaid registrations
  }

  registration.status = status;
  if (notes) {
    registration.notes = notes;
    // If rejecting, also store in rejectionReason field
    if (status === "rejected") {
      registration.rejectionReason = notes;
    }
  }

  await registration.save();

  // Send approval confirmation email if status is approved
  if (status === "approved") {
    try {
      await sendApprovalConfirmationEmail(registration);
    } catch (emailError) {
      console.error("Error sending approval confirmation email:", emailError);
      // Continue execution even if email fails
    }
  }

  return registration;
};

export const updatePaymentStatus = async (registrationId, paymentStatus) => {
  const registration = await ScheduleRegistration.findById(registrationId);

  if (!registration) {
    throw new AppError("Registration not found", 404);
  }

  // If marking as paid or free, check if there's still capacity available
  if ((paymentStatus === "paid" || paymentStatus === "free") &&
      registration.paymentStatus !== "paid" &&
      registration.paymentStatus !== "free") {
    const schedule = await Schedule.findById(registration.scheduleId);
    const session = schedule?.sessions.id(registration.sessionId);

    // Count both paid and free registrations for capacity
    const currentPaidCount = await ScheduleRegistration.countDocuments({
      scheduleId: registration.scheduleId,
      sessionId: registration.sessionId,
      paymentStatus: { $in: ["paid", "free"] },
    });

    if (!session) {
      throw new AppError("Session not found", 404);
    }

    if (currentPaidCount >= session.capacity) {
      throw new AppError(
        "Cannot mark as paid/free: session is at full capacity",
        400
      );
    }
  }

  registration.paymentStatus = paymentStatus;
  await registration.save();

  return registration;
};

export const sendPaymentLink = async (registrationId, paymentLink) => {
  const registration = await ScheduleRegistration.findById(registrationId)
    .populate("userId", "fullName email phoneNumber")
    .populate("scheduleId", "title");

  if (!registration) {
    throw new AppError("Registration not found", 404);
  }

  registration.paymentLink = paymentLink;
  registration.paymentSent = true;
  await registration.save();

  // Create email content with improved messaging
  const emailContent = `
    <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e3e3e3; border-radius: 8px;">
      <h2 style="color: #333; border-bottom: 1px solid #eee; padding-bottom: 10px;">Registration Update: Payment Required</h2>
      <p>Dear ${registration.userId.fullName},</p>
      <p><strong>Good news!</strong> Your registration request for <strong>${registration.scheduleId.title}</strong> has been approved.</p>
      <div style="background-color: #f8f9fa; border-left: 4px solid #17a2b8; padding: 15px; margin: 20px 0; border-radius: 5px;">
        <p style="margin-top: 0; font-size: 16px;"><strong>Your registration is waiting for payment</strong></p>
        <p>To secure your spot and join the class, please complete your payment using the link below:</p>
        <div style="text-align: center; margin: 15px 0;">
          <a href="${paymentLink}" style="display: inline-block; background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Complete Payment</a>
        </div>
      </div>
      <p>After completing your payment, please reply to this email to let us know so we can finalize your registration.</p>
      <p style="margin-top: 25px; padding-top: 15px; border-top: 1px solid #eee; color: #666;">If you have any questions or need assistance, please don't hesitate to contact us.</p>
      <p>Thank you!</p>
    </div>
  `;

  try {
    const mailResult = await transporter.sendMail({
      from: process.env.SENDER_EMAIL,
      to: registration.userId.email,
      subject: `Payment Required: Your ${registration.scheduleId.title} Registration`,
      text: `Dear ${registration.userId.fullName},\n\nGood news! Your registration request for ${registration.scheduleId.title} has been approved.\n\nYour registration is waiting for payment. Please pay using the following link to be able to join the class: ${paymentLink}\n\nAfter completing your payment, please let us know so we can finalize your registration.\n\nThank you!`,
      html: emailContent,
    });

    if (!mailResult) {
      throw new AppError("Failed to send payment link email", 500);
    }

    return registration;
  } catch (error) {
    console.error("Error sending payment link email:", error);
    throw new AppError(
      "Failed to send payment link email: " + error.message,
      500
    );
  }
};

export const checkScheduleCapacity = async (scheduleId) => {
  const schedule = await Schedule.findById(scheduleId);

  if (!schedule) {
    throw new AppError("Schedule not found", 404);
  }

  // Return capacity metrics per session
  const sessions = schedule.sessions || [];
  const results = await Promise.all(
    sessions.map(async (sess) => {
      const [approvedCount, pendingCount, paidCount] = await Promise.all([
        ScheduleRegistration.countDocuments({
          scheduleId,
          sessionId: sess._id,
          status: "approved",
        }),
        ScheduleRegistration.countDocuments({
          scheduleId,
          sessionId: sess._id,
          status: "pending",
        }),
        ScheduleRegistration.countDocuments({
          scheduleId,
          sessionId: sess._id,
          paymentStatus: "paid",
        }),
      ]);
      return {
        sessionId: String(sess._id),
        totalCapacity: sess.capacity,
        approved: approvedCount,
        pending: pendingCount,
        paid: paidCount,
        available: Math.max(0, sess.capacity - paidCount),
        isFull: paidCount >= sess.capacity,
        startAt: sess.startAt,
        tutor: sess.tutor,
      };
    })
  );

  return { sessions: results };
};

export const notifyAdmin = async (registrationId) => {
  const registration = await ScheduleRegistration.findById(registrationId)
    .populate("userId", "fullName email phoneNumber")
    .populate("scheduleId", "title");

  if (!registration) {
    throw new AppError("Registration not found", 404);
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const emailContent = `
    <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e3e3e3; border-radius: 8px;">
      <h2 style="color: #333; border-bottom: 1px solid #eee; padding-bottom: 10px;">New Schedule Registration Request</h2>
      <p>A new registration request has been submitted:</p>
      <div style="background-color: #f8f9fa; border-left: 4px solid #17a2b8; padding: 15px; margin: 20px 0; border-radius: 5px;">
        <p><strong>Schedule:</strong> ${registration.scheduleId.title}</p>
        <p><strong>User:</strong> ${registration.userId.fullName} (${
    registration.userId.email
  })</p>
        <p><strong>Phone:</strong> ${
          registration.userId.phoneNumber || "Not provided"
        }</p>
        <p><strong>Status:</strong> Pending Review</p>
      </div>
      <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 5px;">
        <p style="margin-top: 0;"><strong>Action Required:</strong></p>
        <p>1. Review this request in the admin dashboard</p>
        <p>2. If approved, send a payment link to the user</p>
        <p>3. The user will be notified that payment is required to join the class</p>
      </div>
      <p style="margin-top: 20px;">Login to the dashboard to manage this request.</p>
    </div>
  `;

  try {
    const mailResult = await transporter.sendMail({
      from: process.env.SENDER_EMAIL,
      to: adminEmail,
      subject: "New Schedule Registration Request",
      text: `A new registration request has been submitted:\n\nSchedule: ${
        registration.scheduleId.title
      }\nUser: ${registration.userId.fullName} (${
        registration.userId.email
      })\nPhone: ${
        registration.userId.phoneNumber || "Not provided"
      }\nStatus: Pending Review\n\nAction Required:\n1. Review this request in the admin dashboard\n2. If approved, send a payment link to the user\n3. The user will be notified that payment is required to join the class\n\nLogin to the dashboard to manage this request.`,
      html: emailContent,
    });

    if (!mailResult) {
      throw new AppError("Failed to send admin notification email", 500);
    }

    return true;
  } catch (error) {
    console.error("Error sending admin notification email:", error);
    // Continue execution even if admin notification fails
    return true;
  }
};

export const notifyUser = async (registrationId) => {
  const registration = await ScheduleRegistration.findById(registrationId)
    .populate("userId", "fullName email")
    .populate("scheduleId", "title startDate endDate classTime");

  if (!registration) {
    throw new AppError("Registration not found", 404);
  }

  // Format dates if available
  let dateInfo = "";
  if (registration.scheduleId.startDate && registration.scheduleId.endDate) {
    const startDate = new Date(
      registration.scheduleId.startDate
    ).toLocaleDateString();
    const endDate = new Date(
      registration.scheduleId.endDate
    ).toLocaleDateString();
    dateInfo = `<p><strong>Dates:</strong> ${startDate} to ${endDate}</p>`;

    if (registration.scheduleId.classTime) {
      dateInfo += `<p><strong>Time:</strong> ${registration.scheduleId.classTime}</p>`;
    }
  }

  const emailContent = `
    <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e3e3e3; border-radius: 8px;">
      <h2 style="color: #333; border-bottom: 1px solid #eee; padding-bottom: 10px;">Schedule Registration Confirmation</h2>
      <p>Dear ${registration.userId.fullName},</p>
      <p>Thank you for registering! We have received your registration request for:</p>
      
      <div style="background-color: #f8f9fa; border-left: 4px solid #17a2b8; padding: 15px; margin: 20px 0; border-radius: 5px;">
        <p style="margin-top: 0; font-size: 18px;"><strong>${registration.scheduleId.title}</strong></p>
        ${dateInfo}
      </div>
      
      <div style="background-color: #d4edda; border-left: 4px solid #28a745; padding: 15px; margin: 20px 0; border-radius: 5px;">
        <p style="margin: 0;"><strong>Next Steps:</strong></p>
        <p style="margin-top: 10px;">1. Your request is currently under review</p>
        <p>2. Once approved, we will send you a payment link</p>
        <p>3. Complete the payment to secure your spot in the class</p>
      </div>
      
      <p>We'll notify you of any updates to your registration status.</p>
      <p style="margin-top: 25px; padding-top: 15px; border-top: 1px solid #eee; color: #666;">If you have any questions, please don't hesitate to contact us.</p>
      <p>Thank you for your interest!</p>
    </div>
  `;

  try {
    const mailResult = await transporter.sendMail({
      from: process.env.SENDER_EMAIL,
      to: registration.userId.email,
      subject: "Schedule Registration Confirmation",
      text: `Dear ${registration.userId.fullName},\n\nThank you for registering! We have received your registration request for: ${registration.scheduleId.title}\n\nNext Steps:\n1. Your request is currently under review\n2. Once approved, we will send you a payment link\n3. Complete the payment to secure your spot in the class\n\nWe'll notify you of any updates to your registration status.\n\nIf you have any questions, please don't hesitate to contact us.\n\nThank you for your interest!`,
      html: emailContent,
    });

    if (!mailResult) {
      throw new AppError("Failed to send user confirmation email", 500);
    }

    return true;
  } catch (error) {
    console.error("Error sending user confirmation email:", error);
    // Continue execution even if user notification fails
    return true;
  }
};

export const sendApprovalConfirmationEmail = async (registration) => {
  if (!registration || !registration.userId || !registration.scheduleId) {
    throw new AppError("Invalid registration data for approval email", 400);
  }

  // Format dates if available
  let dateInfo = "";
  let classDetails = "";

  if (registration.scheduleId.startDate && registration.scheduleId.endDate) {
    const startDate = new Date(
      registration.scheduleId.startDate
    ).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const endDate = new Date(
      registration.scheduleId.endDate
    ).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    dateInfo = `
      <div style="background-color: #e8f5e8; border-left: 4px solid #28a745; padding: 15px; margin: 20px 0; border-radius: 5px;">
        <h3 style="color: #155724; margin-top: 0;">📅 Class Schedule</h3>
        <p style="margin: 5px 0;"><strong>Start Date:</strong> ${startDate}</p>
        <p style="margin: 5px 0;"><strong>End Date:</strong> ${endDate}</p>
        ${
          registration.scheduleId.classTime
            ? `<p style="margin: 5px 0;"><strong>Class Time:</strong> ${registration.scheduleId.classTime}</p>`
            : ""
        }
      </div>
    `;

    classDetails = `Start Date: ${startDate}\nEnd Date: ${endDate}${
      registration.scheduleId.classTime
        ? `\nClass Time: ${registration.scheduleId.classTime}`
        : ""
    }`;
  }

  const emailContent = `
    <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e3e3e3; border-radius: 8px; background-color: #ffffff;">
      <!-- Header -->
      <div style="text-align: center; background: linear-gradient(135deg, #28a745, #20c997); color: white; padding: 30px; border-radius: 8px 8px 0 0; margin: -20px -20px 30px -20px;">
        <h1 style="margin: 0; font-size: 28px;">🎉 Registration Approved!</h1>
        <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">You're officially enrolled in the class</p>
      </div>

      <!-- Main Content -->
      <div style="padding: 0 10px;">
        <p style="font-size: 18px; color: #333;">Dear <strong>${registration.userId.fullName}</strong>,</p>
        
        <p style="font-size: 16px; line-height: 1.6; color: #444;">
          <strong>Congratulations!</strong> We're excited to inform you that your registration request for 
          <strong style="color: #28a745;">${registration.scheduleId.title}</strong> has been <strong>approved</strong>! 
          You can now attend the class at the scheduled time.
        </p>

        ${dateInfo}

        <!-- Confirmation Details -->
        <div style="background-color: #f8f9fa; border: 2px dashed #28a745; padding: 20px; margin: 25px 0; border-radius: 8px; text-align: center;">
          <h3 style="color: #28a745; margin-top: 0;">✅ You're All Set!</h3>
          <p style="font-size: 16px; color: #333; margin: 10px 0;">
            Your registration is confirmed and you're ready to attend the class.
          </p>
        </div>

        <!-- Important Information -->
        <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 5px;">
          <h4 style="color: #856404; margin-top: 0;">📋 Important Information</h4>
          <ul style="color: #856404; margin: 10px 0; padding-left: 20px;">
            <li>Please arrive 10-15 minutes before the scheduled class time</li>
            <li>Bring any required materials for the class</li>
            <li>Come prepared and ready to learn</li>
            <li>If you need to cancel, please notify us at least 24 hours in advance</li>
          </ul>
        </div>

        <!-- Contact Information -->
        <div style="background-color: #d1ecf1; border-left: 4px solid #17a2b8; padding: 15px; margin: 20px 0; border-radius: 5px;">
          <h4 style="color: #0c5460; margin-top: 0;">📞 Need Help?</h4>
          <p style="color: #0c5460; margin: 5px 0;">
            If you have any questions or need to make changes to your registration, 
            please don't hesitate to contact us. We're here to help!
          </p>
        </div>

        <p style="font-size: 16px; line-height: 1.6; color: #444; margin-top: 30px;">
          We look forward to seeing you in class! Thank you for choosing our program.
        </p>

        <p style="font-size: 16px; color: #333;">
          Best regards,<br>
          <strong>Way Team</strong>
        </p>
      </div>

      <!-- Footer -->
      <div style="text-align: center; padding: 20px; border-top: 1px solid #eee; margin-top: 30px; color: #666; font-size: 12px;">
        <p>This is an automated confirmation email. Please keep this for your records.</p>
      </div>
    </div>
  `;

  const textContent = `Dear ${registration.userId.fullName},

REGISTRATION APPROVED! 🎉

Congratulations! We're excited to inform you that your registration request for "${registration.scheduleId.title}" has been approved! You can now attend the class at the scheduled time.

CLASS SCHEDULE:
${classDetails}

YOU'RE ALL SET!
Your registration is confirmed and you're ready to attend the class.

IMPORTANT INFORMATION:
- Please arrive 10-15 minutes before the scheduled class time
- Bring any required materials for the class
- Come prepared and ready to learn
- If you need to cancel, please notify us at least 24 hours in advance

Need Help?
If you have any questions or need to make changes to your registration, please don't hesitate to contact us. We're here to help!

We look forward to seeing you in class! Thank you for choosing our program.

Best regards,
Way Team

This is an automated confirmation email. Please keep this for your records.`;

  try {
    const mailResult = await transporter.sendMail({
      from: process.env.SENDER_EMAIL,
      to: registration.userId.email,
      subject: `🎉 Class Registration Approved - ${registration.scheduleId.title}`,
      text: textContent,
      html: emailContent,
    });

    if (!mailResult) {
      throw new AppError("Failed to send approval confirmation email", 500);
    }

    console.log(
      `Approval confirmation email sent to ${registration.userId.email} for schedule: ${registration.scheduleId.title}`
    );
    return true;
  } catch (error) {
    console.error("Error sending approval confirmation email:", error);
    throw new AppError(
      "Failed to send approval confirmation email: " + error.message,
      500
    );
  }
};

// Create a request for a full class
export const createFullClassRequest = async (
  userId,
  scheduleId,
  message,
  sessionId
) => {
  // Check if user is verified
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError("User not found", 404);
  }

  if (!user.verified) {
    throw new AppError("User must be verified to request a spot", 403);
  }

  // Check if schedule and session exist
  const schedule = await Schedule.findById(scheduleId);
  if (!schedule) {
    throw new AppError("Schedule not found", 404);
  }
  const session = schedule.sessions.id(sessionId);
  if (!session) {
    throw new AppError("Session not found", 404);
  }

  // Check if the user already has a registration or request for this SPECIFIC SESSION
  const existingRegistration = await ScheduleRegistration.findOne({
    userId,
    scheduleId,
    sessionId,
  });

  if (existingRegistration) {
    if (existingRegistration.isFullClassRequest) {
      throw new AppError(
        "You have already requested a spot for this specific session",
        409
      );
    } else {
      throw new AppError(
        "You have already registered for this specific session",
        409
      );
    }
  }

  // Debug logging for this specific request
  console.log(
    `User ${userId} requesting spot in full class - Schedule: ${scheduleId}, Session: ${sessionId}`
  );

  // Log all existing registrations for this schedule to help with debugging
  const userScheduleRegistrations = await ScheduleRegistration.find({
    userId,
    scheduleId,
  });

  // Just log the registrations for debugging - no blocking logic here
  if (userScheduleRegistrations.length > 0) {
    console.log(
      `User already has ${userScheduleRegistrations.length} registrations for this schedule (this is allowed):`
    );
    userScheduleRegistrations.forEach((reg) => {
      console.log(
        `- Session ID: ${reg.sessionId}, Status: ${reg.status}, Full Class Request: ${reg.isFullClassRequest}`
      );
    });

    // Check if any existing registrations are for other sessions of this schedule
    const otherSessionRegistrations = userScheduleRegistrations.filter(
      (reg) => reg.sessionId.toString() !== sessionId
    );

    if (otherSessionRegistrations.length > 0) {
      console.log(
        `User is requesting a spot in a different session of the same schedule (${otherSessionRegistrations.length} other sessions registered)`
      );
    }
  }

  // Check if the schedule is actually at capacity
  const paidRegistrations = await ScheduleRegistration.countDocuments({
    scheduleId,
    sessionId,
    paymentStatus: "paid",
  });

  if (paidRegistrations < session.capacity) {
    throw new AppError(
      "This session still has available spots. Please register normally instead.",
      400
    );
  }

  // Create full class request registration
  try {
    const registration = await ScheduleRegistration.create({
      userId,
      scheduleId,
      sessionId,
      status: "pending",
      paymentStatus: "unpaid",
      isFullClassRequest: true,
      notes: message || "User requested spot in fully booked class",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return await ScheduleRegistration.findById(registration._id)
      .populate("userId", "fullName email phoneNumber verified")
      .populate("scheduleId", "title startDate endDate sessions");
  } catch (error) {
    // Improved error handling for duplicate key and other MongoDB errors
    if (error.code === 11000) {
      // This is a duplicate key error
      console.log("Duplicate full class request attempt:", {
        userId,
        scheduleId,
        sessionId,
      });
      console.log("Error details:", error);

      // Check which fields are in the duplicate key error
      const isUserIdDuplicate = error.keyPattern?.userId === 1;
      const isScheduleIdDuplicate = error.keyPattern?.scheduleId === 1;
      const isSessionIdDuplicate = error.keyPattern?.sessionId === 1;

      console.log("Duplicate key details:", {
        isUserIdDuplicate,
        isScheduleIdDuplicate,
        isSessionIdDuplicate,
      });

      // Only if all three fields are duplicated, it's a session-specific duplicate
      if (isUserIdDuplicate && isScheduleIdDuplicate && isSessionIdDuplicate) {
        throw new AppError(
          "You have already requested a spot for this specific session date (duplicate record detected)",
          409
        );
      } else if (isUserIdDuplicate && isScheduleIdDuplicate) {
        // This shouldn't happen with our current index, but handle it just in case
        throw new AppError(
          "You've already registered for a session of this schedule",
          409
        );
      } else {
        throw new AppError("Duplicate registration request detected", 409);
      }
    }

    // Log the detailed error for debugging
    console.error("Error creating full class request:", error);

    // Return a more specific error message if possible
    if (error.name === "ValidationError") {
      throw new AppError(`Validation error: ${error.message}`, 400);
    } else if (error.name === "MongoServerError") {
      throw new AppError(`Database error: ${error.message}`, 500);
    } else {
      throw new AppError(
        "Failed to create full class request. Please try again later.",
        500
      );
    }
  }
};

// Send notification to admin about full class request
// Send a custom message to a student
export const sendCustomMessage = async (registrationId, messageContent) => {
  try {
    const registration = await ScheduleRegistration.findById(registrationId)
      .populate("userId", "fullName email phoneNumber")
      .populate("scheduleId", "title startDate endDate classTime");

    if (!registration) {
      throw new Error("request_not_found");
    }

    await sendCustomMessageEmail(registration, messageContent);
    return true;
  } catch (error) {
    console.error("Error sending custom message:", error);
    throw error;
  }
};

// Send email with custom message to student
const sendCustomMessageEmail = async (registration, messageContent) => {
  // Skip if no email recipient
  if (!registration.userId || !registration.userId.email) {
    console.error("Cannot send email: No recipient email address");
    throw new Error("invalid_email");
  }

  const subject = `Message regarding your registration for ${registration.scheduleId.title}`;

  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e3e3e3; border-radius: 8px; background-color: #ffffff;">
      <div style="text-align: center; background: linear-gradient(135deg, #17a2b8, #20c997); color: white; padding: 20px; border-radius: 8px 8px 0 0; margin: -20px -20px 20px -20px;">
        <h1 style="margin: 0; font-size: 24px;">Message from Our Team</h1>
      </div>

      <div style="padding: 0 10px;">
        <p style="font-size: 16px; color: #333;">Dear <strong>${registration.userId.fullName}</strong>,</p>
        
        <p style="font-size: 16px; line-height: 1.6; color: #444;">
          Regarding your registration for <strong>${registration.scheduleId.title}</strong>:
        </p>

        <div style="background-color: #f8f9fa; border-left: 4px solid #17a2b8; padding: 15px; margin: 20px 0; border-radius: 5px;">
          <p style="white-space: pre-line;">${messageContent}</p>
        </div>

        <p style="font-size: 16px; color: #333; margin-top: 30px;">
          If you have any questions, please feel free to reply to this email.
        </p>

        <p style="font-size: 16px; color: #333;">
          Best regards,<br>
          <strong>Way Team</strong>
        </p>
      </div>
    </div>
  `;

  const textContent = `
Dear ${registration.userId.fullName},

Regarding your registration for ${registration.scheduleId.title}:

${messageContent}

If you have any questions, please feel free to reply to this email.

Best regards,
Way Team
  `;

  try {
    const mailResult = await transporter.sendMail({
      from: process.env.SENDER_EMAIL,
      to: registration.userId.email,
      subject,
      text: textContent,
      html,
    });

    if (!mailResult) {
      throw new Error("Failed to send message email");
    }

    console.log(
      `Custom message email sent to ${registration.userId.email} for schedule: ${registration.scheduleId.title}`
    );
    return true;
  } catch (error) {
    console.error("Error sending custom message email:", error);
    throw error;
  }
};

export const notifyAdminFullClassRequest = async (registrationId) => {
  try {
    const registration = await ScheduleRegistration.findById(registrationId)
      .populate("userId", "fullName email phoneNumber")
      .populate("scheduleId", "title startDate endDate classTime");

    if (!registration) {
      throw new AppError("Registration not found", 404);
    }

    const mailOptions = {
      from: process.env.SENDER_EMAIL,
      to: process.env.ADMIN_EMAIL,
      subject: `Full Class Request - ${registration.scheduleId.title}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 10px; text-align: center; margin-bottom: 20px;">
            <h1 style="margin: 0; font-size: 24px;">🔔 Full Class Request</h1>
            <p style="margin: 10px 0 0 0;">A student wants to join a fully booked class</p>
          </div>
          
          <div style="padding: 20px;">
            <h2 style="color: #333; border-bottom: 2px solid #667eea; padding-bottom: 10px;">Class Details</h2>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Class:</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${
                  registration.scheduleId.title
                }</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Start Date:</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${new Date(
                  registration.scheduleId.startDate
                ).toLocaleDateString()}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">End Date:</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${new Date(
                  registration.scheduleId.endDate
                ).toLocaleDateString()}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Time:</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${
                  registration.scheduleId.classTime
                }</td>
              </tr>
            </table>

            <h2 style="color: #333; border-bottom: 2px solid #667eea; padding-bottom: 10px;">Student Information</h2>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Name:</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${
                  registration.userId.fullName
                }</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Email:</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${
                  registration.userId.email
                }</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Phone:</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${
                  registration.userId.phoneNumber || "Not provided"
                }</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Request Date:</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${new Date(
                  registration.createdAt
                ).toLocaleDateString()}</td>
              </tr>
            </table>

            ${
              registration.notes
                ? `
              <h2 style="color: #333; border-bottom: 2px solid #667eea; padding-bottom: 10px;">Student Message</h2>
              <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
                <p style="margin: 0; color: #666;">${registration.notes}</p>
              </div>
            `
                : ""
            }

            <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p style="margin: 0; color: #856404;"><strong>Action Required:</strong> This is a request for a fully booked class. Please review and decide whether to:</p>
              <ul style="color: #856404; margin: 10px 0;">
                <li>Add the student to a waiting list</li>
                <li>Increase class capacity if possible</li>
                <li>Contact the student about alternative options</li>
              </ul>
            </div>

            <div style="text-align: center; margin-top: 30px;">
              <p style="color: #666; margin: 0;">Please log into the admin dashboard to manage this request.</p>
            </div>
          </div>
        </div>
      `,
    };

    const mailResult = await transporter.sendMail(mailOptions);

    if (!mailResult) {
      throw new AppError("Failed to send admin notification email", 500);
    }

    console.log(
      `Full class request notification sent to admin for user: ${registration.userId.fullName} (${registration.userId.email})`
    );
    return true;
  } catch (error) {
    console.error("Error sending full class request notification:", error);
    throw new AppError(
      "Failed to send admin notification: " + error.message,
      500
    );
  }
};
