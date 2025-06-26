# Authentication System Setup Guide

## Overview

I've implemented a comprehensive authentication system for your Polyphony Database. This system replaces the basic username/password approach with a secure email-based registration system that includes admin approval.

## Key Features

### ✅ Secure Email-Based Authentication
- Users register with email addresses instead of usernames
- Password hashing using bcrypt with 12 salt rounds
- Session-based authentication with JWT tokens
- Account lockout after 5 failed login attempts (30-minute lockout)

### ✅ Admin Approval Workflow
- New registrations require admin approval
- Four user states: `pending`, `approved`, `rejected`, `suspended`
- Admin interface for managing user registrations
- Role-based access control (`user` and `admin` roles)

### ✅ Security Features
- Rate limiting on login (5 attempts per 15 minutes) and registration (3 per hour)
- Password strength requirements (minimum 8 characters)
- Secure password reset with tokens
- Session management with secure cookies
- CSRF protection ready

### ✅ User Experience
- Professional login and registration pages
- Real-time password strength indicator
- Clear error messages and user feedback
- Responsive design for mobile devices

## Files Created/Modified

### Backend Files
- `src/middleware/auth.js` - Authentication middleware
- `src/routes/auth.js` - Authentication routes and user management
- `src/index.js` - Updated with session management and protected routes
- `package.json` - Added authentication dependencies
- `migration.sql` - Database schema updates

### Frontend Files
- `public/login.html` - Professional login page
- `public/register.html` - User registration page
- `public/forgot-password.html` - Password reset page
- `public/user-management.html` - Admin user management interface
- `public/index.html` - Updated with logout and admin features

## Setup Instructions

### 1. Install Dependencies
The following new dependencies were added to package.json:
- `bcrypt` - Password hashing
- `express-session` - Session management
- `jsonwebtoken` - JWT token handling
- `express-rate-limit` - Rate limiting
- `validator` - Email validation

### 2. Run Database Migration
Execute the migration script to update your users table:
```sql
-- Connect to your PostgreSQL database and run migration.sql
```

### 3. Set Environment Variables
Add these to your environment:
```bash
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
SESSION_SECRET=your-super-secret-session-key-change-this-in-production
NODE_ENV=development
DATABASE_URL=your-database-connection-string
```

### 4. Default Admin Account
The migration creates a default admin account:
- **Email:** `admin@polyphony.local`
- **Password:** `tempPassword123!`

**⚠️ CRITICAL: Change this password immediately after first login!**

## API Endpoints

### Authentication Routes (`/api/auth/`)
- `POST /register` - User registration
- `POST /login` - User login
- `POST /logout` - User logout
- `GET /me` - Get current user info
- `POST /change-password` - Change user password
- `POST /forgot-password` - Request password reset
- `POST /reset-password` - Reset password with token

### Admin Routes (`/api/auth/admin/`)
- `GET /users` - List all users (with pagination)
- `PUT /users/:id/status` - Update user status
- `PUT /users/:id/role` - Update user role

## User Management

### User Status Flow
1. **Pending** - New registrations await approval
2. **Approved** - Users can access the system
3. **Rejected** - Access denied
4. **Suspended** - Temporarily blocked

### Admin Functions
Access `/user-management.html` as an admin to:
- View all user registrations
- Approve or reject pending users
- Suspend or reactivate users
- Change user roles (user ↔ admin)
- View user statistics and activity

## Security Features

### What's Protected
- All `/api/` routes except `/api/auth/` require authentication
- All admin module pages (`/modules/`, `/js/`, `/css/`) require authentication
- Main dashboard (`/`) redirects to login if not authenticated
- Admin functions require admin role

### Rate Limiting
- Login: 5 attempts per 15 minutes per IP
- Registration: 3 attempts per hour per IP
- Account lockout: 30 minutes after 5 failed login attempts

### Password Security
- Minimum 8 characters required
- Bcrypt hashing with 12 salt rounds
- Password change requires current password verification
- Password reset uses secure tokens with 1-hour expiry

## Testing the System

1. **Start the server** (once Node.js is installed)
2. **Test login with default admin:**
   - Visit `http://localhost:3000`
   - You'll be redirected to `/login.html`
   - Login with `admin@polyphony.local` / `tempPassword123!`

3. **Test registration flow:**
   - Visit `/register.html`
   - Register a new account
   - Login as admin and approve the new user via `/user-management.html`

## Next Steps

1. **Install Node.js if not already installed**
2. **Install the new dependencies**
3. **Run the database migration**
4. **Change the default admin password**
5. **Set proper environment variables**
6. **Test the authentication system**

## Public Interface Development

Now that authentication is in place, you can proceed with building the public interface. The system is set up so that:
- Public users will be redirected to login when accessing admin areas
- You can create public-facing pages that don't require authentication
- The admin approval process ensures only authorized users access the cataloguing tools 