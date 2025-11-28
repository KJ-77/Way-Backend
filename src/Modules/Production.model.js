import mongoose from "mongoose";

const productionSchema = new mongoose.Schema(
  {
    text: {
      type: String,
      required: [true, "Production text is required"],
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

productionSchema.index({ slug: 1 });
productionSchema.index({ text: 1 });

const Production = mongoose.model("Production", productionSchema);

export default Production;
