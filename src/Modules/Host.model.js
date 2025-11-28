import mongoose from "mongoose";

const hostSchema = new mongoose.Schema(
  {
    text: {
      type: String,
      required: true,
      trim: true,
    },
    image: {
      type: String,
      required: false,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for performance
hostSchema.index({ slug: 1 });
hostSchema.index({ text: 1 });

const Host = mongoose.model("Host", hostSchema);

export default Host;
