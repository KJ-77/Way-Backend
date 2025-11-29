import dotenv from "dotenv";
import mongoose from "mongoose";
import Admin, { ADMIN_ROLES } from "../Modules/Admin.model.js";
import { createAdmin } from "../Services/crud/AdminAuthService.js";

dotenv.config();

const createInitialSuperAdmin = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(
      process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true }
    );
    console.log("Connected to MongoDB");

    // Check if super admin already exists
    const existingSuperAdmin = await Admin.findOne({
      role: ADMIN_ROLES.SUPER_ADMIN,
    });

    if (existingSuperAdmin) {
      console.log("Super admin already exists:", existingSuperAdmin.email);
      return;
    }

    // Create initial super admin
    const superAdminData = {
      fullName: "Super Admin",
      email: process.env.ADMIN_EMAIL, // Change this to your desired email
      password: "password123", // Plain password - will be hashed by service
      phoneNumber: "+1234567890",
      role: ADMIN_ROLES.SUPER_ADMIN,
      active: true,
    };

    const superAdmin = await createAdmin(superAdminData);

    console.log("✅ Super admin created successfully!");
    console.log("Email:", superAdmin.email);
    console.log("Password: password123"); // Remember to change this
    console.log("Role:", superAdmin.role);
    console.log("⚠️  Please change the default password after first login!");
  } catch (error) {
    console.error("❌ Error creating super admin:", error);
  } finally {
    // Close the connection
    await mongoose.connection.close();
    console.log("Database connection closed");
  }
};

// Run the function if this file is executed directly
// if (import.meta.url === `file://${process.argv[1]}`) {
//   createInitialSuperAdmin();
// }

createInitialSuperAdmin()
  .then(() => {
    console.log("Script completed");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Script failed:", err);
    process.exit(1);
  });

export default createInitialSuperAdmin;
