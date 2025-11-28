import {
  createEvent,
  updateEventBySlug,
  deleteEventBySlug,
  getAllEvents,
  getEventBySlug,
  handleEventRequest,
} from "../Services/crud/EventService.js";

// Create a new event
export const createEventController = async (req, res) => {
  try {
    const { title, content } = req.body;

    // Validate required fields
    if (!title || title.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Event title is required",
        data: null,
      });
    }

    if (!content || content.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Event content is required",
        data: null,
      });
    }

    // Create event with uploaded file
    const event = await createEvent(
      {
        title: title.trim(),
        content: content.trim(),
      },
      req.file
    );

    res.status(201).json({
      status: 201,
      success: true,
      message: "Event created successfully",
      data: event,
    });
  } catch (error) {
    console.error("Create event error:", error);

    if (error.message === "event_slug_exists") {
      return res.status(409).json({
        status: 409,
        success: false,
        message: "An event with similar title already exists",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while creating the event",
      data: null,
    });
  }
};

// Get all events with pagination
export const getAllEventsController = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const sort = req.query.sort || "createdAt";
    const order = req.query.order === "asc" ? 1 : -1;

    const options = {
      page,
      limit,
      search,
      sort: { [sort]: order },
    };

    const result = await getAllEvents(options);

    res.status(200).json({
      status: 200,
      success: true,
      message: "Events retrieved successfully",
      results: result.events.length,
      pagination: result.pagination,
      data: result.events,
    });
  } catch (error) {
    console.error("Get all events error:", error);

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while retrieving events",
      data: null,
    });
  }
};

// Get event by slug
export const getEventBySlugController = async (req, res) => {
  try {
    const { slug } = req.params;

    if (!slug) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Event slug is required",
        data: null,
      });
    }

    const event = await getEventBySlug(slug);

    res.status(200).json({
      status: 200,
      success: true,
      message: "Event retrieved successfully",
      data: event,
    });
  } catch (error) {
    console.error("Get event by slug error:", error);

    if (error.message === "event_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Event not found",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while retrieving the event",
      data: null,
    });
  }
};

// Update event by slug
export const updateEventBySlugController = async (req, res) => {
  try {
    const { slug } = req.params;
    const { title, content } = req.body;

    if (!slug) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Event slug is required",
        data: null,
      });
    }

    // Validate title if provided
    if (title && title.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Event title cannot be empty",
        data: null,
      });
    }

    // Validate content if provided
    if (content && content.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Event content cannot be empty",
        data: null,
      });
    }

    const updateData = {};
    if (title) {
      updateData.title = title.trim();
    }
    if (content) {
      updateData.content = content.trim();
    }

    const updatedEvent = await updateEventBySlug(slug, updateData, req.file);

    res.status(200).json({
      status: 200,
      success: true,
      message: "Event updated successfully",
      data: updatedEvent,
    });
  } catch (error) {
    console.error("Update event error:", error);

    if (error.message === "event_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Event not found",
        data: null,
      });
    }

    if (error.message === "event_slug_exists") {
      return res.status(409).json({
        status: 409,
        success: false,
        message: "An event with similar title already exists",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while updating the event",
      data: null,
    });
  }
};

// Delete event by slug
export const deleteEventBySlugController = async (req, res) => {
  try {
    const { slug } = req.params;

    if (!slug) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Event slug is required",
        data: null,
      });
    }

    await deleteEventBySlug(slug);

    res.status(200).json({
      status: 200,
      success: true,
      message: "Event deleted successfully",
      data: null,
    });
  } catch (error) {
    console.error("Delete event error:", error);

    if (error.message === "event_not_found") {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Event not found",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while deleting the event",
      data: null,
    });
  }
};

// Handle event request
export const handleEventRequestController = async (req, res) => {
  try {
    const { eventId, eventTitle, email, message, phone } = req.body;

    // Validate required fields
    if (!eventId || !eventTitle) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Event ID and title are required",
        data: null,
      });
    }

    if (!email) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Email is required",
        data: null,
      });
    }

    await handleEventRequest({
      eventId,
      eventTitle,
      email,
      message,
      phone,
    });

    res.status(200).json({
      status: 200,
      success: true,
      message: "Event request sent successfully",
      data: null,
    });
  } catch (error) {
    console.error("Handle event request error:", error);

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while processing the event request",
      data: null,
    });
  }
};
