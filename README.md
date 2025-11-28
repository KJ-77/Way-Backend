# Backend - Clean Authentication Starter

This is a clean, reusable backend codebase with authentication functionality. All business-specific modules have been removed, leaving only the essential authentication system and reusable utilities.

## 🚀 What's Included

### Authentication System

- **User Authentication**: Complete user registration, login, logout
- **Email Verification**: 6-digit verification codes sent via email
- **Admin Authentication**: Role-based admin system with permissions
- **Security Features**: Account lockout, JWT tokens, password hashing
- **Password Management**: Secure password handling with bcrypt

### Models

- **User Model**: Basic user schema with authentication and verification fields
- **Admin Model**: Admin schema with role-based permissions (super_admin, admin, read_only)

### Middleware (Reusable)

- **Authentication Middleware**: JWT verification for admins
- **User Identification Middleware**: JWT verification for users
- **Security Headers**: Helmet configuration
- **Rate Limiting**: Protection against brute force attacks
- **Input Validation**: Joi schema validation
- **File Upload**: Multer configuration
- **CORS Configuration**: Cross-origin resource sharing

### Services (Reusable)

- **Authentication Service**: User login/registration logic
- **Admin Authentication Service**: Admin login/creation logic
- **Verification Service**: Email verification with 6-digit codes
- **CRUD Functions**: Generic database operations
- **Password Service**: Password reset functionality
- **User Service**: User management utilities

### Utilities (Reusable)

- **Email Service**: Nodemailer configuration
- **File Storage Adapter**: File upload handling
- **Hashing**: Password hashing utilities
- **Slug Generation**: URL-friendly slug creation
- **Error Handling**: Custom error classes
- **Catch Async**: Async error wrapper

## 🛠️ Setup

1. **Install Dependencies**

   ```bash
   npm install
   ```

2. **Environment Variables**
   Create a `.env` file:

   ```env
   PORT=5001
   MONGODB_URI=mongodb://localhost:27017/your-database
   JWT_SECRET=your-super-secret-jwt-key
   HMAC_SECRET=your-hmac-secret-for-verification-codes

   # Email configuration (required for verification)
   SENDER_EMAIL=your-email@gmail.com
   SENDER_EMAIL_PASSWORD=your-app-password
   EMAIL_FROM="Your App Name <noreply@yourapp.com>"

   # Alternative email config (if using different provider)
   EMAIL_HOST=smtp.gmail.com
   EMAIL_PORT=587
   EMAIL_USER=your-email@gmail.com
   EMAIL_PASS=your-app-password
   ```

3. **Database Setup**

   ```bash
   # Start MongoDB locally or use MongoDB Atlas
   # Create initial super admin
   npm run create-super-admin
   ```

4. **Start Development Server**
   ```bash
   npm run dev
   ```

## 📁 Project Structure

```
backend/
├── src/
│   ├── Controllers/
│   │   └── Auth/                 # Authentication controllers
│   ├── Modules/                  # Database models
│   │   ├── User.model.js
│   │   └── Admin.model.js
│   ├── Routes/                   # API routes
│   │   ├── AuthRouter.js
│   │   └── AdminRouter.js
│   ├── Services/
│   │   └── crud/                 # Business logic services
│   ├── middlewares/              # Express middleware
│   └── utils/                    # Utility functions
├── uploads/                      # File uploads directory
├── app.js                        # cPanel deployment entry
├── server.js                     # Main server file
└── package.json
```

## 🔐 Authentication Endpoints

### User Authentication

- `POST /api/auth/register` - User registration (sends verification email)
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout

### Email Verification

- `POST /api/auth/send-verification` - Send/resend verification code
- `POST /api/auth/verify-email` - Verify email with 6-digit code

### Admin Authentication

- `POST /api/admin/login` - Admin login
- `POST /api/admin/logout` - Admin logout
- `POST /api/admin/create-admin` - Create new admin (super admin only)

## 📧 Email Verification Flow

1. **User registers** → Receives 6-digit verification code via email
2. **User submits code** → Email gets verified, account activated
3. **Resend option** → Users can request new codes if needed

### Email Verification Details

- **Code Format**: 6-digit numeric code (e.g., 123456)
- **Expiration**: 30 minutes
- **Security**: HMAC-hashed codes stored in database
- **HTML Email**: Nicely formatted verification emails

## 👥 Admin Roles

- **super_admin**: Full system access, can create other admins
- **admin**: Most features except admin management
- **read_only**: Read-only access to user data

## 🔧 Available Scripts

- `npm run dev` - Start development server with nodemon
- `npm run start` - Start production server
- `npm run create-super-admin` - Create initial super admin account

## 🧩 Adding Your Business Logic

1. **Create Models**: Add your business-specific models in `src/Modules/`
2. **Create Controllers**: Add controllers in `src/Controllers/`
3. **Create Routes**: Add routes in `src/Routes/`
4. **Update Server**: Import and use your routes in `server.js`

Example:

```javascript
// In server.js
import productRouter from "./src/Routes/ProductRouter.js";
app.use("/api/products", productRouter);
```

## 🛡️ Security Features

- **Helmet**: Security headers
- **CORS**: Cross-origin resource sharing
- **Rate Limiting**: Brute force protection
- **Input Sanitization**: MongoDB injection protection
- **JWT Authentication**: Secure token-based auth
- **Password Hashing**: bcrypt with salt rounds
- **Account Lockout**: Failed login attempt protection
- **Email Verification**: HMAC-secured verification codes

## 📝 Environment Variables

| Variable                | Description                          | Required | Default                                 |
| ----------------------- | ------------------------------------ | -------- | --------------------------------------- |
| `PORT`                  | Server port                          | No       | 5001                                    |
| `MONGODB_URI`           | MongoDB connection string            | Yes      | mongodb://localhost:27017/your-database |
| `JWT_SECRET`            | JWT signing secret                   | Yes      | -                                       |
| `HMAC_SECRET`           | HMAC secret for verification codes   | Yes      | -                                       |
| `SENDER_EMAIL`          | Email for sending verification codes | Yes      | -                                       |
| `SENDER_EMAIL_PASSWORD` | Email password/app password          | Yes      | -                                       |
| `EMAIL_FROM`            | From address for emails              | No       | -                                       |

## 🚀 Ready to Use

This codebase provides a solid foundation for any application requiring user and admin authentication with email verification. Simply add your business-specific models, controllers, and routes to build your application on top of this authentication system.

The authentication system is production-ready with security best practices, role-based access control, email verification, and comprehensive error handling.

### Features Included:

✅ User registration with email verification  
✅ Secure login/logout  
✅ Admin role-based access control  
✅ Account lockout protection  
✅ Email verification with 6-digit codes  
✅ JWT token authentication  
✅ Password hashing with bcrypt  
✅ Input validation with Joi  
✅ Security middleware  
✅ Error handling
