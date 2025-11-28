import ProductRequest from "../../Modules/ProductRequest.model.js";
import Product from "../../Modules/Product.model.js";
import transporter from "../../middlewares/SendMail.js";

// Create a new product request
export const createProductRequest = async (requestData) => {
  try {
    // Validate that product exists
    const product = await Product.findById(requestData.product);
    if (!product) {
      throw new Error("product_not_found");
    }

    // Create the request
    const productRequest = await ProductRequest.create(requestData);

    // Populate product details for the email
    const populatedRequest = await ProductRequest.findById(productRequest._id)
      .populate("product", "name price image")
      .lean();

    // Send email notification to admin
    await sendAdminNotificationEmail(populatedRequest);

    return populatedRequest;
  } catch (error) {
    console.error("Error creating product request:", error);
    throw error;
  }
};

// Get all product requests with filters and pagination
export const getAllProductRequests = async (options = {}) => {
  const {
    page = 1,
    limit = 10,
    search = "",
    status = "",
    sort = "createdAt",
    order = "desc",
  } = options;

  try {
    // Build query
    const query = {};

    // Add status filter if provided
    if (status) {
      query.status = status;
    }

    // Add search filter if provided
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { location: { $regex: search, $options: "i" } },
      ];
    }

    // Count total documents
    const total = await ProductRequest.countDocuments(query);

    // Build sort object
    const sortOptions = {};
    sortOptions[sort] = order === "asc" ? 1 : -1;

    // Execute query with pagination
    const requests = await ProductRequest.find(query)
      .populate("product", "name price image")
      .sort(sortOptions)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Calculate pagination details
    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return {
      requests,
      pagination: { total, page, limit, totalPages, hasNextPage, hasPrevPage },
    };
  } catch (error) {
    console.error("Error getting product requests:", error);
    throw error;
  }
};

// Get product request by ID
export const getProductRequestById = async (requestId) => {
  try {
    const request = await ProductRequest.findById(requestId)
      .populate("product", "name price image description")
      .lean();

    if (!request) {
      throw new Error("request_not_found");
    }

    return request;
  } catch (error) {
    console.error("Error getting product request:", error);
    throw error;
  }
};

// Update product request status
export const updateProductRequestStatus = async (
  requestId,
  status,
  notes = ""
) => {
  try {
    // Find the request
    const request = await ProductRequest.findById(requestId);
    if (!request) {
      throw new Error("request_not_found");
    }

    // Update status
    request.status = status;
    if (notes) {
      request.notes = notes;
    }

    await request.save();

    // Populate product details for the email
    const updatedRequest = await ProductRequest.findById(requestId)
      .populate("product", "name price image")
      .lean();

    // Send email notification to customer
    await sendStatusUpdateEmail(updatedRequest);

    return updatedRequest;
  } catch (error) {
    console.error("Error updating product request status:", error);
    throw error;
  }
};

// Send email notification to admin about new request
const sendAdminNotificationEmail = async (request) => {
  const subject = `New Product Request: ${request.product.name}`;
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e3e3e3; border-radius: 8px;">
      <h2 style="color: #333; border-bottom: 1px solid #eee; padding-bottom: 10px;">New Product Request</h2>
      <p>A new request for a product has been submitted:</p>
      <div style="background-color: #f8f9fa; border-left: 4px solid #17a2b8; padding: 15px; margin: 20px 0; border-radius: 5px;">
        <h3 style="margin-top: 0;">Product Details:</h3>
        <p><strong>Name:</strong> ${request.product.name}</p>
        <p><strong>Price:</strong> $${request.product.price.toFixed(2)}</p>
      </div>
      <div style="background-color: #f8f9fa; border-left: 4px solid #28a745; padding: 15px; margin: 20px 0; border-radius: 5px;">
        <h3 style="margin-top: 0;">Customer Information:</h3>
        <p><strong>Name:</strong> ${request.name}</p>
        <p><strong>Email:</strong> ${request.email}</p>
        <p><strong>Phone:</strong> ${request.phone}</p>
        <p><strong>Location:</strong> ${request.location}</p>
      </div>
      <div style="background-color: #f8f9fa; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 5px;">
        <h3 style="margin-top: 0;">Message:</h3>
        <p>${request.message || "No message provided"}</p>
      </div>
      <p>Please log in to the admin dashboard to approve or reject this request.</p>
    </div>
  `;

  try {
    // Send to admin email using transporter directly
    const mailResult = await transporter.sendMail({
      from: process.env.SENDER_EMAIL,
      to: process.env.ADMIN_EMAIL || "admin@example.com",
      subject,
      html,
    });

    if (!mailResult) {
      throw new Error("Failed to send admin notification email");
    }

    console.log(
      `Admin notification email sent for product request: ${request.product.name}`
    );
  } catch (error) {
    console.error("Error sending admin notification email:", error);
    // Don't throw, just log the error to prevent blocking the request creation
  }
};

// Send custom message to customer
export const sendCustomMessage = async (requestId, messageContent) => {
  try {
    // Find and populate the request
    const request = await ProductRequest.findById(requestId)
      .populate("product", "name price image")
      .lean();

    if (!request) {
      throw new Error("request_not_found");
    }

    // Send custom message email
    await sendCustomMessageEmail(request, messageContent);

    return { success: true };
  } catch (error) {
    console.error("Error sending custom message:", error);
    throw error;
  }
};

// Send email with custom message to customer
const sendCustomMessageEmail = async (request, messageContent) => {
  // Skip if no email recipient
  if (!request.email) {
    console.error("Cannot send email: No recipient email address");
    throw new Error("invalid_email");
  }

  const subject = `Message regarding your request for ${request.product.name}`;

  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e3e3e3; border-radius: 8px; background-color: #ffffff;">
      <div style="text-align: center; background: linear-gradient(135deg, #17a2b8, #20c997); color: white; padding: 20px; border-radius: 8px 8px 0 0; margin: -20px -20px 20px -20px;">
        <h1 style="margin: 0; font-size: 24px;">Message from Our Team</h1>
      </div>

      <div style="padding: 0 10px;">
        <p style="font-size: 16px; color: #333;">Dear <strong>${request.name}</strong>,</p>
        
        <p style="font-size: 16px; line-height: 1.6; color: #444;">
          Regarding your request for <strong>${request.product.name}</strong>:
        </p>

        <div style="background-color: #f8f9fa; border-left: 4px solid #17a2b8; padding: 15px; margin: 20px 0; border-radius: 5px;">
          <p style="white-space: pre-line;">${messageContent}</p>
        </div>

        <p style="font-size: 16px; color: #333; margin-top: 30px;">
          If you have any questions, please feel free to reply to this email.
        </p>

        <p style="font-size: 16px; color: #333;">
          Best regards,<br>
          <strong>Way Team</strong>
        </p>
      </div>
    </div>
  `;

  const textContent = `
Dear ${request.name},

Regarding your request for ${request.product.name}:

${messageContent}

If you have any questions, please feel free to reply to this email.

Best regards,
Way Team
  `;

  try {
    const mailResult = await transporter.sendMail({
      from: process.env.SENDER_EMAIL,
      to: request.email,
      subject,
      text: textContent,
      html,
    });

    if (!mailResult) {
      throw new Error("Failed to send message email");
    }

    console.log(
      `Custom message email sent to ${request.email} for product: ${request.product.name}`
    );
    return true;
  } catch (error) {
    console.error("Error sending custom message email:", error);
    throw error;
  }
};

// Send email notification to customer when request status changes
const sendStatusUpdateEmail = async (request) => {
  // Skip if no email recipient
  if (!request.email) {
    console.error("Cannot send email: No recipient email address");
    return;
  }

  let subject = "";
  let html = "";
  let textContent = "";

  if (request.status === "approved") {
    subject = `🎉 Your product request for ${request.product.name} has been approved!`;

    html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e3e3e3; border-radius: 8px; background-color: #ffffff;">
        <!-- Header -->
        <div style="text-align: center; background: linear-gradient(135deg, #28a745, #20c997); color: white; padding: 30px; border-radius: 8px 8px 0 0; margin: -20px -20px 30px -20px;">
          <h1 style="margin: 0; font-size: 28px;">🎉 Product Request Approved!</h1>
          <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Great news about your product inquiry</p>
        </div>

        <!-- Main Content -->
        <div style="padding: 0 10px;">
          <p style="font-size: 18px; color: #333;">Dear <strong>${
            request.name
          }</strong>,</p>
          
          <p style="font-size: 16px; line-height: 1.6; color: #444;">
            <strong>Good news!</strong> We're pleased to inform you that your request for 
            <strong style="color: #28a745;">${
              request.product.name
            }</strong> has been <strong>approved</strong>!
          </p>

          <!-- Product Details -->
          <div style="background-color: #f8f9fa; border-left: 4px solid #28a745; padding: 15px; margin: 20px 0; border-radius: 5px;">
            <h3 style="color: #28a745; margin-top: 0;">Product Details</h3>
            <p><strong>Name:</strong> ${request.product.name}</p>
            <p><strong>Price:</strong> $${request.product.price.toFixed(2)}</p>
          </div>

          <div style="background-color: #e8f5e8; border-left: 4px solid #28a745; padding: 15px; margin: 20px 0; border-radius: 5px;">
            <h3 style="color: #155724; margin-top: 0;">Next Steps</h3>
            <p>Our team will contact you shortly to discuss payment options and delivery details.</p>
            ${
              request.notes
                ? `<p><strong>Note from our team:</strong> ${request.notes}</p>`
                : ""
            }
          </div>

          <p style="font-size: 16px; line-height: 1.6; color: #444; margin-top: 30px;">
            Thank you for your interest in our products!
          </p>

          <p style="font-size: 16px; color: #333;">
            Best regards,<br>
            <strong>Way Team</strong>
          </p>
        </div>

        <!-- Footer -->
        <div style="text-align: center; padding: 20px; border-top: 1px solid #eee; margin-top: 30px; color: #666; font-size: 12px;">
          <p>This is an automated confirmation email. Please keep this for your records.</p>
        </div>
      </div>
    `;

    textContent = `
Dear ${request.name},

GOOD NEWS! YOUR PRODUCT REQUEST HAS BEEN APPROVED! 🎉

We're pleased to inform you that your request for ${
      request.product.name
    } has been approved!

PRODUCT DETAILS:
Name: ${request.product.name}
Price: $${request.product.price.toFixed(2)}

NEXT STEPS:
Our team will contact you shortly to discuss payment options and delivery details.
${request.notes ? `Note from our team: ${request.notes}` : ""}

Thank you for your interest in our products!

Best regards,
Way Team

This is an automated confirmation email. Please keep this for your records.
    `;
  } else if (request.status === "rejected") {
    subject = `Update on your product request for ${request.product.name}`;

    html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e3e3e3; border-radius: 8px; background-color: #ffffff;">
        <div style="padding: 20px;">
          <h2 style="color: #333; border-bottom: 1px solid #eee; padding-bottom: 10px;">Product Request Update</h2>
          
          <p style="font-size: 16px; line-height: 1.6; color: #444;">Dear ${
            request.name
          },</p>
          
          <p style="font-size: 16px; line-height: 1.6; color: #444;">
            Thank you for your interest in our product. We regret to inform you that your request for the following product could not be approved at this time:
          </p>
          
          <div style="background-color: #f8f9fa; border-left: 4px solid #17a2b8; padding: 15px; margin: 20px 0; border-radius: 5px;">
            <h3 style="margin-top: 0;">Product Details:</h3>
            <p><strong>Name:</strong> ${request.product.name}</p>
          </div>
          
          ${
            request.notes
              ? `<div style="background-color: #f8f9fa; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 5px;">
              <h3 style="margin-top: 0;">Message from our team:</h3>
              <p>${request.notes}</p>
            </div>`
              : `<p>Our team may contact you with more information if needed.</p>`
          }
          
          <p style="font-size: 16px; line-height: 1.6; color: #444; margin-top: 30px;">
            Thank you for your understanding.
          </p>
          
          <p style="font-size: 16px; color: #333; margin-top: 30px;">
            Best regards,<br>
            Way Team
          </p>
        </div>
      </div>
    `;

    textContent = `
Dear ${request.name},

Thank you for your interest in our product. We regret to inform you that your request for the following product could not be approved at this time:

Product: ${request.product.name}

${
  request.notes
    ? `Message from our team: ${request.notes}`
    : "Our team may contact you with more information if needed."
}

Thank you for your understanding.

Best regards,
Way Team
    `;
  }

  try {
    if (subject && html) {
      const mailResult = await transporter.sendMail({
        from: process.env.SENDER_EMAIL,
        to: request.email,
        subject,
        text: textContent,
        html,
      });

      if (!mailResult) {
        throw new Error("Failed to send status update email");
      }

      console.log(
        `Product request status update email sent to ${request.email} for product: ${request.product.name}`
      );
      return true;
    }
  } catch (error) {
    console.error("Error sending status update email:", error);
    // Don't throw, just log the error
  }
};
