import mongoose from "mongoose";
import bcrypt from "bcrypt";

const tutorSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Tutor name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        "Please provide a valid email address",
      ],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters long"],
      select: false, // Don't include password in query results by default
    },
    bio: {
      type: String,
      required: [true, "Tutor bio is required"],
      trim: true,
    },
    description: {
      type: String,
      required: [true, "Tutor description is required"],
      trim: true,
    },
    schedules: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Schedule",
      },
    ],
    avatar: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

// Password hashing middleware
tutorSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password for login
tutorSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

const Tutor = mongoose.model("Tutor", tutorSchema);

export default Tutor;
