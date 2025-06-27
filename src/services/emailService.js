import nodemailer from 'nodemailer';

// Email service for sending password reset emails
// Force deployment update
class EmailService {
  constructor() {
    this.transporter = null;
    this.setupTransporter();
  }

  setupTransporter() {
    // Default to Gmail configuration, but can be customized via environment variables
    const emailConfig = {
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD // Use App Password for Gmail
      }
    };

    // For other SMTP providers
    if (process.env.SMTP_HOST) {
      emailConfig.host = process.env.SMTP_HOST;
      emailConfig.port = process.env.SMTP_PORT || 587;
      emailConfig.secure = process.env.SMTP_SECURE === 'true';
      delete emailConfig.service; // Remove service when using custom SMTP
    }

    try {
      this.transporter = nodemailer.createTransport(emailConfig);
      console.log('Email service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize email service:', error);
      this.transporter = null;
    }
  }

  async sendPasswordResetEmail(email, resetToken) {
    if (!this.transporter) {
      console.error('Email service not configured. Check your environment variables.');
      return false;
    }

    const resetUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/admin/reset-password?token=${resetToken}`;
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: 'Password Reset - Polyphony Database',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; }
            .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { background: #333; color: #ccc; padding: 20px; text-align: center; font-size: 14px; }
            .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; margin: 20px 0; border-radius: 5px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Polyphony Database</h1>
              <p>Password Reset Request</p>
            </div>
            
            <div class="content">
              <h2>Password Reset Request</h2>
              <p>We received a request to reset the password for your account (${email}).</p>
              
              <p>Click the button below to reset your password:</p>
              
              <p style="text-align: center;">
                <a href="${resetUrl}" class="button">Reset Password</a>
              </p>
              
              <p>Or copy and paste this link into your browser:</p>
              <p style="word-break: break-all; background: #f1f1f1; padding: 10px; font-family: monospace;">
                ${resetUrl}
              </p>
              
              <div class="warning">
                <strong>Important:</strong>
                <ul>
                  <li>This link will expire in 1 hour</li>
                  <li>If you didn't request this reset, please ignore this email</li>
                  <li>Never share this link with anyone</li>
                </ul>
              </div>
            </div>
            
            <div class="footer">
              <p>This is an automated email from the Polyphony Database system.</p>
              <p>If you have any questions, please contact your system administrator.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      // Text version for email clients that don't support HTML
      text: `
        Password Reset Request - Polyphony Database
        
        We received a request to reset the password for your account (${email}).
        
        Please visit the following link to reset your password:
        ${resetUrl}
        
        This link will expire in 1 hour.
        
        If you didn't request this reset, please ignore this email.
        
        Never share this link with anyone.
      `
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log('Password reset email sent:', info.messageId);
      return true;
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      return false;
    }
  }

  async sendAccountApprovedEmail(email, name, isReactivation = false) {
    if (!this.transporter) {
      console.error('Email service not configured. Check your environment variables.');
      return false;
    }

    const loginUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/admin/login`;
    const subject = isReactivation ? 'Account Reactivated - Polyphony Database' : 'Account Approved - Polyphony Database';
    const headerText = isReactivation ? 'Account Reactivated' : 'Account Approved';
    const welcomeText = isReactivation ? `Welcome back, ${name}!` : `Welcome, ${name}!`;
    const mainText = isReactivation ? 
      'Good news! Your account for the Polyphony Database has been reactivated.' :
      'Great news! Your account request for the Polyphony Database has been approved.';
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: subject,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%); color: white; padding: 20px; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; }
            .button { display: inline-block; background: #27ae60; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { background: #333; color: #ccc; padding: 20px; text-align: center; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Polyphony Database</h1>
              <p>${headerText}</p>
            </div>
            
            <div class="content">
              <h2>${welcomeText}</h2>
              <p>${mainText}</p>
              
              <p>You can now log in to access the database using your email address and the password you created during registration.</p>
              
              <p style="text-align: center;">
                <a href="${loginUrl}" class="button">Login to Database</a>
              </p>
              
              <p><strong>Your login details:</strong></p>
              <ul>
                <li><strong>Email:</strong> ${email}</li>
                <li><strong>Password:</strong> The password you created during registration</li>
              </ul>
              
              <p>If you've forgotten your password, you can use the "Forgot Password" link on the login page.</p>
            </div>
            
            <div class="footer">
              <p>Welcome to the Polyphony Database!</p>
              <p>If you have any questions, please contact your system administrator.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        ${subject}
        
        ${welcomeText}
        
        ${mainText}
        
        You can now log in at: ${loginUrl}
        
        Your login details:
        Email: ${email}
        Password: The password you created during registration
        
        If you've forgotten your password, you can use the "Forgot Password" link.
      `
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log('Account approved email sent:', info.messageId);
      return true;
    } catch (error) {
      console.error('Failed to send account approved email:', error);
      return false;
    }
  }

  async sendAccountSuspendedEmail(email, name) {
    if (!this.transporter) {
      console.error('Email service not configured. Check your environment variables.');
      return false;
    }
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: 'Account Suspended - Polyphony Database',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); color: white; padding: 20px; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; }
            .footer { background: #333; color: #ccc; padding: 20px; text-align: center; font-size: 14px; }
            .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; margin: 20px 0; border-radius: 5px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Polyphony Database</h1>
              <p>Account Suspended</p>
            </div>
            
            <div class="content">
              <h2>Account Status Update</h2>
              <p>Dear ${name},</p>
              
              <div class="warning">
                <strong>Important:</strong> Your account for the Polyphony Database has been suspended.
              </div>
              
              <p>This means you will temporarily be unable to access the database until your account is reactivated.</p>
              
              <p><strong>What this means:</strong></p>
              <ul>
                <li>You cannot currently log in to the database</li>
                <li>Your existing research and data remain secure</li>
                <li>This suspension may be temporary pending review</li>
              </ul>
              
              <p>If you believe this is an error or would like to discuss reactivating your account, please contact the system administrator.</p>
            </div>
            
            <div class="footer">
              <p>This is an automated notification from the Polyphony Database system.</p>
              <p>For assistance, please contact your system administrator.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        Account Suspended - Polyphony Database
        
        Dear ${name},
        
        Your account for the Polyphony Database has been suspended.
        
        This means you will temporarily be unable to access the database until your account is reactivated.
        
        What this means:
        - You cannot currently log in to the database
        - Your existing research and data remain secure  
        - This suspension may be temporary pending review
        
        If you believe this is an error or would like to discuss reactivating your account, please contact the system administrator.
      `
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log('Account suspended email sent:', info.messageId);
      return true;
    } catch (error) {
      console.error('Failed to send account suspended email:', error);
      return false;
    }
  }

  async sendWelcomeEmail(email, name) {
    if (!this.transporter) {
      console.error('Email service not configured. Check your environment variables.');
      return false;
    }
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: 'Registration Received - Polyphony Database',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; }
            .footer { background: #333; color: #ccc; padding: 20px; text-align: center; font-size: 14px; }
            .info { background: #e8f4fd; border: 1px solid #bee5eb; padding: 15px; margin: 20px 0; border-radius: 5px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Polyphony Database</h1>
              <p>Registration Received</p>
            </div>
            
            <div class="content">
              <h2>Thank you for your interest, ${name}!</h2>
              <p>We have received your registration request for access to the Polyphony Database.</p>
              
              <div class="info">
                <strong>What happens next:</strong>
                <ul>
                  <li>Your request is now being reviewed by our administrators</li>
                  <li>We will notify you by email once your account has been reviewed</li>
                  <li>This process typically takes 1-3 business days</li>
                </ul>
              </div>
              
              <p><strong>Your registration details:</strong></p>
              <ul>
                <li><strong>Email:</strong> ${email}</li>
                <li><strong>Status:</strong> Pending approval</li>
              </ul>
              
              <p>Please keep this email for your records. Once approved, you'll receive another email with login instructions.</p>
            </div>
            
            <div class="footer">
              <p>Thank you for your interest in the Polyphony Database!</p>
              <p>If you have any questions, please contact your system administrator.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        Registration Received - Polyphony Database
        
        Thank you for your interest, ${name}!
        
        We have received your registration request for access to the Polyphony Database.
        
        What happens next:
        - Your request is now being reviewed by our administrators
        - We will notify you by email once your account has been reviewed
        - This process typically takes 1-3 business days
        
        Your registration details:
        Email: ${email}
        Status: Pending approval
        
        Please keep this email for your records. Once approved, you'll receive another email with login instructions.
      `
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log('Welcome email sent:', info.messageId);
      return true;
    } catch (error) {
      console.error('Failed to send welcome email:', error);
      return false;
    }
  }

  async sendAccountRejectedEmail(email, name) {
    if (!this.transporter) {
      console.error('Email service not configured. Check your environment variables.');
      return false;
    }
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: 'Account Request Update - Polyphony Database',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #95a5a6 0%, #7f8c8d 100%); color: white; padding: 20px; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; }
            .footer { background: #333; color: #ccc; padding: 20px; text-align: center; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Polyphony Database</h1>
              <p>Account Request Update</p>
            </div>
            
            <div class="content">
              <h2>Account Request Status</h2>
              <p>Dear ${name},</p>
              
              <p>Thank you for your interest in accessing the Polyphony Database.</p>
              
              <p>After reviewing your account request, we are unable to approve access at this time.</p>
              
              <p>This decision may be based on various factors related to our access policies and research requirements.</p>
              
              <p>If you believe there has been an error or if your circumstances have changed, you are welcome to contact the system administrator to discuss your request further.</p>
              
              <p>Thank you for your understanding.</p>
            </div>
            
            <div class="footer">
              <p>Thank you for your interest in the Polyphony Database.</p>
              <p>For questions, please contact your system administrator.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        Account Request Update - Polyphony Database
        
        Dear ${name},
        
        Thank you for your interest in accessing the Polyphony Database.
        
        After reviewing your account request, we are unable to approve access at this time.
        
        This decision may be based on various factors related to our access policies and research requirements.
        
        If you believe there has been an error or if your circumstances have changed, you are welcome to contact the system administrator to discuss your request further.
        
        Thank you for your understanding.
      `
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log('Account rejected email sent:', info.messageId);
      return true;
    } catch (error) {
      console.error('Failed to send account rejected email:', error);
      return false;
    }
  }

  // Test the email configuration
  async verifyConnection() {
    if (!this.transporter) {
      return false;
    }

    try {
      await this.transporter.verify();
      console.log('Email service connection verified');
      return true;
    } catch (error) {
      console.error('Email service verification failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export default new EmailService(); 