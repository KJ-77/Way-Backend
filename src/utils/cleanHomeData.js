import Home from "../Modules/Home.model.js";

/**
 * Migration script to clean up legacy section fields from existing home documents
 * This removes sectionTitle, sectionSubtitle, sectionText, and sectionItems fields
 */
export const cleanupHomeLegacyFields = async () => {
  try {
    console.log("Starting cleanup of legacy home fields...");

    // Remove legacy section fields from all home documents
    const result = await Home.updateMany(
      {}, // Match all documents
      {
        $unset: {
          sectionTitle: "",
          sectionSubtitle: "",
          sectionText: "",
          sectionItems: "",
        },
      }
    );

    console.log(
      `Cleanup completed. Modified ${result.modifiedCount} documents.`
    );
    return result;
  } catch (error) {
    console.error("Error during home data cleanup:", error);
    throw error;
  }
};

// Run cleanup if this file is executed directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    await cleanupHomeLegacyFields();
    console.log("Migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}
