import Production from "../Modules/Production.model.js";

// Create a new Production
export const createProductionHandler = async (req, res) => {
  try {
    const { text, slug } = req.body;
    let images = [];

    if (req.files && req.files.length > 0) {
      images = req.files.map((file) => file.filename);
    }

    if (!text || !slug) {
      return res
        .status(400)
        .json({ success: false, message: "Text and slug are required" });
    }

    // Check for unique slug
    const exists = await Production.findOne({ slug });
    if (exists) {
      return res
        .status(409)
        .json({ success: false, message: "Slug already exists" });
    }

    const production = await Production.create({ text, images, slug });
    res.status(201).json({ success: true, data: production });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};

// Get all Productions
export const getAllProductionsHandler = async (req, res) => {
  try {
    const productions = await Production.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: productions });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};

// Get Production by slug
export const getProductionBySlugHandler = async (req, res) => {
  try {
    const { slug } = req.params;
    const production = await Production.findOne({ slug });
    if (!production) {
      return res
        .status(404)
        .json({ success: false, message: "Production not found" });
    }
    res.status(200).json({ success: true, data: production });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};

// Update Production by slug
export const updateProductionBySlugHandler = async (req, res) => {
  try {
    const { slug } = req.params;
    const { text } = req.body;
    let images;

    if (req.files && req.files.length > 0) {
      images = req.files.map((file) => file.filename);
    }

    const updateData = {};
    if (text) updateData.text = text;
    if (images) updateData.images = images;

    const updated = await Production.findOneAndUpdate({ slug }, updateData, {
      new: true,
    });
    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: "Production not found" });
    }
    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};

// Delete Production by slug
export const deleteProductionBySlugHandler = async (req, res) => {
  try {
    const { slug } = req.params;
    const deleted = await Production.findOneAndDelete({ slug });
    if (!deleted) {
      return res
        .status(404)
        .json({ success: false, message: "Production not found" });
    }
    res.status(200).json({ success: true, message: "Production deleted" });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};
