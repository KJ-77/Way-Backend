import express from "express";
import {
  createTutor,
  getAllTutors,
  getTutor,
  updateTutor,
  deleteTutor,
  assignTutorToSchedule,
  removeTutorFromSchedule,
  getTutorSchedules,
  upload,
} from "../Controllers/tutor.controller.js";
import { protect as authenticateAdmin } from "../middlewares/AdminIdentifications.js";
import { protect as identifyAny } from "../Controllers/auth.controller.js";

const router = express.Router();

// Tutor self routes (accessible by tutor or admin) - must be declared BEFORE admin-only guard
router.get("/me/profile", identifyAny, async (req, res) => {
  try {
    if (req.role !== "tutor" && req.role !== "admin") {
      return res.status(403).json({ status: "fail", message: "Forbidden" });
    }
    // If admin, allow querying via query.id; if tutor, use req.user.id
    const tutorId = req.role === "tutor" ? req.user.id : req.query.id;
    if (!tutorId) {
      return res
        .status(400)
        .json({ status: "fail", message: "Missing tutor id" });
    }
    const tutor = await (await import("../Modules/Tutor.model.js")).default
      .findById(tutorId)
      .select("-password")
      .populate("schedules");
    if (!tutor) {
      return res
        .status(404)
        .json({ status: "fail", message: "Tutor not found" });
    }
    return res.status(200).json({ status: "success", data: tutor });
  } catch (e) {
    return res
      .status(500)
      .json({ status: "fail", message: e.message || "Server error" });
  }
});

router.get("/me/schedules", identifyAny, async (req, res) => {
  try {
    if (req.role !== "tutor" && req.role !== "admin") {
      return res.status(403).json({ status: "fail", message: "Forbidden" });
    }
    const tutorId = req.role === "tutor" ? req.user.id : req.query.id;
    if (!tutorId) {
      return res
        .status(400)
        .json({ status: "fail", message: "Missing tutor id" });
    }
    const Schedule = (await import("../Modules/Schedule.model.js")).default;
    const schedules = await Schedule.find({ tutors: tutorId });
    return res.status(200).json({
      status: "success",
      results: schedules.length,
      data: schedules,
    });
  } catch (e) {
    return res
      .status(500)
      .json({ status: "fail", message: e.message || "Server error" });
  }
});

// Protected routes - require admin authentication
router.use(authenticateAdmin);

// Tutor CRUD operations - add upload middleware to handle file uploads
router.post("/", upload.single("avatar"), createTutor);
router.get("/", getAllTutors);
router.get("/:id", getTutor);
router.put("/:id", upload.single("avatar"), updateTutor);
router.delete("/:id", deleteTutor);

// Schedule assignment routes
router.post("/assign", assignTutorToSchedule);
router.post("/remove", removeTutorFromSchedule);
router.get("/:id/schedules", getTutorSchedules);

export default router;
