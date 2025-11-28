import {
  createOrUpdateAboutUs,
  getAboutUs,
  deleteAboutUs,
} from "../Services/crud/AboutUsService.js";

// Create or update about us
export const createOrUpdateAboutUsController = async (req, res) => {
  try {
    const {
      page_title,
      page_description,
      coffee_bar_title,
      coffee_bar_text,
      our_tutors_title,
      our_tutors_text,
    } = req.body;

    // Validate required fields
    if (!page_title || page_title.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Page title is required",
        data: null,
      });
    }

    if (!page_description || page_description.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Page description is required",
        data: null,
      });
    }

    // Prepare about us data
    const aboutUsData = {
      page_title: page_title.trim(),
      page_description: page_description.trim(),
      coffee_bar: {
        title: coffee_bar_title?.trim() || "",
        text: coffee_bar_text?.trim() || "",
      },
      our_tutors: {
        title: our_tutors_title?.trim() || "",
        text: our_tutors_text?.trim() || "",
      },
    };

    // Create or update about us with uploaded files
    const aboutUs = await createOrUpdateAboutUs(aboutUsData, req.files);

    res.status(200).json({
      status: 200,
      success: true,
      message: "About Us updated successfully",
      data: aboutUs,
    });
  } catch (error) {
    console.error("Create/Update about us error:", error);

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while updating the about us page",
      data: null,
    });
  }
};

// Get about us data
export const getAboutUsController = async (req, res) => {
  try {
    const aboutUs = await getAboutUs();

    res.status(200).json({
      status: 200,
      success: true,
      message: "About Us retrieved successfully",
      data: aboutUs,
    });
  } catch (error) {
    console.error("Get about us error:", error);

    if (error.message === "about_us_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "About Us page not found",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while retrieving the about us page",
      data: null,
    });
  }
};

// Delete about us (Admin only)
export const deleteAboutUsController = async (req, res) => {
  try {
    await deleteAboutUs();

    res.status(200).json({
      status: 200,
      success: true,
      message: "About Us deleted successfully",
      data: null,
    });
  } catch (error) {
    console.error("Delete about us error:", error);

    if (error.message === "about_us_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "About Us page not found",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while deleting the about us page",
      data: null,
    });
  }
};
