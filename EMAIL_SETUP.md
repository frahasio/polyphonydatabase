# Email Setup Guide

Your password reset functionality is now implemented, but you need to configure email settings for it to work.

## Required Environment Variables

Add these to your Heroku app configuration:

### For Gmail (Recommended)

1. **Create a Gmail App Password:**
   - Go to your Google Account settings
   - Security → 2-Step Verification → App Passwords
   - Generate an app password for "Mail"

2. **Set these environment variables in Heroku:**
   ```bash
   EMAIL_SERVICE=gmail
   EMAIL_USER=your-gmail-address@gmail.com
   EMAIL_PASSWORD=your-app-password-here
   EMAIL_FROM=your-gmail-address@gmail.com
   BASE_URL=https://your-app-name.herokuapp.com
   ```

### For Other Email Providers

If you're using a different SMTP provider (like SendGrid, Mailgun, etc.):

```bash
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_SECURE=false
EMAIL_USER=your-username
EMAIL_PASSWORD=your-password
EMAIL_FROM=no-reply@yourdomain.com
BASE_URL=https://your-app-name.herokuapp.com
```

## Setting Environment Variables in Heroku

### Option 1: Heroku CLI
```bash
heroku config:set EMAIL_SERVICE=gmail --app your-app-name
heroku config:set EMAIL_USER=your-email@gmail.com --app your-app-name
heroku config:set EMAIL_PASSWORD=your-app-password --app your-app-name
heroku config:set EMAIL_FROM=your-email@gmail.com --app your-app-name
heroku config:set BASE_URL=https://your-app-name.herokuapp.com --app your-app-name
```

### Option 2: Heroku Dashboard
1. Go to your app in the Heroku dashboard
2. Click "Settings" tab
3. Click "Reveal Config Vars"
4. Add each variable:
   - `EMAIL_SERVICE` = `gmail`
   - `EMAIL_USER` = `your-email@gmail.com`
   - `EMAIL_PASSWORD` = `your-app-password`
   - `EMAIL_FROM` = `your-email@gmail.com`
   - `BASE_URL` = `https://your-app-name.herokuapp.com`

## Deploy the Changes

After setting the environment variables, deploy your updated code:

```bash
git add .
git commit -m "Add email functionality for password reset"
git push heroku node-rewrite
```

## Testing

1. Go to your app's forgot password page
2. Enter an email address
3. Check that the email is sent and received
4. Follow the reset link to test the full flow

## Troubleshooting

### Common Issues:

1. **"Email service not configured" error:**
   - Check that all environment variables are set correctly
   - Verify EMAIL_USER and EMAIL_PASSWORD are correct

2. **Gmail authentication errors:**
   - Make sure you're using an App Password, not your regular password
   - Enable 2-Step Verification first

3. **Emails not being received:**
   - Check spam/junk folders
   - Verify the recipient email address exists in your user database
   - Check Heroku logs: `heroku logs --tail --app your-app-name`

4. **SMTP connection errors:**
   - Double-check SMTP_HOST and SMTP_PORT settings
   - Verify your email provider allows SMTP access

## Security Notes

- Never commit email passwords to your repository
- Use App Passwords for Gmail (more secure than regular passwords)
- Consider using dedicated email services like SendGrid for production
- The reset tokens expire after 1 hour for security 