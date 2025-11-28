import mongoose from "mongoose";

// Schema for coffee bar section
const coffeeBarSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      trim: true,
      maxlength: [200, "Coffee bar title cannot exceed 200 characters"],
    },
    text: {
      type: String,
      trim: true,
    },
    gallery: [
      {
        type: String, // Array of image paths
      },
    ],
  },
  {
    _id: false, // No separate _id for subdocument
    timestamps: false,
  }
);

// Schema for our tutors section
const ourTutorsSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      trim: true,
      maxlength: [200, "Our tutors title cannot exceed 200 characters"],
    },
    text: {
      type: String,
      trim: true,
    },
    gallery: [
      {
        type: String, // Array of image paths
      },
    ],
  },
  {
    _id: false, // No separate _id for subdocument
    timestamps: false,
  }
);

const aboutUsSchema = new mongoose.Schema(
  {
    page_title: {
      type: String,
      required: [true, "Page title is required"],
      trim: true,
      maxlength: [200, "Page title cannot exceed 200 characters"],
    },
    page_description: {
      type: String,
      required: [true, "Page description is required"],
      trim: true,
    },
    banner_image: {
      type: String,
      default: null,
    },
    coffee_bar: coffeeBarSchema,
    our_tutors: ourTutorsSchema,
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      default: "about-us",
    },
  },
  {
    timestamps: true,
  }
);

// Create index for slug for better query performance
aboutUsSchema.index({ slug: 1 });

// Create index for page_title for search functionality
aboutUsSchema.index({ page_title: 1 });

const AboutUs = mongoose.model("AboutUs", aboutUsSchema);

export default AboutUs;
