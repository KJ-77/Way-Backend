import express from "express";
import * as ScheduleRegistrationController from "../Controllers/ScheduleRegistrationController.js";
import { Identifier } from "../middlewares/Identifications.js";
import { protect as identifyAny } from "../Controllers/auth.controller.js";
import Tutor from "../Modules/Tutor.model.js";
import { protect as AdminAuthentication } from "../middlewares/AdminIdentifications.js";
import Schedule from "../Modules/Schedule.model.js";

const router = express.Router();

// Public routes
router
  .route("/schedule/:scheduleId/capacity")
  .get(ScheduleRegistrationController.checkScheduleCapacity);

// User routes - require authentication
router.use(Identifier);

// Create a new registration
router.route("/").post(ScheduleRegistrationController.createRegistration);

// Request spot in full class
router
  .route("/request-full-class")
  .post(ScheduleRegistrationController.requestFullClass);

// Get current user's registrations
router
  .route("/my-registrations")
  .get(ScheduleRegistrationController.getMyRegistrations);

// Tutor-only: get registrations for an assigned schedule (optionally filter by session)
router
  .route("/tutor/schedule/:scheduleId")
  .get(identifyAny, async (req, res, next) => {
    try {
      if (req.role !== "tutor") {
        return res.status(403).json({ status: "fail", message: "Forbidden" });
      }
      const scheduleId = req.params.scheduleId;
      // Verify tutor is assigned to at least one session in this schedule
      const schedule = await Schedule.findById(scheduleId);
      const isAssigned = !!schedule?.sessions?.some(
        (s) => String(s.tutor) === String(req.user.id)
      );
      if (!isAssigned) {
        return res
          .status(403)
          .json({ status: "fail", message: "Not assigned to this schedule" });
      }
      return ScheduleRegistrationController.getRegistrationsBySchedule(
        req,
        res,
        next
      );
    } catch (e) {
      return res
        .status(500)
        .json({ status: "fail", message: e.message || "Server error" });
    }
  });

// Admin routes - require admin authentication
router.use(AdminAuthentication);

// Get all registrations for a schedule
router.route("/schedule/:scheduleId").get(async (req, res, next) => {
  // Allow admin via AdminAuthentication (already applied above)
  // Additionally allow tutors to read registrations for their own schedules
  if (req.admin) {
    return ScheduleRegistrationController.getRegistrationsBySchedule(
      req,
      res,
      next
    );
  }

  // If not admin, check tutor token
  try {
    await new Promise((resolve, reject) => {
      identifyAny(req, res, (err) => (err ? reject(err) : resolve()));
    });
  } catch (e) {
    return res.status(401).json({ status: "fail", message: "Unauthorized" });
  }

  if (req.role !== "tutor") {
    return res.status(403).json({ status: "fail", message: "Forbidden" });
  }

  const scheduleId = req.params.scheduleId;
  const schedule = await Schedule.findById(scheduleId);
  const isAssigned = !!schedule?.sessions?.some(
    (s) => String(s.tutor) === String(req.user.id)
  );
  if (!isAssigned) {
    return res
      .status(403)
      .json({ status: "fail", message: "Not assigned to this schedule" });
  }

  return ScheduleRegistrationController.getRegistrationsBySchedule(
    req,
    res,
    next
  );
});

// Get all registrations (for admin panel)
router.route("/all").get(ScheduleRegistrationController.getAllRegistrations);

// Get registration by ID
router
  .route("/:registrationId")
  .get(ScheduleRegistrationController.getRegistrationById);

// Update registration status
router
  .route("/:registrationId/status")
  .patch(ScheduleRegistrationController.updateRegistrationStatus);

// Update payment status
router
  .route("/:registrationId/payment-status")
  .patch(ScheduleRegistrationController.updatePaymentStatus);

// Send payment link
router
  .route("/:registrationId/payment-link")
  .post(ScheduleRegistrationController.sendPaymentLink);

// Send message to student
router
  .route("/:registrationId/send-message")
  .post(ScheduleRegistrationController.sendMessageToStudent);

export default router;
