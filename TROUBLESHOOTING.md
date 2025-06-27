# Authentication Troubleshooting Guide

## Problem: "Invalid email or password" with default admin account

If you're getting "invalid email or password" when trying to login with `admin@polyphony.local` / `tempPassword123!`, here are the most likely causes and solutions:

### 🔍 Quick Diagnosis

Run this command in your Heroku app to diagnose the issue:
```bash
npm run debug-auth
```

This will check your database state and automatically fix common issues.

### 🛠️ Solution Options

#### Option 1: Run the Debug Script (Recommended)

1. **In Heroku CLI:**
   ```bash
   heroku run npm run debug-auth --app your-app-name
   ```

2. **Or via Heroku Dashboard:**
   - Go to your app → More → Run console
   - Enter: `npm run debug-auth`

The script will:
- ✅ Check if users table exists
- ✅ Verify table structure
- ✅ Look for existing users
- ✅ Test the admin password hash
- ✅ Create/fix the admin user if needed

#### Option 2: Run Database Migration Manually

If the migration didn't run on your production database:

1. **Connect to your Heroku Postgres:**
   ```bash
   heroku pg:psql --app your-app-name
   ```

2. **Run the focused migration:**
   ```sql
   \i fix-users-table.sql
   ```

   Or copy/paste the contents of `fix-users-table.sql`

#### Option 3: Manual Database Fix

Connect to your database and run these commands:

```sql
-- Check if users table exists
SELECT table_name FROM information_schema.tables WHERE table_name = 'users';

-- If it doesn't exist or has wrong structure, create it:
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    reset_token VARCHAR(255) NULL,
    reset_token_expires TIMESTAMP NULL,
    last_login TIMESTAMP NULL,
    login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create the admin user
INSERT INTO users (email, password_hash, name, status, role) VALUES 
('admin@polyphony.local', '$2b$12$LQv3c1yqBw2fonYKz/VBKO6krNqgCGVU3/p8Z/5dJe3MUZ3DHgm3W', 'System Administrator', 'approved', 'admin');

-- Verify it was created
SELECT email, name, status, role FROM users WHERE email = 'admin@polyphony.local';
```

### 🔍 Common Causes

1. **Migration didn't run on production**
   - The migration script wasn't executed on your Heroku Postgres database
   - **Solution:** Run `fix-users-table.sql` or the debug script

2. **Wrong database environment**
   - Your app might be connecting to a different database than expected
   - **Check:** Verify `DATABASE_URL` environment variable in Heroku

3. **Bcrypt version mismatch**
   - Different bcrypt versions might generate different hashes
   - **Solution:** The debug script will regenerate the hash with your current bcrypt version

4. **Case sensitivity issues**
   - Email might be stored differently than expected
   - **Solution:** The debug script handles this automatically

### 🎯 After Fixing

Once you can login successfully:

1. **Change the default password immediately:**
   - Login with `admin@polyphony.local` / `tempPassword123!`
   - Go to your profile and change the password

2. **Set proper environment variables:**
   ```bash
   heroku config:set JWT_SECRET=your-long-random-string --app your-app-name
   heroku config:set SESSION_SECRET=another-long-random-string --app your-app-name
   ```

3. **Test the authentication flow:**
   - Try logging out and back in
   - Test user registration
   - Test the admin user management interface

### 🚨 If Nothing Works

If you're still having issues:

1. **Check Heroku logs:**
   ```bash
   heroku logs --tail --app your-app-name
   ```

2. **Verify environment variables:**
   ```bash
   heroku config --app your-app-name
   ```
   Make sure `DATABASE_URL` is set correctly.

3. **Test database connection:**
   ```bash
   heroku run node -e "import('./src/db.js').then(({pool}) => pool.query('SELECT NOW()').then(r => console.log('DB Connected:', r.rows[0])))" --app your-app-name
   ```

4. **Check app dependencies:**
   Make sure all authentication dependencies are installed:
   ```bash
   heroku run npm list bcrypt express-session jsonwebtoken --app your-app-name
   ```

### 📝 Debug Information to Collect

If you need further help, gather this information:

1. **Heroku logs when trying to login**
2. **Database table structure:** `\d users` in psql
3. **Environment variables** (don't share secrets, just confirm they exist)
4. **Output from the debug script**

### 🔄 Starting Fresh

If you want to completely reset the authentication system:

```sql
-- WARNING: This will delete all users!
DROP TABLE IF EXISTS users CASCADE;
-- Then run fix-users-table.sql
```