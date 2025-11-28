import Schedule from "../Modules/Schedule.model.js";

// Get all tutors for a schedule (derived from sessions)
export const getScheduleTutors = async (req, res) => {
  try {
    const { slug } = req.params;

    if (!slug) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Schedule slug is required",
        data: null,
      });
    }

    const schedule = await Schedule.findOne({ slug }).populate({
      path: "sessions.tutor",
      select: "name email bio avatar",
    });

    if (!schedule) {
      return res.status(404).json({
        status: 404,
        success: false,
        message: "Schedule not found",
        data: null,
      });
    }

    // Unique tutors from sessions
    const tutors = (schedule.sessions || [])
      .map((s) => s.tutor)
      .filter(Boolean)
      .reduce(
        (acc, t) => {
          const id = t._id ? String(t._id) : String(t);
          if (!acc.map.has(id)) {
            acc.map.set(id, true);
            acc.list.push(t);
          }
          return acc;
        },
        { map: new Map(), list: [] }
      ).list;

    res.status(200).json({
      status: 200,
      success: true,
      message: "Schedule tutors retrieved successfully",
      data: tutors,
    });
  } catch (error) {
    console.error("Get schedule tutors error:", error);

    res.status(500).json({
      status: 500,
      success: false,
      message: "An error occurred while retrieving the schedule tutors",
      data: null,
    });
  }
};
