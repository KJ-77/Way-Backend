# Schedule & Schedule Registration Flow

## Models Overview

### Schedule Model

- Contains course/event details (title, text, images, slug)
- Has multiple **sessions** (embedded subdocuments)
- Each session includes:
  - `startDate`: Date
  - `endDate`: Date
  - `time`: String (HH:mm format, 24h)
  - `period`: String (e.g., "2hours", "3hours")
  - `capacity`: Number (minimum 1)
  - `tutor`: ObjectId reference to Tutor model

**Structure:** One schedule = one course with multiple time slots/sessions

### ScheduleRegistration Model

- Tracks user registrations for specific sessions
- **References:**
  - `userId`: Links to User
  - `scheduleId`: Links to Schedule
  - `sessionId`: Links to specific session within the schedule
- **Status Fields:**
  - `status`: "pending" | "approved" | "rejected" (admin approval)
  - `paymentStatus`: "unpaid" | "pending" | "paid"
  - `paymentLink`: String (payment URL sent by admin)
  - `paymentSent`: Boolean (tracks if payment link was sent)
- **Additional:**
  - `notes`: String (admin/user notes)
  - `isFullClassRequest`: Boolean (user wants to book entire class capacity)
- **Unique Constraint:** One user can only register once per session (userId + scheduleId + sessionId)

## Registration Flow

### 1. Schedule Creation (Admin)

- Admin creates a Schedule with course details
- Admin adds multiple sessions with different dates/times
- Each session is assigned a tutor and capacity

### 2. User Registration

- User browses available schedules
- User selects a specific session from the schedule
- ScheduleRegistration is created:
  - `status`: "pending"
  - `paymentStatus`: "unpaid"
  - `isFullClassRequest`: true/false (if user wants full class)
- **Email sent to user**: Registration confirmation email (notifyUser)
  - Confirms registration received
  - Explains next steps: review → payment link → secure spot
- **Email sent to admin**: New registration notification (notifyAdmin)
  - Alert about new pending registration
  - Includes user details and schedule info
  - Action required: review and approve/reject

### 3. Admin Review

- Admin reviews pending registrations
- Admin approves or rejects the registration
- `status` updated to "approved" or "rejected"
- **Email sent to user** (if approved): Approval confirmation email (sendApprovalConfirmationEmail)
  - Congratulations message
  - Class schedule details
  - Important information (arrive early, bring materials, etc.)
  - Contact information for questions

### 4. Payment Process

- Admin generates/sends payment link
- `paymentLink` field is populated
- `paymentSent` flag set to true
- `paymentStatus` updated to "pending"
- **Email sent to user**: Payment link email (sendPaymentLink)
  - Payment required notification
  - Clickable payment link button
  - Instructions to notify after payment completion

### 5. Payment Completion

- User completes payment via the link
- `paymentStatus` updated to "paid"
- Registration is confirmed

### 6. Custom Communication (Optional)

- Admin can send custom messages to students at any time (sendCustomMessage)
- **Email sent to user**: Custom message email
  - Personalized message from admin
  - Regarding specific registration

### Special Case: Full Class Request

- If session is at capacity, user can request to join via `isFullClassRequest`
- **Email sent to admin**: Full class request notification (notifyAdminFullClassRequest)
  - Alert about request for fully booked class
  - User details and class information
  - Suggested actions: waiting list, increase capacity, alternative options

## Key Business Rules

1. **Capacity Management**: Each session has a fixed capacity limit
2. **Unique Registration**: Users cannot register multiple times for the same session
3. **Admin Approval**: All registrations require admin approval before payment
4. **Full Class Booking**: Users can request to book the entire class capacity
5. **Payment Tracking**: Complete audit trail of payment status and links sent

Emails in the Flow:

1. User Registration → 2 emails:


    - User: Registration confirmation
    - Admin: New registration alert

2. Admin Approval → 1 email:


    - User: Approval confirmation with class details

3. Payment Link → 1 email:


    - User: Payment required with link

4. Custom Message (anytime) → 1 email:


    - User: Custom admin message

5. Full Class Request → 1 email:


    - Admin: Full class request notification
