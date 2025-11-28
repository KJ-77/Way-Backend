import mongoose from "mongoose";
import Schedule from "../Modules/Schedule.model.js";

// MongoDB connection string - update this with your actual connection string
const MONGODB_URI = process.env.MONGODB_URI;

async function migrateScheduleStatus() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB");

    // Update all schedules without a status field to "published"
    const result = await Schedule.updateMany(
      { $or: [{ status: { $exists: false } }, { status: null }] },
      { $set: { status: "published", price: 0 } }
    );

    console.log(`✅ Migration complete!`);
    console.log(`   Updated ${result.modifiedCount} schedules to "published" status`);
    console.log(`   Set default price to 0 for schedules without price`);

    // Close connection
    await mongoose.connection.close();
    console.log("Connection closed");
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

// Run migration
migrateScheduleStatus();
