import {
  createHost,
  getAllHosts,
  getHostBySlug,
  updateHostBySlug,
  deleteHostBySlug,
} from "../Services/crud/HostService.js";

// Create host
export const createHostHandler = async (req, res) => {
  try {
    const { text } = req.body;
    const image = req.file ? req.file.filename : null;

    if (!text) {
      return res.status(400).json({
        success: false,
        message: "Text is required",
      });
    }

    const host = await createHost(text, image);

    return res.status(201).json({
      success: true,
      message: "Host created successfully",
      data: host,
    });
  } catch (error) {
    console.error("Error creating host:", error);

    if (error.message === "host_slug_exists") {
      return res.status(409).json({
        success: false,
        message: "A host with similar text already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// Get all hosts
export const getAllHostsHandler = async (req, res) => {
  try {
    const hosts = await getAllHosts();

    return res.status(200).json({
      success: true,
      message: "Hosts retrieved successfully",
      data: hosts,
    });
  } catch (error) {
    console.error("Error getting hosts:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// Get host by slug
export const getHostBySlugHandler = async (req, res) => {
  try {
    const { slug } = req.params;

    const host = await getHostBySlug(slug);

    return res.status(200).json({
      success: true,
      message: "Host retrieved successfully",
      data: host,
    });
  } catch (error) {
    console.error("Error getting host:", error);

    if (error.message === "host_not_found") {
      return res.status(404).json({
        success: false,
        message: "Host not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// Update host by slug
export const updateHostBySlugHandler = async (req, res) => {
  try {
    const { slug } = req.params;
    const { text } = req.body;
    const image = req.file ? req.file.filename : null;

    if (!text) {
      return res.status(400).json({
        success: false,
        message: "Text is required",
      });
    }

    const host = await updateHostBySlug(slug, text, image);

    return res.status(200).json({
      success: true,
      message: "Host updated successfully",
      data: host,
    });
  } catch (error) {
    console.error("Error updating host:", error);

    if (error.message === "host_not_found") {
      return res.status(404).json({
        success: false,
        message: "Host not found",
      });
    }

    if (error.message === "host_slug_exists") {
      return res.status(409).json({
        success: false,
        message: "A host with similar text already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// Delete host by slug
export const deleteHostBySlugHandler = async (req, res) => {
  try {
    const { slug } = req.params;

    const result = await deleteHostBySlug(slug);

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    console.error("Error deleting host:", error);

    if (error.message === "host_not_found") {
      return res.status(404).json({
        success: false,
        message: "Host not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
