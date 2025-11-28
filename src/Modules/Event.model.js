import mongoose from "mongoose";

const eventSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Event title is required"],
      trim: true,
      maxlength: [200, "Event title cannot exceed 200 characters"],
    },
    content: {
      type: String,
      required: [true, "Event content is required"],
      trim: true,
    },
    image: {
      type: String,
      default: null,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Create index for slug for better query performance
eventSchema.index({ slug: 1 });

// Create index for title for search functionality
eventSchema.index({ title: 1 });

const Event = mongoose.model("Event", eventSchema);

export default Event;
