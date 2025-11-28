import express from 'express'

import { changePassword, requestPasswordReset, verifyResetCode, setNewPassword} from '../Controllers/Auth/PasswordController.js'
import { getUserProfile, updateUserProfile} from '../Controllers/User/ProfileController.js'
import { validateChangePassword } from '../middlewares/validateChangePassword.js'
import { validateRequestOtp, validateVerifyOtp, validateSetNewPassword} from '../middlewares/validatePasswordReset.js'
import { addSecurityHeaders } from '../middlewares/securityHeadersMiddleware.js'
import { protect } from '../Controllers/auth.controller.js'

const router = express.Router()

// Apply security headers to all routes
router.use(addSecurityHeaders)

// User profile and settings routes that require authentication
router.get('/profile', protect, getUserProfile)
router.post('/profile', protect, updateUserProfile)
router.post(
  '/change-password',
  protect,
  validateChangePassword,
  changePassword
)

// Password reset flow (doesn't require authentication)
router.post(
  '/request-password-reset',
  validateRequestOtp,
  requestPasswordReset
)
router.post('/verify-reset-code', validateVerifyOtp, verifyResetCode)
router.post('/reset-password', validateSetNewPassword, setNewPassword)

export default router
