# 🚨 QUICK FIX - Authentication Not Working

## The Problem
Your Heroku logs show a **rate limiting error** that's preventing login from working.

## ⚡ Quick Solution (3 Steps)

### Step 1: Deploy the Trust Proxy Fix
```bash
git add .
git commit -m "Fix trust proxy for Heroku"
git push heroku main
```

### Step 2: Create Admin User Directly  
```bash
heroku pg:psql --app your-app-name -c "
INSERT INTO users (email, password_hash, name, status, role, created_at) 
VALUES ('admin@polyphony.local', '\$2b\$12\$LQv3c1yqBw2fonYKz/VBKO6krNqgCGVU3/p8Z/5dJe3MUZ3DHgm3W', 'System Administrator', 'approved', 'admin', CURRENT_TIMESTAMP) 
ON CONFLICT (email) DO UPDATE SET 
password_hash = '\$2b\$12\$LQv3c1yqBw2fonYKz/VBKO6krNqgCGVU3/p8Z/5dJe3MUZ3DHgm3W', 
status = 'approved', 
role = 'admin';
"
```

### Step 3: Test Login
- Go to: `https://your-app-name.herokuapp.com`
- Login with: `admin@polyphony.local` / `tempPassword123!`

## ✅ Expected Result
- No more rate limiting errors
- Login should work immediately
- You'll be redirected to the dashboard

## 🔧 Alternative: Use Debug Script
If you prefer the automated approach:
```bash
heroku run npm run debug-auth --app your-app-name
```

## 🛡️ After Login Works
1. **Change the default password immediately**
2. **Set environment variables:**
   ```bash
   heroku config:set JWT_SECRET=your-secret-here
   heroku config:set SESSION_SECRET=another-secret-here
   ```

---

**What was fixed:**
- ✅ Added `trust proxy` setting for Heroku
- ✅ Fixed session cookie configuration  
- ✅ Created/updated admin user in database

**Why it failed before:**
- Rate limiter couldn't handle Heroku's proxy headers
- Database migration might not have run properly 