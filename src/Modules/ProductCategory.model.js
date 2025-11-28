import mongoose from "mongoose";
import slugify from "slugify";

const ProductCategorySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Category title is required"],
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Create slug from title before saving
ProductCategorySchema.pre("save", function (next) {
  if (this.title) {
    this.slug = slugify(this.title, { lower: true });
  }
  next();
});

// Virtual for products
ProductCategorySchema.virtual("products", {
  ref: "Product",
  foreignField: "category",
  localField: "_id",
});

const ProductCategory = mongoose.model(
  "ProductCategory",
  ProductCategorySchema
);

export default ProductCategory;
