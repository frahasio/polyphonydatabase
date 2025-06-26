# Quick Fix for Heroku Authentication Issues

## Issue Identified

Your Heroku logs show a **rate limiting configuration error**:
```ValidationError: The 'X-Forwarded-For' header is set but the Express 'trust proxy' setting is false
```

This prevents the login from working because the rate limiter fails.

## ✅ Fix Applied

I've updated `src/index.js` to:
1. **Add `app.set('trust proxy', 1)`** - Tells Express to trust Heroku's proxy headers
2. **Updated session cookie settings** - Compatible with Heroku's HTTPS setup

## 🚀 Deploy the Fix

**Step 1: Deploy the changes**
```bash
git add .
git commit -m "Fix: Add trust proxy setting for Heroku rate limiting"
git push heroku main
```

**Step 2: Run the debug script to check database**
```bash
heroku run npm run debug-auth --app your-app-name
```

**Step 3: Test login**
- Go to your Heroku app URL
- Try logging in with: `admin@polyphony.local` / `tempPassword123!`

## 🔍 What the Debug Script Will Do

The debug script will automatically:
- ✅ Check if users table exists
- ✅ Verify table structure  
- ✅ Look for the admin user
- ✅ Test the password hash
- ✅ Create/fix the admin user if needed

## 📝 Expected Results

After deployment, you should see:
- No more rate limiting errors in Heroku logs
- Login page loads successfully
- Authentication works properly

## 🛡️ Security Setup (After Login Works)

Once you can login successfully:

```bash
# Set proper environment variables
heroku config:set JWT_SECRET=$(openssl rand -base64 32) --app your-app-name
heroku config:set SESSION_SECRET=$(openssl rand -base64 32) --app your-app-name
```

## 🚨 If Still Having Issues

If login still doesn't work after deployment:

1. **Check new logs:**
   ```bash
   heroku logs --tail --app your-app-name
   ```

2. **Verify the trust proxy fix worked** - You should no longer see the rate limiting error

3. **Run debug script again:**
   ```bash
   heroku run npm run debug-auth --app your-app-name
   ```

The trust proxy setting should fix the immediate rate limiting issue, and the debug script will handle any database problems. 