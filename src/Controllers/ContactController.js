import { sendEmail } from "../utils/emailService.js";
import transporter from "../middlewares/SendMail.js";

// Send contact form message to admin
export const sendContactMessage = async (req, res) => {
  try {
    const { firstName, email, message } = req.body;

    // Validate required fields
    if (!firstName || firstName.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "First name is required",
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

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Please provide a valid email address",
        data: null,
      });
    }

    if (!message || message.trim() === "") {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Message is required",
        data: null,
      });
    }

    // Get admin email from environment variables
    const adminEmail = process.env.ADMIN_EMAIL || process.env.SENDER_EMAIL;

    if (!adminEmail) {
      console.error("Admin email not configured in environment variables");
      return res.status(500).json({
        status: 500,
        success: false,
        message: "Email service not properly configured",
        data: null,
      });
    }

    // Clean and prepare data
    const cleanFirstName = firstName.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanMessage = message.trim();

    // Email content for admin
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px;">
        <h2 style="color: #421f19; margin-bottom: 20px;">New Contact Form Message</h2>
        
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 10px 0; color: #421f19;">Contact Information</h3>
          <p style="margin: 5px 0;"><strong>Name:</strong> ${cleanFirstName}</p>
          <p style="margin: 5px 0;"><strong>Email:</strong> ${cleanEmail}</p>
        </div>
        
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px;">
          <h3 style="margin: 0 0 10px 0; color: #421f19;">Message</h3>
          <p style="line-height: 1.6; white-space: pre-wrap;">${cleanMessage}</p>
        </div>
        
        <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #ddd; font-size: 12px; color: #666;">
          <p>This message was sent from the WAY website contact form.</p>
          <p>Time: ${new Date().toLocaleString()}</p>
        </div>
      </div>
    `;

    const emailText = `
      New Contact Form Message
      
      Name: ${cleanFirstName}
      Email: ${cleanEmail}
      
      Message:
      ${cleanMessage}
      
      This message was sent from the WAY website contact form.
      Time: ${new Date().toLocaleString()}
    `;

    // Try to send email using the primary email service
    try {
      await sendEmail({
        to: adminEmail,
        subject: `New Contact Message from ${cleanFirstName}`,
        html: emailHtml,
        text: emailText,
      });
    } catch (emailServiceError) {
      console.log(
        "Primary email service failed, trying fallback transporter:",
        emailServiceError
      );

      // Fallback to the transporter from SendMail.js
      await transporter.sendMail({
        from: process.env.SENDER_EMAIL || process.env.EMAIL_FROM,
        to: adminEmail,
        subject: `New Contact Message from ${cleanFirstName}`,
        html: emailHtml,
        text: emailText,
      });
    }

    // Send confirmation email to the user
    const confirmationHtml = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #421f19;">Thank you for contacting us!</h2>
        <p>Hi ${cleanFirstName},</p>
        <p>We've received your message and will get back to you as soon as possible.</p>
        
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin: 0 0 10px 0; color: #421f19;">Your Message</h3>
          <p style="line-height: 1.6; white-space: pre-wrap;">${cleanMessage}</p>
        </div>
        
        <p>Best regards,<br>The WAY Team</p>
        
        <div style="margin-top: 30px; padding-top: 15px; border-top: 1px solid #ddd; font-size: 12px; color: #666;">
          <p>This is an automated message. Please do not reply to this email.</p>
        </div>
      </div>
    `;

    const confirmationText = `
      Thank you for contacting us!
      
      Hi ${cleanFirstName},
      
      We've received your message and will get back to you as soon as possible.
      
      Your Message:
      ${cleanMessage}
      
      Best regards,
      The WAY Team
      
      This is an automated message. Please do not reply to this email.
    `;

    // Send confirmation email (don't fail the main request if this fails)
    try {
      await sendEmail({
        to: cleanEmail,
        subject: "Message Received - WAY Beirut",
        html: confirmationHtml,
        text: confirmationText,
      });
    } catch (confirmationError) {
      console.log("Failed to send confirmation email:", confirmationError);
      // Try fallback for confirmation too
      try {
        await transporter.sendMail({
          from: process.env.SENDER_EMAIL || process.env.EMAIL_FROM,
          to: cleanEmail,
          subject: "Message Received - WAY Beirut",
          html: confirmationHtml,
          text: confirmationText,
        });
      } catch (fallbackError) {
        console.log("Confirmation email fallback also failed:", fallbackError);
        // Don't fail the main request even if confirmation fails
      }
    }

    res.status(200).json({
      status: 200,
      success: true,
      message:
        "Your message has been sent successfully. We'll get back to you soon!",
      data: null,
    });
  } catch (error) {
    console.error("Contact form error:", error);

    // Handle specific email errors
    if (error.message && error.message.includes("Invalid mail address")) {
      return res.status(400).json({
        status: 400,
        success: false,
        message: "Invalid email address provided",
        data: null,
      });
    }

    res.status(500).json({
      status: 500,
      success: false,
      message:
        "An error occurred while sending your message. Please try again later.",
      data: null,
    });
  }
};
