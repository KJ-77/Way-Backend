import mongoose from "mongoose";

// Subdocument schema for a single session within a schedule
const sessionSchema = new mongoose.Schema(
  {
    startDate: {
      type: Date,
      required: [true, "Session start date is required"],
    },
    endDate: {
      type: Date,
      required: [true, "Session end date is required"],
    },
    time: {
      type: String, // Expected format: HH:mm (24h)
      required: [true, "Session time is required"],
      trim: true,
    },
    period: {
      type: String, // Values like "2hours", "3hours", etc.
      required: [true, "Session period is required"],
      default: "2hours",
      trim: true,
    },
    capacity: {
      type: Number,
      required: [true, "Session capacity is required"],
      min: [1, "Capacity must be at least 1"],
    },
    tutor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tutor",
      required: [true, "Session tutor is required"],
    },
  },
  { _id: true }
);

const scheduleSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Schedule title is required"],
      trim: true,
    },
    text: {
      type: String,
      required: [true, "Schedule text is required"],
      trim: true,
    },
    images: {
      type: [String],
      default: [],
      validate: {
        validator: function (v) {
          return Array.isArray(v);
        },
        message: "Images must be an array",
      },
    },
    // New: multiple sessions per schedule
    sessions: {
      type: [sessionSchema],
      default: [],
      validate: {
        validator: function (v) {
          return Array.isArray(v) && v.length > 0;
        },
        message: "At least one session is required",
      },
    },
    slug: {
      type: String,
      required: [true, "Slug is required"],
      unique: [true, "Slug must be unique"],
      trim: true,
      lowercase: true,
    },
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: [0, "Price cannot be negative"],
      default: 0,
    },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
    },
  },
  { timestamps: true }
);

const Schedule = mongoose.model("Schedule", scheduleSchema);

export default Schedule;
