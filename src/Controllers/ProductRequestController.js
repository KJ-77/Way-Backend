import {
  createProductRequest,
  getAllProductRequests,
  getProductRequestById,
  updateProductRequestStatus,
  sendCustomMessage,
} from "../Services/crud/ProductRequestService.js";

// Create a new product request
export const createProductRequestController = async (req, res) => {
  try {
    const { product, name, email, phone, location, message } = req.body;

    // Validate required fields
    if (!product) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Product ID is required",
        data: null,
      });
    }

    if (!name || name.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Name is required",
        data: null,
      });
    }

    if (!email || email.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Email is required",
        data: null,
      });
    }

    if (!phone || phone.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Phone number is required",
        data: null,
      });
    }

    if (!location || location.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Location is required",
        data: null,
      });
    }

    // Create product request
    const productRequest = await createProductRequest({
      product,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      location: location.trim(),
      message: message?.trim() || "",
    });

    res.status(201).json({
      status: 201,
      success: true,
      message: "Product request created successfully",
      data: productRequest,
    });
  } catch (error) {
    console.error("Create product request error:", error);

    if (error.message === "product_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Product not found",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while creating the product request",
      data: null,
    });
  }
};

// Get all product requests with pagination and filtering
export const getAllProductRequestsController = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const status = req.query.status || "";
    const sort = req.query.sort || "createdAt";
    const order = req.query.order || "desc";

    const options = {
      page,
      limit,
      search,
      status,
      sort,
      order,
    };

    const result = await getAllProductRequests(options);

    res.status(200).json({
      status: 200,
      success: true,
      message: "Product requests retrieved successfully",
      results: result.requests.length,
      pagination: result.pagination,
      data: result.requests,
    });
  } catch (error) {
    console.error("Get all product requests error:", error);

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while retrieving product requests",
      data: null,
    });
  }
};

// Get product request by ID
export const getProductRequestByIdController = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Request ID is required",
        data: null,
      });
    }

    const request = await getProductRequestById(id);

    res.status(200).json({
      status: 200,
      success: true,
      message: "Product request retrieved successfully",
      data: request,
    });
  } catch (error) {
    console.error("Get product request by ID error:", error);

    if (error.message === "request_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Product request not found",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while retrieving the product request",
      data: null,
    });
  }
};

// Update product request status
export const updateProductRequestStatusController = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!id) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Request ID is required",
        data: null,
      });
    }

    if (!status || !["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Valid status is required (pending, approved, rejected)",
        data: null,
      });
    }

    const updatedRequest = await updateProductRequestStatus(id, status, notes);

    res.status(200).json({
      status: 200,
      success: true,
      message: "Product request status updated successfully",
      data: updatedRequest,
    });
  } catch (error) {
    console.error("Update product request status error:", error);

    if (error.message === "request_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Product request not found",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while updating the product request status",
      data: null,
    });
  }
};

// Send custom message to customer
export const sendMessageToCustomerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    if (!id) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Request ID is required",
        data: null,
      });
    }

    if (!message || message.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Message content is required",
        data: null,
      });
    }

    await sendCustomMessage(id, message.trim());

    res.status(200).json({
      status: 200,
      success: true,
      message: "Message sent successfully to the customer",
      data: null,
    });
  } catch (error) {
    console.error("Send message to customer error:", error);

    if (error.message === "request_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Product request not found",
        data: null,
      });
    }

    if (error.message === "invalid_email") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Invalid customer email address",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while sending the message",
      data: null,
    });
  }
};
