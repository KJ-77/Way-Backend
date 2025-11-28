import Host from "../../Modules/Host.model.js";
import generateSlug from "../../utils/generateSlug.js";
import fs from "fs";
import path from "path";

// Create host
export const createHost = async (text, image) => {
  try {
    const slug = generateSlug(text);

    // Check if slug already exists
    const existingHost = await Host.findOne({ slug });
    if (existingHost) {
      throw new Error("host_slug_exists");
    }

    const hostData = {
      text,
      slug,
    };

    if (image) {
      hostData.image = image;
    }

    const host = new Host(hostData);
    await host.save();

    return host;
  } catch (error) {
    throw error;
  }
};

// Get all hosts
export const getAllHosts = async () => {
  try {
    const hosts = await Host.find().sort({ createdAt: -1 });
    return hosts;
  } catch (error) {
    throw error;
  }
};

// Get host by slug
export const getHostBySlug = async (slug) => {
  try {
    const host = await Host.findOne({ slug });
    if (!host) {
      throw new Error("host_not_found");
    }
    return host;
  } catch (error) {
    throw error;
  }
};

// Update host by slug
export const updateHostBySlug = async (slug, text, image) => {
  try {
    const host = await Host.findOne({ slug });
    if (!host) {
      throw new Error("host_not_found");
    }

    // Store old image path for cleanup
    const oldImagePath = host.image;

    // Update text
    if (text) {
      host.text = text;
      // Generate new slug if text changed
      const newSlug = generateSlug(text);
      if (newSlug !== slug) {
        const existingHost = await Host.findOne({ slug: newSlug });
        if (existingHost) {
          throw new Error("host_slug_exists");
        }
        host.slug = newSlug;
      }
    }

    // Update image if provided
    if (image) {
      host.image = image;
    }

    await host.save();

    // Clean up old image if it was replaced
    if (oldImagePath && image && oldImagePath !== image) {
      try {
        const oldImageFullPath = path.join(
          process.cwd(),
          "uploads",
          oldImagePath
        );
        if (fs.existsSync(oldImageFullPath)) {
          fs.unlinkSync(oldImageFullPath);
        }
      } catch (cleanupError) {
        console.error("Error cleaning up old image:", cleanupError);
      }
    }

    return host;
  } catch (error) {
    throw error;
  }
};

// Delete host by slug
export const deleteHostBySlug = async (slug) => {
  try {
    const host = await Host.findOne({ slug });
    if (!host) {
      throw new Error("host_not_found");
    }

    // Clean up image file if it exists
    if (host.image) {
      try {
        const imagePath = path.join(process.cwd(), "uploads", host.image);
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
        }
      } catch (cleanupError) {
        console.error("Error cleaning up image:", cleanupError);
      }
    }

    await Host.findOneAndDelete({ slug });
    return { message: "Host deleted successfully" };
  } catch (error) {
    throw error;
  }
};
