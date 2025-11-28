import Event from "../../Modules/Event.model.js";
import generateSlug from "../../utils/generateSlug.js";
import fs from "fs";
import path from "path";
import transporter from "../../middlewares/SendMail.js";

// Create a new event
export const createEvent = async (eventData, file) => {
  try {
    // Generate slug from title
    const slug = generateSlug(eventData.title);
    // Check if slug already exists
    const existingEvent = await Event.findOne({ slug });
    if (existingEvent) {
      throw new Error("event_slug_exists");
    }
    // Process uploaded image
    let imagePath = null;
    if (file) {
      // Store relative path from uploads directory
      const relativePath = path
        .relative(path.join(process.cwd(), "backend"), file.path)
        .replace(/\\/g, "/");
      imagePath = `/${relativePath}`;
    }
    // Create event with generated slug
    const event = new Event({
      title: eventData.title,
      content: eventData.content,
      image: imagePath,
      slug,
    });
    await event.save();
    return event;
  } catch (error) {
    // Clean up uploaded file if event creation fails
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

// Get all events with pagination
export const getAllEvents = async (options = {}) => {
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
          { content: { $regex: search, $options: "i" } },
          { slug: { $regex: search, $options: "i" } },
        ],
      };
    }
    const events = await Event.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean();
    const total = await Event.countDocuments(query);
    return {
      events,
      pagination: {
        current: page,
        total: Math.ceil(total / limit),
        count: events.length,
        totalDocuments: total,
      },
    };
  } catch (error) {
    throw error;
  }
};

// Get event by slug
export const getEventBySlug = async (slug) => {
  try {
    const event = await Event.findOne({ slug }).lean();
    if (!event) {
      throw new Error("event_not_found");
    }
    return event;
  } catch (error) {
    throw error;
  }
};

// Update event by slug
export const updateEventBySlug = async (slug, eventData, file) => {
  try {
    const existingEvent = await Event.findOne({ slug });
    if (!existingEvent) {
      throw new Error("event_not_found");
    }
    // Generate new slug if title changed
    let newSlug = slug;
    if (eventData.title && eventData.title !== existingEvent.title) {
      newSlug = generateSlug(eventData.title);
      // Check if new slug already exists (and it's not the same document)
      const slugExists = await Event.findOne({
        slug: newSlug,
        _id: { $ne: existingEvent._id },
      });
      if (slugExists) {
        throw new Error("event_slug_exists");
      }
    }
    // Process new uploaded image
    let imagePath = existingEvent.image; // Keep existing image by default
    if (file) {
      // Delete old image if exists
      if (existingEvent.image) {
        try {
          const oldImagePath = path.join(
            process.cwd(),
            "backend",
            existingEvent.image
          );
          if (fs.existsSync(oldImagePath)) {
            fs.unlinkSync(oldImagePath);
          }
        } catch (deleteError) {
          console.error("Error deleting old image:", deleteError);
        }
      }
      // Add new image
      const relativePath = path
        .relative(path.join(process.cwd(), "backend"), file.path)
        .replace(/\\/g, "/");
      imagePath = `/${relativePath}`;
    }
    const updatedEvent = await Event.findOneAndUpdate(
      { slug },
      {
        title: eventData.title || existingEvent.title,
        content: eventData.content || existingEvent.content,
        image: imagePath,
        slug: newSlug,
      },
      { new: true, runValidators: true }
    );
    return updatedEvent;
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

// Delete event by slug
export const deleteEventBySlug = async (slug) => {
  try {
    const event = await Event.findOne({ slug });
    if (!event) {
      throw new Error("event_not_found");
    }
    // Delete associated image
    if (event.image) {
      try {
        const imagePath = path.join(process.cwd(), "backend", event.image);
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
        }
      } catch (deleteError) {
        console.error("Error deleting image:", deleteError);
      }
    }
    await Event.findOneAndDelete({ slug });
    return true;
  } catch (error) {
    throw error;
  }
};

/**
 * Handle event request and send notification emails
 */
export const handleEventRequest = async (requestData) => {
  const { eventId, eventTitle, email, message, phone } = requestData;

  try {
    // 1. Send email to admin
    const adminEmail = process.env.ADMIN_EMAIL || process.env.SENDER_EMAIL;
    const adminEmailContent = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e3e3e3; border-radius: 8px;">
        <h2 style="color: #333; border-bottom: 1px solid #eee; padding-bottom: 10px;">New Event Request</h2>
        <p>Someone has requested information about an event:</p>
        <div style="background-color: #f8f9fa; border-left: 4px solid #17a2b8; padding: 15px; margin: 20px 0; border-radius: 5px;">
          <p><strong>Event:</strong> ${eventTitle}</p>
          <p><strong>Event ID:</strong> ${eventId}</p>
          <p><strong>From:</strong> ${email}</p>
          ${phone ? `<p><strong>Phone:</strong> ${phone}</p>` : ""}
          ${message ? `<p><strong>Message:</strong> ${message}</p>` : ""}
        </div>
        <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 5px;">
          <p style="margin-top: 0;"><strong>Action Required:</strong></p>
          <p>Please contact this person regarding their interest in the event.</p>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: process.env.SENDER_EMAIL,
      to: adminEmail,
      subject: `New Event Request: ${eventTitle}`,
      text: `New Event Request\n\nEvent: ${eventTitle}\nEvent ID: ${eventId}\nFrom: ${email}\n${
        phone ? `Phone: ${phone}\n` : ""
      }${
        message ? `Message: ${message}\n` : ""
      }\nAction Required: Please contact this person regarding their interest in the event.`,
      html: adminEmailContent,
    });

    // 2. Send confirmation email to user
    const userEmailContent = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #e3e3e3; border-radius: 8px;">
        <h2 style="color: #333; border-bottom: 1px solid #eee; padding-bottom: 10px;">Event Request Confirmation</h2>
        <p>Thank you for your interest in our event!</p>
        <div style="background-color: #f8f9fa; border-left: 4px solid #17a2b8; padding: 15px; margin: 20px 0; border-radius: 5px;">
          <p><strong>Event:</strong> ${eventTitle}</p>
        </div>
        <p>We have received your request and our team will contact you shortly with more information.</p>
        <p style="margin-top: 25px; padding-top: 15px; border-top: 1px solid #eee; color: #666;">If you have any urgent questions, please feel free to reply to this email.</p>
        <p>Thank you for your interest!</p>
      </div>
    `;

    await transporter.sendMail({
      from: process.env.SENDER_EMAIL,
      to: email,
      subject: `Your Event Request: ${eventTitle}`,
      text: `Event Request Confirmation\n\nThank you for your interest in our event: ${eventTitle}\n\nWe have received your request and our team will contact you shortly with more information.\n\nIf you have any urgent questions, please feel free to reply to this email.\n\nThank you for your interest!`,
      html: userEmailContent,
    });

    return true;
  } catch (error) {
    console.error("Error processing event request:", error);
    throw error;
  }
};
