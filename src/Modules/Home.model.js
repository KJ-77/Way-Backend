import mongoose from "mongoose";

const homeSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Home title is required"],
      trim: true,
      maxlength: [200, "Home title cannot exceed 200 characters"],
    },
    text: {
      type: String,
      required: [true, "Home text is required"],
      trim: true,
    },
    video: {
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
homeSchema.index({ slug: 1 });

// Create index for title for search functionality
homeSchema.index({ title: 1 });

const Home = mongoose.model("Home", homeSchema);

export default Home;
