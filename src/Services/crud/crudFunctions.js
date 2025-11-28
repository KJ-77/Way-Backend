// Function to create a document with a model
export const createOne = (Model) => async (req, res, next) => {
  try {
    const doc = await Model.create(req.body);
    res.status(201).json({
      status: 201,
      success: true,
      message: "Document created successfully",
      data: doc,
    });
  } catch (error) {
    console.error("Error creating document:", error);
    next(error);
  }
};

// Function to get all documents with optional filtering
export const getAll = (Model) => async (req, res, next) => {
  try {
    // Ensure filter is an object, not a function
    const filter = typeof req.filter === "function" ? {} : req.filter || {};
    const sort = req.sort || { createdAt: -1 };
    const limit = req.limit || 100;
    const skip = req.skip || 0;
    const projection = req.projection || "";

    console.log("Getting documents with filter:", filter);

    const docs = await Model.find(filter)
      .sort(sort)
      .limit(limit)
      .skip(skip)
      .select(projection)
      .lean()
      .exec();

    // Transform image object to path string in the response
    const transformedDocs = docs.map((doc) => {
      try {
        if (doc.image && doc.image.data) {
          doc.image = encodeURI(doc.image.data);
        }
        if (doc.pdf && doc.pdf.data) {
          doc.pdf.data = encodeURI(doc.pdf.data);
        }
        return doc;
      } catch (error) {
        console.error("Error transforming document:", error);
        return doc;
      }
    });

    res.status(200).json({
      status: 200,
      success: true,
      message: "Documents retrieved successfully",
      results: docs.length,
      data: transformedDocs,
    });
  } catch (error) {
    console.error("Error getting documents:", error);
    next(error);
  }
};

// Function to get one document by slug
export const getOne = (Model) => async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const projection = req.projection || "";

    const doc = await Model.findOne({ slug }).select(projection).lean().exec();

    if (!doc) {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Document not found",
        data: null,
      });
    }

    // Transform image object to path string in the response
    try {
      if (doc.image && doc.image.data) {
        doc.image = encodeURI(doc.image.data);
      }
      if (doc.pdf && doc.pdf.data) {
        doc.pdf.data = encodeURI(doc.pdf.data);
      }
    } catch (error) {
      console.error("Error transforming document:", error);
    }

    res.status(200).json({
      status: 200,
      success: true,
      message: "Document retrieved successfully",
      data: doc,
    });
  } catch (error) {
    console.error("Error getting document:", error);
    next(error);
  }
};

// Function to delete one document by slug
export const deleteOne = (Model) => async (req, res, next) => {
  try {
    const slug = req.params.slug;

    const deletedDoc = await Model.findOneAndDelete({ slug }).exec();

    if (!deletedDoc) {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Document not found",
        data: null,
      });
    }

    res.status(200).json({
      status: 200,
      success: true,
      message: "Document deleted successfully",
      data: null,
    });
  } catch (error) {
    console.error("Error deleting document:", error);
    next(error);
  }
};

// Function to get all documents by category slug
export const getByCategorySlug = (Model, CategoryModel) => async (req, res) => {
  try {
    const slug = req.params.slug;
    const projection = req.projection || "";

    // First, find the category by slug
    const category = await CategoryModel.findOne({ slug }).exec();

    if (!category) {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Category not found",
        data: null,
      });
    }

    // Now find all documents with that category ID
    const docs = await Model.find({ category: category.slug })
      .select(projection)
      .exec();

    res.status(200).json({
      status: 200,
      success: true,
      message: "Documents retrieved successfully",
      results: docs.length,
      data: docs,
    });
  } catch (error) {
    console.error("Error getting documents by category:", error);
    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while retrieving documents",
      data: error.message,
    });
  }
};

// Function to create a document with file upload
export const createOneWithFile = (Model) => async (req, res) => {
  try {
    // Extract basic fields from request body
    const { ...basicFields } = req.body;

    // Initialize document data object
    const documentData = { ...basicFields };

    // Process nested objects if needed
    const nestedFields = {};

    Object.keys(req.body).forEach((key) => {
      if (key.includes(".")) {
        const [parent, child] = key.split(".");
        if (!nestedFields[parent]) {
          nestedFields[parent] = {};
        }
        nestedFields[parent][child] = req.body[key];
      }
    });

    // Initialize nested objects in documentData first
    Object.keys(nestedFields).forEach((key) => {
      // Make sure we create the parent object if it doesn't exist yet
      if (!documentData[key]) {
        documentData[key] = {};
      }
    });

    // Merge nested fields into document data
    Object.keys(nestedFields).forEach((key) => {
      // Using key-by-key assignment to avoid conflicts
      Object.keys(nestedFields[key]).forEach((childKey) => {
        documentData[key][childKey] = nestedFields[key][childKey];
      });
    });

    // Handle videoTrailer data (if present)
    // First check the new field name format (videoTrailerJSON)
    if (req.body.videoTrailerJSON) {
      try {
        // Log the received videoTrailer data for debugging
        console.log(
          "Received videoTrailerJSON data (create):",
          req.body.videoTrailerJSON
        );

        // Check if it's null or empty
        if (
          req.body.videoTrailerJSON === "null" ||
          req.body.videoTrailerJSON === ""
        ) {
          console.log("Not adding videoTrailer field to new document");
          // Don't add the field at all for new documents
        } else {
          // Try to parse it as JSON
          documentData.videoTrailer = JSON.parse(req.body.videoTrailerJSON);
          console.log(
            "Parsed videoTrailer object (create):",
            documentData.videoTrailer
          );
        }
      } catch (err) {
        console.error("Error parsing videoTrailerJSON:", err);
      }
    }
    // Fall back to the original field name for backward compatibility
    else if (req.body.videoTrailer !== undefined) {
      try {
        // Log the received videoTrailer data for debugging
        console.log(
          "Received videoTrailer data (create):",
          req.body.videoTrailer
        );

        // Check if it's null or empty
        if (
          req.body.videoTrailer === null ||
          req.body.videoTrailer === "null" ||
          req.body.videoTrailer === ""
        ) {
          console.log("Not adding videoTrailer field to new document");
          // Don't add the field at all for new documents
        }
        // If it's already an object, use it directly
        else if (typeof req.body.videoTrailer === "object") {
          documentData.videoTrailer = req.body.videoTrailer;
          console.log(
            "Parsed videoTrailer object (create):",
            documentData.videoTrailer
          );
        } else {
          // Otherwise try to parse it as JSON
          documentData.videoTrailer = JSON.parse(req.body.videoTrailer);
          console.log(
            "Parsed videoTrailer object (create):",
            documentData.videoTrailer
          );
        }
      } catch (err) {
        console.error("Error parsing videoTrailer JSON:", err);
      }
    }

    // Handle file uploads - check for both single file and multiple files
    if (req.files) {
      // Handle multiple file uploads (image and pdf)
      if (req.files.image && req.files.image[0]) {
        const file = req.files.image[0];
        const filename = file.filename || file.originalname;
        const relativePath = `uploads/${filename}`;

        documentData.image = {
          data: relativePath,
          contentType: file.mimetype,
          filename: file.originalname,
        };
      }

      // Add PDF file data if uploaded
      if (req.files.pdf && req.files.pdf[0]) {
        const file = req.files.pdf[0];
        const filename = file.filename || file.originalname;
        const relativePath = `uploads/${filename}`;

        documentData.pdf = {
          data: relativePath,
          contentType: file.mimetype,
          filename: file.originalname,
        };
      }
    } else if (req.file) {
      // Single file upload (backward compatibility)
      const filename = req.file.filename || req.file.originalname;
      const relativePath = `uploads/${filename}`;

      documentData.image = {
        data: relativePath,
        contentType: req.file.mimetype,
        filename: req.file.originalname,
      };
    }

    // Create the document with all data
    const doc = await Model.create(documentData);

    res.status(201).json({
      status: 201,
      success: true,
      message: "Document created successfully",
      data: doc,
    });
  } catch (error) {
    console.error("Error creating document:", error);
    if (error.code === 11000) {
      // MongoDB duplicate key error
      return res.status(409).json({
        status: 409,
        success: false,
        message: "Duplicate entry. This resource already exists.",
        data: null,
      });
    }

    // Validation errors
    if (error.name === "ValidationError") {
      const validationErrors = Object.values(error.errors).map(
        (err) => err.message
      );
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Validation error",
        data: validationErrors,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while creating the document",
      data: null,
    });
  }
};

// Function to update one document with file upload
export const updateOneWithFile = (Model) => async (req, res) => {
  try {
    const slug = req.params.slug;

    // Extract basic fields from request body
    const updateData = {};
    Object.keys(req.body).forEach((key) => {
      if (!key.includes(".")) {
        updateData[key] = req.body[key];
      }
    });

    // Process nested objects separately
    const nestedFields = {};
    Object.keys(req.body).forEach((key) => {
      if (key.includes(".")) {
        const [parent, child] = key.split(".");
        if (!nestedFields[parent]) {
          nestedFields[parent] = {};
        }
        nestedFields[parent][child] = req.body[key];
      }
    });

    // Add nested objects to update data
    Object.keys(nestedFields).forEach((key) => {
      updateData[key] = nestedFields[key];
    });

    // Convert numeric fields if needed
    if (req.body.price) {
      updateData.price = Number(req.body.price);
    }

    // Handle multiple file uploads (image and pdf)
    if (req.files) {
      // Add image data if image was uploaded
      if (req.files.image && req.files.image[0]) {
        const file = req.files.image[0];
        const relativePath = `uploads/${file.filename}`;
        updateData.image = {
          data: relativePath,
          contentType: file.mimetype,
          filename: file.originalname,
        };
      }

      // Add PDF data if PDF was uploaded
      if (req.files.pdf && req.files.pdf[0]) {
        const file = req.files.pdf[0];
        const relativePath = `uploads/${file.filename}`;
        updateData.pdf = {
          data: relativePath,
          contentType: file.mimetype,
          filename: file.originalname,
        };
      }
    } else if (req.file) {
      // For backward compatibility with single file upload
      const relativePath = `uploads/${req.file.filename}`;
      updateData.image = {
        data: relativePath,
        contentType: req.file.mimetype,
        filename: req.file.originalname,
      };
    }

    console.log("Update data being applied:", updateData);

    const updatedDoc = await Model.findOneAndUpdate({ slug }, updateData, {
      new: true,
      runValidators: true,
    });

    if (!updatedDoc) {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Document not found",
        data: null,
      });
    }

    res.status(200).json({
      status: 200,
      success: true,
      message: "Document updated successfully",
      data: updatedDoc,
    });
  } catch (error) {
    console.error("Error updating document:", error);

    if (error.name === "ValidationError") {
      const validationErrors = Object.values(error.errors).map(
        (err) => err.message
      );
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Validation error",
        data: validationErrors,
      });
    }

    if (error.code === 11000) {
      return res.status(409).json({
        status: 409,
        success: false,
        message: "Duplicate entry. This value already exists.",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while updating the document",
      data: null,
    });
  }
};

// Function to update one document by slug
export const updateOne = (Model) => async (req, res) => {
  try {
    const slug = req.params.slug;

    const updatedDoc = await Model.findOneAndUpdate({ slug }, req.body, {
      new: true,
      runValidators: true,
    }).exec();

    if (!updatedDoc) {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Document not found",
        data: null,
      });
    }

    res.status(200).json({
      status: 200,
      success: true,
      message: "Document updated successfully",
      data: updatedDoc,
    });
  } catch (error) {
    console.error("Error updating document:", error);

    // Handle validation errors
    if (error.name === "ValidationError") {
      const validationErrors = Object.values(error.errors).map(
        (err) => err.message
      );
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Validation error",
        data: validationErrors,
      });
    }

    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(409).json({
        status: 409,
        success: false,
        message: "Duplicate entry. This value already exists.",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while updating the document",
      data: null,
    });
  }
};

// Function to update one document with proper slug handling
export const updateOneWithSlug =
  (Model, options = {}) =>
  async (req, res) => {
    try {
      const oldSlug = req.params.slug;

      // Find document by old slug
      const doc = await Model.findOne({ slug: oldSlug });

      if (!doc) {
        return res.status(404).json({
          status: 404,
          success: false,
          message: options.notFoundMessage || "Document not found",
          data: null,
        });
      }

      // Apply updates to the document (this approach triggers pre-save hooks)
      Object.keys(req.body).forEach((key) => {
        if (!key.includes(".")) {
          doc[key] = req.body[key];
        }
      });

      // Process nested objects
      const nestedFields = {};
      Object.keys(req.body).forEach((key) => {
        if (key.includes(".")) {
          const [parent, child] = key.split(".");
          if (!nestedFields[parent]) {
            nestedFields[parent] = {};
          }
          nestedFields[parent][child] = req.body[key];
        }
      });

      // Apply nested fields
      Object.keys(nestedFields).forEach((key) => {
        if (!doc[key]) {
          doc[key] = {};
        }
        Object.keys(nestedFields[key]).forEach((childKey) => {
          doc[key][childKey] = nestedFields[key][childKey];
        });
      });

      // Save document to trigger pre-save hooks (like slug generation)
      await doc.save();

      // Handle related document updates if slug has changed
      if (doc.slug !== oldSlug && options.updateRelated) {
        await options.updateRelated(oldSlug, doc.slug);
      }

      // Check if we should populate any fields in the response
      let result = doc;
      if (options.populate) {
        result = await Model.findOne({ _id: doc._id }).populate(
          options.populate
        );
      }

      res.status(200).json({
        status: 200,
        success: true,
        message: options.successMessage || "Document updated successfully",
        data: result,
      });
    } catch (error) {
      console.error(`Error updating document: ${error}`);

      // Handle validation errors
      if (error.name === "ValidationError") {
        const validationErrors = Object.values(error.errors).map(
          (err) => err.message
        );
        return res.status(400).json({
          status: 400,
          success: false,
          message: "Validation error",
          data: validationErrors,
        });
      }

      // Handle duplicate key error
      if (error.code === 11000) {
        return res.status(409).json({
          status: 409,
          success: false,
          message: "Duplicate entry. This value already exists.",
          data: null,
        });
      }

      res.status(500).json({
        status: 500,
        success: false,
        message: "An error occurred while updating the document",
        data: null,
      });
    }
  };

// Function to update one document with file upload and proper slug handling
export const updateOneWithFileAndSlug =
  (Model, options = {}) =>
  async (req, res) => {
    try {
      const slug = req.params.slug;

      // Find the existing document
      let doc = await Model.findOne({ slug }).exec();

      if (!doc) {
        return res.status(404).json({
          status: 404,
          success: false,
          message: "Document not found",
          data: null,
        });
      }

      // Process basic fields (non-nested)
      Object.keys(req.body).forEach((key) => {
        if (
          !key.includes(".") &&
          key !== "videoTrailerJSON" &&
          key !== "videoTrailer"
        ) {
          doc[key] = req.body[key];
        }
      });

      // Process nested fields - collect them first
      const nestedFields = {};
      Object.keys(req.body).forEach((key) => {
        if (key.includes(".")) {
          const [parent, child] = key.split(".");
          if (!nestedFields[parent]) {
            nestedFields[parent] = {};
          }
          nestedFields[parent][child] = req.body[key];
        }
      });

      // Apply nested fields directly to document
      Object.keys(nestedFields).forEach((parent) => {
        if (!doc[parent]) {
          doc[parent] = {};
        }
        Object.keys(nestedFields[parent]).forEach((child) => {
          doc[parent][child] = nestedFields[parent][child];
        });
      });

      // Handle videoTrailer data (if present)
      // First check the new field name format (videoTrailerJSON)
      if (req.body.videoTrailerJSON) {
        try {
          // Log the received videoTrailer data for debugging
          console.log(
            "Received videoTrailerJSON data:",
            req.body.videoTrailerJSON
          );

          // Check if it's a string that represents null (from FormData)
          if (
            req.body.videoTrailerJSON === "null" ||
            req.body.videoTrailerJSON === ""
          ) {
            console.log("Removing videoTrailer field from document");
            // Use both approaches to ensure the field is removed
            doc.videoTrailer = undefined;
            delete doc.videoTrailer;

            // Log document after change
            console.log(
              "Document after videoTrailer removal (has videoTrailer?):",
              doc.hasOwnProperty("videoTrailer")
            );
          } else {
            // Try to parse it as JSON
            doc.videoTrailer = JSON.parse(req.body.videoTrailerJSON);
          }

          console.log("Updated document videoTrailer field:", doc.videoTrailer);
        } catch (err) {
          console.error("Error parsing videoTrailerJSON:", err);
        }
      }
      // Fall back to the original field name for backward compatibility
      else if (req.body.videoTrailer !== undefined) {
        try {
          console.log("Received videoTrailer data:", req.body.videoTrailer);

          // Check if it's null or an empty string
          if (
            req.body.videoTrailer === null ||
            req.body.videoTrailer === "null" ||
            req.body.videoTrailer === ""
          ) {
            console.log("Removing videoTrailer field from document");
            doc.videoTrailer = undefined; // This will remove the field when saved
            // Use delete to ensure the field is removed from the document
            delete doc.videoTrailer;
          }
          // If it's already an object, use it directly
          else if (typeof req.body.videoTrailer === "object") {
            doc.videoTrailer = req.body.videoTrailer;
          } else {
            // Otherwise try to parse it as JSON
            doc.videoTrailer = JSON.parse(req.body.videoTrailer);
          }

          console.log("Updated document videoTrailer field:", doc.videoTrailer);
        } catch (err) {
          console.error("Error parsing videoTrailer JSON:", err);
        }
      }

      // Add file data if a new file was uploaded
      if (req.files) {
        // Handle multiple file uploads (image and pdf)
        if (req.files.image && req.files.image[0]) {
          const file = req.files.image[0];
          const filename = file.filename || file.originalname;
          const relativePath = `uploads/${filename}`;

          doc.image = {
            data: relativePath,
            contentType: file.mimetype,
            filename: file.originalname,
          };
        }

        // Add PDF file data if uploaded
        if (req.files.pdf && req.files.pdf[0]) {
          const file = req.files.pdf[0];
          const filename = file.filename || file.originalname;
          const relativePath = `uploads/${filename}`;

          doc.pdf = {
            data: relativePath,
            contentType: file.mimetype,
            filename: file.originalname,
          };
        }
      } else if (req.file) {
        // Single file upload (backward compatibility)
        const filename = req.file.filename || req.file.originalname;
        const relativePath = `uploads/${filename}`;

        doc.image = {
          data: relativePath,
          contentType: req.file.mimetype,
          filename: req.file.originalname,
        };
      }

      // Save the document
      console.log(
        "About to save document, fields:",
        Object.keys(doc._doc || doc)
      );

      // Force the save to include all fields, including those that were unset
      const updatedDoc = await doc.save();

      // If we were trying to remove the videoTrailer field, verify it was removed
      // If not, use an explicit $unset operation
      if (
        req.body.videoTrailerJSON === "null" ||
        req.body.videoTrailerJSON === ""
      ) {
        // Double-check if the field was actually removed after save
        const checkDoc = await Model.findOne({ _id: doc._id }).lean();

        if (checkDoc.hasOwnProperty("videoTrailer")) {
          console.log(
            "Field still exists after save, using explicit $unset operation"
          );
          // Use $unset operation to forcefully remove the field
          await Model.updateOne(
            { _id: doc._id },
            { $unset: { videoTrailer: "" } }
          );
        }
      }

      // Verify the final document
      const refreshedDoc = await Model.findOne({ _id: doc._id }).lean();
      console.log("Final document fields:", Object.keys(refreshedDoc || {}));
      console.log(
        "Final document has videoTrailer?",
        refreshedDoc.hasOwnProperty("videoTrailer")
      );

      res.status(200).json({
        status: 200,
        success: true,
        message: "Document updated successfully",
        data: updatedDoc,
      });
    } catch (error) {
      console.error("Error updating document:", error);
      if (error.code === 11000) {
        // MongoDB duplicate key error
        return res.status(409).json({
          status: 409,
          success: false,
          message: "Duplicate entry. This update would create a duplicate.",
          data: null,
        });
      }

      // Validation errors
      if (error.name === "ValidationError") {
        const validationErrors = Object.values(error.errors).map(
          (err) => err.message
        );
        return res.status(400).json({
          status: 400,
          success: false,
          message: "Validation error",
          data: validationErrors,
        });
      }

      res.status(500).json({
        status: 500,
        success: false,
        message: "An error occurred while updating the document",
        data: error.message,
      });
    }
  };
