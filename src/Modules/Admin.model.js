import mongoose from "mongoose";
import bcrypt from "bcrypt";

// Define role constants (enum)
export const ADMIN_ROLES = {
  SUPER_ADMIN: "super_admin",
  ADMIN: "admin",
  READ_ONLY: "read_only",
};

// Define permission schema for better organization
const permissionSchema = new mongoose.Schema(
  {
    users: {
      read: { type: Boolean, default: false },
      write: { type: Boolean, default: false },
    },
    adminManagement: {
      read: { type: Boolean, default: false },
      write: { type: Boolean, default: false },
    },
    // Add more permissions as needed for your application
  },
  { _id: false }
);

const adminSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: [true, "Email already exists"],
      trim: true,
      lowercase: true,
      validate: {
        validator: function (v) {
          return /^\S+@\S+\.\S+$/.test(v);
        },
        message: "Please enter a valid email",
      },
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      trim: true,
      select: false,
    },
    phoneNumber: {
      type: String,
      trim: true,
    },
    role: {
      type: String,
      enum: Object.values(ADMIN_ROLES),
      default: ADMIN_ROLES.READ_ONLY,
      required: true,
    },
    permissions: {
      type: permissionSchema,
      default: () => ({}),
    },
    failedLoginAttempts: {
      type: Number,
      default: 0,
    },
    accountLocked: {
      type: Boolean,
      default: false,
    },
    accountLockedUntil: {
      type: Date,
      default: null,
    },
    lastLogin: {
      type: Date,
      default: null,
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Password hashing middleware
adminSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Pre-save hook to set permissions based on role
adminSchema.pre("save", function (next) {
  // If role was changed or permissions are empty, set default permissions for the role
  if (this.isModified("role") || !this.permissions) {
    switch (this.role) {
      case ADMIN_ROLES.SUPER_ADMIN:
        this.permissions = {
          users: { read: true, write: true },
          adminManagement: { read: true, write: true },
        };
        break;
      case ADMIN_ROLES.ADMIN:
        this.permissions = {
          users: { read: true, write: true },
          adminManagement: { read: false, write: false },
        };
        break;
      case ADMIN_ROLES.READ_ONLY:
        this.permissions = {
          users: { read: true, write: false },
          adminManagement: { read: false, write: false },
        };
        break;
    }
  }
  next();
});

// Method to check if admin has specific permission
adminSchema.methods.hasPermission = function (resource, action) {
  return (
    this.permissions &&
    this.permissions[resource] &&
    this.permissions[resource][action] === true
  );
};

// Method to check if admin is super admin
adminSchema.methods.isSuperAdmin = function () {
  return this.role === ADMIN_ROLES.SUPER_ADMIN;
};

// Method to compare password for login
adminSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

const Admin = mongoose.model("Admin", adminSchema);

export default Admin;
