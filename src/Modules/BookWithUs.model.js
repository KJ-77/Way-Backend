import mongoose from "mongoose";

const bookWithUsSchema = new mongoose.Schema(
  {
    text: {
      type: String,
      required: [true, "BookWithUs text is required"],
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
    slug: {
      type: String,
      required: [true, "Slug is required"],
      unique: [true, "Slug must be unique"],
      trim: true,
      lowercase: true,
    },
  },
  { timestamps: true }
);

bookWithUsSchema.index({ slug: 1 });
bookWithUsSchema.index({ text: 1 });

const BookWithUs = mongoose.model("BookWithUs", bookWithUsSchema);

export default BookWithUs;
