import mongoose from "mongoose";

const scheduleRegistrationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
    },
    scheduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Schedule",
      required: [true, "Schedule ID is required"],
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, "Session ID is required"],
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "pending", "paid", "free"],
      default: "unpaid",
    },
    notes: {
      type: String,
      default: "",
    },
    rejectionReason: {
      type: String,
      default: "",
    },
    paymentLink: {
      type: String,
      default: "",
    },
    paymentSent: {
      type: Boolean,
      default: false,
    },
    isFullClassRequest: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Add index to improve query performance
scheduleRegistrationSchema.index(
  { userId: 1, scheduleId: 1, sessionId: 1 },
  { unique: true }
);

const ScheduleRegistration = mongoose.model(
  "ScheduleRegistration",
  scheduleRegistrationSchema
);

export default ScheduleRegistration;
