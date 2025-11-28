import {
  createHome,
  updateHomeBySlug,
  deleteHomeBySlug,
  getAllHomes,
  getHomeBySlug,
} from "../Services/crud/HomeService.js";
import { cleanupHomeLegacyFields } from "../utils/cleanHomeData.js";

// Create a new home
export const createHomeController = async (req, res) => {
  try {
    const { title, text } = req.body;

    // Validate required fields
    if (!title || title.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Home title is required",
        data: null,
      });
    }

    if (!text || text.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Home text is required",
        data: null,
      });
    }

    // Create home with uploaded file
    const home = await createHome(
      {
        title: title.trim(),
        text: text.trim(),
      },
      req.file
    );

    res.status(201).json({
      status: 201,
      success: true,
      message: "Home created successfully",
      data: home,
    });
  } catch (error) {
    console.error("Create home error:", error);

    if (error.message === "home_slug_exists") {
      return res.status(409).json({
        status: 409,
        success: false,
        message: "A home with similar title already exists",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while creating the home",
      data: null,
    });
  }
};

// Get all homes with pagination
export const getAllHomesController = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const sort = req.query.sort || "createdAt";
    const order = req.query.order === "asc" ? 1 : -1;

    const options = {
      page,
      limit,
      search,
      sort: { [sort]: order },
    };

    const result = await getAllHomes(options);

    res.status(200).json({
      status: 200,
      success: true,
      message: "Homes and About Us retrieved successfully",
      results: result.homes.length,
      pagination: result.pagination,
      data: result.homes,
      aboutUs: result.aboutUs, // Include About Us data
    });
  } catch (error) {
    console.error("Get all homes error:", error);

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while retrieving homes",
      data: null,
    });
  }
};

// Get home by slug
export const getHomeBySlugController = async (req, res) => {
  try {
    const { slug } = req.params;

    if (!slug) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Home slug is required",
        data: null,
      });
    }

    const result = await getHomeBySlug(slug);

    res.status(200).json({
      status: 200,
      success: true,
      message: "Home and About Us retrieved successfully",
      data: result.home,
      aboutUs: result.aboutUs,
    });
  } catch (error) {
    console.error("Get home by slug error:", error);

    if (error.message === "home_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Home not found",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while retrieving the home",
      data: null,
    });
  }
};

// Update home by slug
export const updateHomeBySlugController = async (req, res) => {
  try {
    const { slug } = req.params;
    const { title, text } = req.body;

    if (!slug) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Home slug is required",
        data: null,
      });
    }

    // Validate title if provided
    if (title && title.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Home title cannot be empty",
        data: null,
      });
    }

    // Validate text if provided
    if (text && text.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Home text cannot be empty",
        data: null,
      });
    }

    const updateData = {};
    if (title) {
      updateData.title = title.trim();
    }
    if (text) {
      updateData.text = text.trim();
    }

    const updatedHome = await updateHomeBySlug(slug, updateData, req.file);

    res.status(200).json({
      status: 200,
      success: true,
      message: "Home updated successfully",
      data: updatedHome,
    });
  } catch (error) {
    console.error("Update home error:", error);

    if (error.message === "home_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Home not found",
        data: null,
      });
    }

    if (error.message === "home_slug_exists") {
      return res.status(409).json({
        status: 409,
        success: false,
        message: "A home with similar title already exists",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while updating the home",
      data: null,
    });
  }
};

// Delete home by slug
export const deleteHomeBySlugController = async (req, res) => {
  try {
    const { slug } = req.params;

    if (!slug) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Home slug is required",
        data: null,
      });
    }

    await deleteHomeBySlug(slug);

    res.status(200).json({
      status: 200,
      success: true,
      message: "Home deleted successfully",
      data: null,
    });
  } catch (error) {
    console.error("Delete home error:", error);

    if (error.message === "home_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Home not found",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while deleting the home",
      data: null,
    });
  }
};

// Cleanup legacy home data (Admin only)
export const cleanupHomeLegacyDataController = async (req, res) => {
  try {
    const result = await cleanupHomeLegacyFields();

    res.status(200).json({
      status: 200,
      success: true,
      message: "Home data cleanup completed successfully",
      data: {
        modifiedCount: result.modifiedCount,
        matchedCount: result.matchedCount,
      },
    });
  } catch (error) {
    console.error("Cleanup home data error:", error);

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred during home data cleanup",
      data: null,
    });
  }
};
