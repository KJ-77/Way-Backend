import BookWithUs from "../Modules/BookWithUs.model.js";

// Create a new BookWithUs
export const createBookWithUsHandler = async (req, res) => {
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
    const exists = await BookWithUs.findOne({ slug });
    if (exists) {
      return res
        .status(409)
        .json({ success: false, message: "Slug already exists" });
    }

    const bookWithUs = await BookWithUs.create({ text, images, slug });
    res.status(201).json({ success: true, data: bookWithUs });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};

// Get all BookWithUs
export const getAllBookWithUsHandler = async (req, res) => {
  try {
    const bookWithUsList = await BookWithUs.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: bookWithUsList });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};

// Get BookWithUs by slug
export const getBookWithUsBySlugHandler = async (req, res) => {
  try {
    const { slug } = req.params;
    const bookWithUs = await BookWithUs.findOne({ slug });
    if (!bookWithUs) {
      return res
        .status(404)
        .json({ success: false, message: "BookWithUs not found" });
    }
    res.status(200).json({ success: true, data: bookWithUs });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};

// Update BookWithUs by slug
export const updateBookWithUsBySlugHandler = async (req, res) => {
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

    const updated = await BookWithUs.findOneAndUpdate({ slug }, updateData, {
      new: true,
    });
    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: "BookWithUs not found" });
    }
    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};

// Delete BookWithUs by slug
export const deleteBookWithUsBySlugHandler = async (req, res) => {
  try {
    const { slug } = req.params;
    const deleted = await BookWithUs.findOneAndDelete({ slug });
    if (!deleted) {
      return res
        .status(404)
        .json({ success: false, message: "BookWithUs not found" });
    }
    res.status(200).json({ success: true, message: "BookWithUs deleted" });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};
