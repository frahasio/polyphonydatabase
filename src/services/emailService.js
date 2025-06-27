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