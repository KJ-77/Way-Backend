import Home from "../../Modules/Home.model.js";
import AboutUs from "../../Modules/AboutUs.model.js";
import generateSlug from "../../utils/generateSlug.js";
import fs from "fs";
import path from "path";

// Create a new home
export const createHome = async (homeData, file) => {
  try {
    // Generate slug from title
    const slug = generateSlug(homeData.title);

    // Check if slug already exists
    const existingHome = await Home.findOne({ slug });
    if (existingHome) {
      throw new Error("home_slug_exists");
    }

    // Process uploaded video
    let videoPath = null;

    if (file) {
      // Store relative path from uploads directory
      const relativePath = path
        .relative(path.join(process.cwd(), "backend"), file.path)
        .replace(/\\/g, "/");
      videoPath = `/${relativePath}`;
    }

    // Create home data object
    const homeObject = {
      title: homeData.title,
      text: homeData.text,
      video: videoPath,
      slug,
    };

    // Create home with generated slug
    const home = new Home(homeObject);

    await home.save();
    return home;
  } catch (error) {
    // Clean up uploaded file if home creation fails
    if (file) {
      try {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      } catch (cleanupError) {
        console.error("Error cleaning up video file:", cleanupError);
      }
    }
    throw error;
  }
};

// Get all homes with pagination
export const getAllHomes = async (options = {}) => {
  try {
    const {
      page = 1,
      limit = 10,
      sort = { createdAt: -1 },
      search = "",
    } = options;
    const skip = (page - 1) * limit;

    // Build search query
    let query = {};
    if (search) {
      query = {
        $or: [
          { title: { $regex: search, $options: "i" } },
          { text: { $regex: search, $options: "i" } },
          { slug: { $regex: search, $options: "i" } },
        ],
      };
    }

    const homes = await Home.find(query)
      .select("title text video slug createdAt updatedAt") // Only select allowed fields
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Home.countDocuments(query);

    // Also get About Us data for the first home (if this is page 1)
    let aboutUs = null;
    if (page === 1 && homes.length > 0) {
      try {
        aboutUs = await AboutUs.findOne({ slug: "about-us" }).lean();
      } catch (aboutUsError) {
        console.warn(
          "About Us not found, continuing without it:",
          aboutUsError.message
        );
      }
    }

    return {
      homes,
      aboutUs, // Include About Us data only on first page
      pagination: {
        current: page,
        total: Math.ceil(total / limit),
        count: homes.length,
        totalDocuments: total,
      },
    };
  } catch (error) {
    throw error;
  }
};

// Get home by slug with About Us data
export const getHomeBySlug = async (slug) => {
  try {
    const home = await Home.findOne({ slug })
      .select("title text video slug createdAt updatedAt") // Only select allowed fields
      .lean();
    if (!home) {
      throw new Error("home_not_found");
    }

    // Also get About Us data
    let aboutUs = null;
    try {
      aboutUs = await AboutUs.findOne({ slug: "about-us" }).lean();
    } catch (aboutUsError) {
      console.warn(
        "About Us not found, continuing without it:",
        aboutUsError.message
      );
    }

    return {
      home,
      aboutUs,
    };
  } catch (error) {
    throw error;
  }
};

// Update home by slug
export const updateHomeBySlug = async (slug, homeData, file) => {
  try {
    const existingHome = await Home.findOne({ slug });
    if (!existingHome) {
      throw new Error("home_not_found");
    }

    // Generate new slug if title changed
    let newSlug = slug;
    if (homeData.title && homeData.title !== existingHome.title) {
      newSlug = generateSlug(homeData.title);

      // Check if new slug already exists (and it's not the same document)
      const slugExists = await Home.findOne({
        slug: newSlug,
        _id: { $ne: existingHome._id },
      });

      if (slugExists) {
        throw new Error("home_slug_exists");
      }
    }

    // Process new uploaded video
    let videoPath = existingHome.video; // Keep existing video by default

    if (file) {
      // Delete old video if exists
      if (existingHome.video) {
        try {
          const oldVideoPath = path.join(
            process.cwd(),
            "backend",
            existingHome.video
          );
          if (fs.existsSync(oldVideoPath)) {
            fs.unlinkSync(oldVideoPath);
          }
        } catch (deleteError) {
          console.error("Error deleting old video:", deleteError);
        }
      }

      // Add new video
      const relativePath = path
        .relative(path.join(process.cwd(), "backend"), file.path)
        .replace(/\\/g, "/");
      videoPath = `/${relativePath}`;
    }

    const updateObject = {
      title: homeData.title || existingHome.title,
      text: homeData.text || existingHome.text,
      video: videoPath,
      slug: newSlug,
    };

    // Also remove any legacy section fields if they exist
    const unsetObject = {
      sectionTitle: "",
      sectionSubtitle: "",
      sectionText: "",
      sectionItems: "",
    };

    const updatedHome = await Home.findOneAndUpdate(
      { slug },
      {
        $set: updateObject,
        $unset: unsetObject,
      },
      {
        new: true,
        runValidators: true,
      }
    ).select("title text video slug createdAt updatedAt"); // Only return allowed fields

    return updatedHome;
  } catch (error) {
    // Clean up uploaded file if update fails
    if (file) {
      try {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      } catch (cleanupError) {
        console.error("Error cleaning up file:", cleanupError);
      }
    }
    throw error;
  }
};

// Delete home by slug
export const deleteHomeBySlug = async (slug) => {
  try {
    const home = await Home.findOne({ slug });
    if (!home) {
      throw new Error("home_not_found");
    }

    // Delete associated video
    if (home.video) {
      try {
        const videoPath = path.join(process.cwd(), "backend", home.video);
        if (fs.existsSync(videoPath)) {
          fs.unlinkSync(videoPath);
        }
      } catch (deleteError) {
        console.error("Error deleting video:", deleteError);
      }
    }

    await Home.findOneAndDelete({ slug });
    return true;
  } catch (error) {
    throw error;
  }
};
