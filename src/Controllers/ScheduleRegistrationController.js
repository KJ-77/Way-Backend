import * as RegistrationService from "../Services/crud/RegistrationService.js";
import catchAsync from "../utils/catchAsync.js";
import AppError from "../utils/appError.js";

// Create a new registration
export const createRegistration = catchAsync(async (req, res, next) => {
  try {
    const { scheduleId, sessionId } = req.body;
    const userId = req.user.id;

    const registration = await RegistrationService.createRegistration(
      userId,
      scheduleId,
      sessionId
    );

    // Send notification emails
    await Promise.all([
      RegistrationService.notifyUser(registration._id),
      RegistrationService.notifyAdmin(registration._id),
    ]);

    res.status(201).json({
      status: "success",
      data: { registration },
    });
  } catch (error) {
    // Check if it's an AppError with a status code
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        status: error.status || "error",
        message: error.message,
      });
    }

    // Otherwise pass to the global error handler
    next(error);
  }
});

// Request spot in a full class
export const requestFullClass = catchAsync(async (req, res, next) => {
  try {
    const { scheduleId, sessionId, message } = req.body;
    const userId = req.user.id;

    // Create a special registration request for full class
    const registration = await RegistrationService.createFullClassRequest(
      userId,
      scheduleId,
      message,
      sessionId
    );

    // Send notification to admin about the full class request
    await RegistrationService.notifyAdminFullClassRequest(registration._id);

    res.status(201).json({
      status: "success",
      message:
        "Your request has been sent to the admin. You'll be notified if a spot becomes available.",
      data: { registration },
    });
  } catch (error) {
    // Check if it's an AppError with a status code
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        status: error.status || "error",
        message: error.message,
      });
    }

    // Otherwise pass to the global error handler
    next(error);
  }
});

// Get registrations by schedule ID
export const getRegistrationsBySchedule = catchAsync(async (req, res, next) => {
  const { scheduleId } = req.params;
  const { status, sessionId } = req.query;

  const registrations = await RegistrationService.getRegistrationsBySchedule(
    scheduleId,
    status,
    sessionId || null
  );

  res.status(200).json({
    status: "success",
    results: registrations.length,
    data: { registrations },
  });
});

// Get all registrations with pagination for admin panel
export const getAllRegistrations = catchAsync(async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const status = req.query.status || null;

  const { registrations, total, totalPages } =
    await RegistrationService.getAllRegistrations(page, limit, status);

  res.status(200).json({
    status: "success",
    results: registrations.length,
    page,
    totalPages,
    totalItems: total,
    data: { registrations },
  });
});

// Get registration by ID
export const getRegistrationById = catchAsync(async (req, res, next) => {
  const { registrationId } = req.params;

  const registration = await RegistrationService.getRegistrationById(
    registrationId
  );

  if (!registration) {
    return next(new AppError("Registration not found", 404));
  }

  res.status(200).json({
    status: "success",
    data: { registration },
  });
});

// Get registrations for the current user
export const getMyRegistrations = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  const registrations = await RegistrationService.getRegistrationsByUser(
    userId
  );

  res.status(200).json({
    status: "success",
    results: registrations.length,
    data: { registrations },
  });
});

// Update registration status (approve/reject)
export const updateRegistrationStatus = catchAsync(async (req, res, next) => {
  const { registrationId } = req.params;
  const { status, notes } = req.body;

  // Validate status
  if (!["pending", "approved", "rejected"].includes(status)) {
    return next(
      new AppError(
        "Invalid status. Must be 'pending', 'approved', or 'rejected'",
        400
      )
    );
  }

  const registration = await RegistrationService.updateRegistrationStatus(
    registrationId,
    status,
    notes
  );

  res.status(200).json({
    status: "success",
    data: { registration },
  });
});

// Update payment status
export const updatePaymentStatus = catchAsync(async (req, res, next) => {
  const { registrationId } = req.params;
  const { paymentStatus } = req.body;

  // Validate status
  if (!["unpaid", "pending", "paid", "free"].includes(paymentStatus)) {
    return next(
      new AppError(
        "Invalid payment status. Must be 'unpaid', 'pending', 'paid', or 'free'",
        400
      )
    );
  }

  const registration = await RegistrationService.updatePaymentStatus(
    registrationId,
    paymentStatus
  );

  res.status(200).json({
    status: "success",
    data: { registration },
  });
});

// Send payment link
export const sendPaymentLink = catchAsync(async (req, res, next) => {
  const { registrationId } = req.params;
  const { paymentLink } = req.body;

  if (!paymentLink) {
    return next(new AppError("Payment link is required", 400));
  }

  const registration = await RegistrationService.sendPaymentLink(
    registrationId,
    paymentLink
  );

  res.status(200).json({
    status: "success",
    data: { registration },
  });
});

// Check schedule capacity
export const checkScheduleCapacity = catchAsync(async (req, res, next) => {
  const { scheduleId } = req.params;

  const capacityInfo = await RegistrationService.checkScheduleCapacity(
    scheduleId
  );

  res.status(200).json({
    status: "success",
    data: capacityInfo,
  });
});

// Send message to student
export const sendMessageToStudent = catchAsync(async (req, res, next) => {
  try {
    const { registrationId } = req.params;
    const { message } = req.body;

    if (!registrationId) {
      return res.status(400).json({
        status: "error",
        message: "Registration ID is required",
      });
    }

    if (!message || message.trim() === "") {
      return res.status(400).json({
        status: "error",
        message: "Message content is required",
      });
    }

    await RegistrationService.sendCustomMessage(registrationId, message.trim());

    res.status(200).json({
      status: "success",
      message: "Message sent successfully to the student",
    });
  } catch (error) {
    console.error("Send message to student error:", error);

    if (error.message === "request_not_found") {
      return res.status(404).json({
        status: "error",
        message: "Registration not found",
      });
    }

    if (error.message === "invalid_email") {
      return res.status(400).json({
        status: "error",
        message: "Student email address is invalid or missing",
      });
    }

    res.status(500).json({
      status: "error",
      message: "An error occurred while sending the message",
    });
  }
});
