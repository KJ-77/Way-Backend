import Tutor from "../Modules/Tutor.model.js";
import Schedule from "../Modules/Schedule.model.js";
import mongoose from "mongoose";
import multer from "multer";
import path from "path";

// Set up storage for uploaded files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/tutors/");
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(
      Math.random() * 1e9
    )}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

// Create the upload middleware
export const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const extname = filetypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = filetypes.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

// Create a new tutor
export const createTutor = async (req, res) => {
  try {
    console.log("Request body:", req.body);
    console.log("File:", req.file);

    const { name, email, password, bio, description } = req.body;

    // Check if email already exists
    const existingTutor = await Tutor.findOne({ email });
    if (existingTutor) {
      return res.status(400).json({
        status: "fail",
        message: "Email already in use",
      });
    }

    // Set avatar path if file was uploaded
    const avatarPath = req.file ? `/uploads/tutors/${req.file.filename}` : "";

    // Create new tutor
    const newTutor = await Tutor.create({
      name,
      email,
      password,
      bio,
      description,
      avatar: avatarPath,
    });

    // Remove password from response
    const tutorResponse = { ...newTutor._doc };
    delete tutorResponse.password;

    res.status(201).json({
      status: "success",
      data: tutorResponse,
    });
  } catch (error) {
    console.error("Error creating tutor:", error);
    res.status(400).json({
      status: "fail",
      message: error.message || "Failed to create tutor",
    });
  }
};

// Get all tutors
export const getAllTutors = async (req, res) => {
  try {
    const tutors = await Tutor.find().select("-password");

    res.status(200).json({
      status: "success",
      results: tutors.length,
      data: tutors,
    });
  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message || "Failed to retrieve tutors",
    });
  }
};

// Get a single tutor
export const getTutor = async (req, res) => {
  try {
    const tutor = await Tutor.findById(req.params.id)
      .select("-password")
      .populate("schedules");

    if (!tutor) {
      return res.status(404).json({
        status: "fail",
        message: "Tutor not found",
      });
    }

    res.status(200).json({
      status: "success",
      data: tutor,
    });
  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message || "Failed to retrieve tutor",
    });
  }
};

// Update a tutor
export const updateTutor = async (req, res) => {
  try {
    // Don't allow password updates through this route
    if (req.body.password) {
      delete req.body.password;
    }

    const updatedTutor = await Tutor.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
      }
    ).select("-password");

    if (!updatedTutor) {
      return res.status(404).json({
        status: "fail",
        message: "Tutor not found",
      });
    }

    res.status(200).json({
      status: "success",
      data: updatedTutor,
    });
  } catch (error) {
    res.status(400).json({
      status: "fail",
      message: error.message || "Failed to update tutor",
    });
  }
};

// Delete a tutor
export const deleteTutor = async (req, res) => {
  try {
    const tutor = await Tutor.findByIdAndDelete(req.params.id);

    if (!tutor) {
      return res.status(404).json({
        status: "fail",
        message: "Tutor not found",
      });
    }

    // Remove tutor from all associated schedules
    await Schedule.updateMany(
      { tutors: req.params.id },
      { $pull: { tutors: req.params.id } }
    );

    res.status(204).json({
      status: "success",
      data: null,
    });
  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message || "Failed to delete tutor",
    });
  }
};

// Assign tutor to schedule
export const assignTutorToSchedule = async (req, res) => {
  try {
    const { tutorId, scheduleId } = req.body;

    // Validate IDs
    if (
      !mongoose.Types.ObjectId.isValid(tutorId) ||
      !mongoose.Types.ObjectId.isValid(scheduleId)
    ) {
      return res.status(400).json({
        status: "fail",
        message: "Invalid tutor or schedule ID",
      });
    }

    // Check if tutor and schedule exist
    const tutor = await Tutor.findById(tutorId);
    const schedule = await Schedule.findById(scheduleId);

    if (!tutor) {
      return res.status(404).json({
        status: "fail",
        message: "Tutor not found",
      });
    }

    if (!schedule) {
      return res.status(404).json({
        status: "fail",
        message: "Schedule not found",
      });
    }

    // Check if tutor is already assigned to this schedule
    if (schedule.tutors.includes(tutorId)) {
      return res.status(400).json({
        status: "fail",
        message: "Tutor is already assigned to this schedule",
      });
    }

    // Add tutor to schedule
    schedule.tutors.push(tutorId);
    await schedule.save();

    // Add schedule to tutor's schedules array
    tutor.schedules.push(scheduleId);
    await tutor.save();

    res.status(200).json({
      status: "success",
      message: "Tutor assigned to schedule successfully",
      data: {
        tutor: tutor._id,
        schedule: schedule._id,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message || "Failed to assign tutor to schedule",
    });
  }
};

// Remove tutor from schedule
export const removeTutorFromSchedule = async (req, res) => {
  try {
    const { tutorId, scheduleId } = req.body;

    // Update schedule to remove tutor
    const schedule = await Schedule.findByIdAndUpdate(
      scheduleId,
      { $pull: { tutors: tutorId } },
      { new: true }
    );

    if (!schedule) {
      return res.status(404).json({
        status: "fail",
        message: "Schedule not found",
      });
    }

    // Update tutor to remove schedule
    const tutor = await Tutor.findByIdAndUpdate(
      tutorId,
      { $pull: { schedules: scheduleId } },
      { new: true }
    );

    if (!tutor) {
      return res.status(404).json({
        status: "fail",
        message: "Tutor not found",
      });
    }

    res.status(200).json({
      status: "success",
      message: "Tutor removed from schedule successfully",
    });
  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message || "Failed to remove tutor from schedule",
    });
  }
};

// Get schedules for a tutor
export const getTutorSchedules = async (req, res) => {
  try {
    const tutorId = req.params.id;

    const tutor = await Tutor.findById(tutorId).populate("schedules");

    if (!tutor) {
      return res.status(404).json({
        status: "fail",
        message: "Tutor not found",
      });
    }

    res.status(200).json({
      status: "success",
      results: tutor.schedules.length,
      data: tutor.schedules,
    });
  } catch (error) {
    res.status(500).json({
      status: "fail",
      message: error.message || "Failed to retrieve tutor schedules",
    });
  }
};
