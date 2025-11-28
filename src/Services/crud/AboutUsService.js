import AboutUs from "../../Modules/AboutUs.model.js";
import generateSlug from "../../utils/generateSlug.js";
import fs from "fs";
import path from "path";

// Create or update about us (since there's typically only one about us page)
export const createOrUpdateAboutUs = async (aboutUsData, files) => {
  try {
    // Look for existing about us document
    let existingAboutUs = await AboutUs.findOne({ slug: "about-us" });

    // Process uploaded banner image
    let bannerImagePath = existingAboutUs?.banner_image || null;
    if (files && files.banner_image) {
      const bannerFile = files.banner_image[0];

      // Delete old banner image if it exists and a new one is uploaded
      if (existingAboutUs?.banner_image) {
        try {
          const oldImagePath = path.join(
            process.cwd(),
            "backend",
            existingAboutUs.banner_image
          );
          if (fs.existsSync(oldImagePath)) {
            fs.unlinkSync(oldImagePath);
          }
        } catch (deleteError) {
          console.error("Error deleting old banner image:", deleteError);
        }
      }

      // Add new banner image
      const relativePath = path
        .relative(path.join(process.cwd(), "backend"), bannerFile.path)
        .replace(/\\/g, "/");
      bannerImagePath = `/${relativePath}`;
    }

    // Process coffee bar gallery images
    const coffeeBarData = aboutUsData.coffee_bar || {};
    if (files && files.coffee_bar_gallery) {
      const galleryImages = files.coffee_bar_gallery.map((file) => {
        const relativePath = path
          .relative(path.join(process.cwd(), "backend"), file.path)
          .replace(/\\/g, "/");
        return `/${relativePath}`;
      });
      coffeeBarData.gallery = galleryImages;
    } else if (existingAboutUs) {
      // Keep existing gallery if no new images uploaded
      coffeeBarData.gallery = existingAboutUs.coffee_bar?.gallery || [];
    }

    // Process our tutors gallery images
    const ourTutorsData = aboutUsData.our_tutors || {};
    if (files && files.our_tutors_gallery) {
      const galleryImages = files.our_tutors_gallery.map((file) => {
        const relativePath = path
          .relative(path.join(process.cwd(), "backend"), file.path)
          .replace(/\\/g, "/");
        return `/${relativePath}`;
      });
      ourTutorsData.gallery = galleryImages;
    } else if (existingAboutUs) {
      // Keep existing gallery if no new images uploaded
      ourTutorsData.gallery = existingAboutUs.our_tutors?.gallery || [];
    }

    const aboutUsObject = {
      page_title: aboutUsData.page_title,
      page_description: aboutUsData.page_description,
      banner_image: bannerImagePath,
      coffee_bar: coffeeBarData,
      our_tutors: ourTutorsData,
      slug: "about-us",
    };

    let aboutUs;
    if (existingAboutUs) {
      // Update existing document
      aboutUs = await AboutUs.findOneAndUpdate(
        { slug: "about-us" },
        aboutUsObject,
        { new: true, runValidators: true }
      );
    } else {
      // Create new document
      aboutUs = new AboutUs(aboutUsObject);
      await aboutUs.save();
    }

    return aboutUs;
  } catch (error) {
    // Clean up uploaded files if creation/update fails
    if (files) {
      Object.values(files).forEach((fileArray) => {
        if (Array.isArray(fileArray)) {
          fileArray.forEach((file) => {
            try {
              if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
              }
            } catch (cleanupError) {
              console.error("Error cleaning up file:", cleanupError);
            }
          });
        }
      });
    }
    throw error;
  }
};

// Get about us data
export const getAboutUs = async () => {
  try {
    const aboutUs = await AboutUs.findOne({ slug: "about-us" }).lean();
    if (!aboutUs) {
      throw new Error("about_us_not_found");
    }
    return aboutUs;
  } catch (error) {
    throw error;
  }
};

// Delete about us (admin only - rarely used)
export const deleteAboutUs = async () => {
  try {
    const aboutUs = await AboutUs.findOne({ slug: "about-us" });
    if (!aboutUs) {
      throw new Error("about_us_not_found");
    }

    // Delete associated banner image
    if (aboutUs.banner_image) {
      try {
        const bannerPath = path.join(
          process.cwd(),
          "backend",
          aboutUs.banner_image
        );
        if (fs.existsSync(bannerPath)) {
          fs.unlinkSync(bannerPath);
        }
      } catch (deleteError) {
        console.error("Error deleting banner image:", deleteError);
      }
    }

    // Delete coffee bar gallery images
    if (aboutUs.coffee_bar?.gallery) {
      aboutUs.coffee_bar.gallery.forEach((imagePath) => {
        try {
          const fullPath = path.join(process.cwd(), "backend", imagePath);
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
          }
        } catch (deleteError) {
          console.error(
            "Error deleting coffee bar gallery image:",
            deleteError
          );
        }
      });
    }

    // Delete our tutors gallery images
    if (aboutUs.our_tutors?.gallery) {
      aboutUs.our_tutors.gallery.forEach((imagePath) => {
        try {
          const fullPath = path.join(process.cwd(), "backend", imagePath);
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
          }
        } catch (deleteError) {
          console.error(
            "Error deleting our tutors gallery image:",
            deleteError
          );
        }
      });
    }

    await AboutUs.findOneAndDelete({ slug: "about-us" });
    return true;
  } catch (error) {
    throw error;
  }
};
