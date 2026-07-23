import nodemailer from 'nodemailer';

// Escape user-supplied text before embedding in notification email HTML.
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Branded wrapper for commissioner-facing emails: the site's dark-red header
// bar over a white card. Table layout + inline styles for email-client
// compatibility (no external CSS or webfonts in email).
function emailShell(bodyHtml) {
  return `<div style="background-color:#f1f3f5;padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;border-collapse:separate;border-spacing:0;">
      <tr>
        <td style="background-color:#8b1538;background:linear-gradient(135deg,#8b1538 0%,#6d1029 100%);border-radius:8px 8px 0 0;padding:20px 28px;">
          <span style="color:#ffffff;font-size:22px;font-weight:600;font-family:'Palatino Linotype','Book Antiqua',Palatino,Georgia,serif;">&#9835; The Polyphony Database</span>
        </td>
      </tr>
      <tr>
        <td style="background-color:#ffffff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:28px;color:#1e293b;font-size:15px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
          ${bodyHtml}
        </td>
      </tr>
      <tr>
        <td style="padding:14px 8px;text-align:center;font-size:12px;font-family:Arial,Helvetica,sans-serif;">
          <a href="https://www.polyphonydatabase.com" style="color:#94a3b8;text-decoration:none;">www.polyphonydatabase.com</a>
        </td>
      </tr>
    </table>
  </div>`;
}

// "Bulletproof" email button (table-based so Outlook renders it).
function emailButton(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;">
    <tr><td bgcolor="#8b1538" style="border-radius:6px;">
      <a href="${esc(href)}" style="display:inline-block;padding:12px 30px;color:#ffffff;font-weight:bold;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:15px;">${esc(label)}</a>
    </td></tr>
  </table>`;
}

// Render BANK_TRANSFER_DETAILS as a table. The var is free-form: segments are
// split on newlines and pipes; a "Label: value" segment becomes a two-cell
// row, anything else spans the full width.
function bankDetailsTable(raw) {
  const segments = raw.split(/\r?\n|\|/).map((s) => s.trim()).filter(Boolean);
  if (!segments.length) return '';
  const cellStyle = 'padding:8px 14px;border-top:1px solid #e2e8f0;font-family:Consolas,Menlo,monospace;font-size:14px;color:#1e293b;';
  const rows = segments.map((seg, i) => {
    const border = i === 0 ? cellStyle.replace('border-top:1px solid #e2e8f0;', '') : cellStyle;
    const m = seg.match(/^([^:]{1,40}):\s*(.+)$/);
    if (m) {
      return `<tr>
        <td style="${border}font-family:Arial,Helvetica,sans-serif;color:#64748b;white-space:nowrap;">${esc(m[1])}</td>
        <td style="${border}">${esc(m[2])}</td>
      </tr>`;
    }
    return `<tr><td colspan="2" style="${border}">${esc(seg)}</td></tr>`;
  }).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background-color:#f8f9fa;border:1px solid #e2e8f0;border-radius:6px;margin:4px 0 16px;">${rows}</table>`;
}

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

  async sendAdminNotificationEmail(userEmail, userName) {
    if (!this.transporter) {
      console.error('Email service not configured. Check your environment variables.');
      return false;
    }

    const adminEmail = 'polyphonydatabase@gmail.com';
    const adminUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/admin/user-management`;
    

    
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: adminEmail,
      subject: 'New Account Registration - Polyphony Database',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #f39c12 0%, #e67e22 100%); color: white; padding: 20px; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; }
            .button { display: inline-block; background: #f39c12; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { background: #333; color: #ccc; padding: 20px; text-align: center; font-size: 14px; }
            .user-details { background: #fff; border: 1px solid #ddd; padding: 15px; margin: 20px 0; border-radius: 5px; }
            .priority { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; margin: 20px 0; border-radius: 5px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Polyphony Database</h1>
              <p>New Account Registration</p>
            </div>
            
            <div class="content">
              <h2>New User Registration</h2>
              <p>A new user has requested access to the Polyphony Database and is awaiting approval.</p>
              
              <div class="user-details">
                <h3>User Details:</h3>
                <ul>
                  <li><strong>Name:</strong> ${userName}</li>
                  <li><strong>Email:</strong> ${userEmail}</li>
                  <li><strong>Status:</strong> Pending approval</li>
                  <li><strong>Registration Time:</strong> ${new Date().toLocaleString()}</li>
                </ul>
              </div>
              
              <div class="priority">
                <strong>Action Required:</strong> Please review and approve/reject this registration request.
              </div>
              
              <p style="text-align: center;">
                <a href="${adminUrl}" class="button">Review Registration</a>
              </p>
              
              <p>You can approve, reject, or suspend this account from the user management panel.</p>
            </div>
            
            <div class="footer">
              <p>This is an automated notification from the Polyphony Database system.</p>
              <p>You are receiving this because you are an administrator.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        New Account Registration - Polyphony Database
        
        A new user has requested access to the Polyphony Database and is awaiting approval.
        
        User Details:
        Name: ${userName}
        Email: ${userEmail}
        Status: Pending approval
        Registration Time: ${new Date().toLocaleString()}
        
        Action Required: Please review and approve/reject this registration request.
        
        Review at: ${adminUrl}
        
        You can approve, reject, or suspend this account from the user management panel.
      `
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log('Admin notification email sent:', info.messageId);
      return true;
    } catch (error) {
      console.error('Failed to send admin notification email:', error);
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

  // Generic send helper (used by the commissions module).
  async sendMail({ to, subject, html }) {
    if (!this.transporter) {
      console.error('Email service not configured. Check your environment variables.');
      return false;
    }
    try {
      const info = await this.transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to,
        subject,
        html,
      });
      console.log('Email sent:', info.messageId);
      return true;
    } catch (error) {
      console.error('Failed to send email:', error);
      return false;
    }
  }

  // Notify the admin that a new commission enquiry arrived.
  async sendCommissionEnquiryAdmin(commission) {
    const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER || 'polyphonydatabase@gmail.com';
    const base = process.env.BASE_URL || 'http://localhost:3000';
    return this.sendMail({
      to: adminEmail,
      subject: 'New edition commission enquiry',
      html: `<p>A new commission enquiry has arrived.</p>
        <ul>
          <li><strong>From:</strong> ${esc(commission.commissioner_name)} (${esc(commission.commissioner_email)})</li>
          <li><strong>Piece:</strong> ${esc(commission.piece_description)}</li>
          <li><strong>Requirements:</strong> ${esc(commission.requirements) || '—'}</li>
        </ul>
        <p><a href="${esc(base)}/admin/commissions">Open the commissions admin</a> to set a price.</p>`,
    });
  }

  // Tell the commissioner their offer is ready (with the signed link).
  async sendCommissionOffer(commission) {
    const base = process.env.BASE_URL || 'http://localhost:3000';
    const link = `${base}/commission/${commission.access_token}`;
    const price = (commission.price_pence / 100).toLocaleString('en-GB', { style: 'currency', currency: commission.currency || 'GBP' });
    // Bank-transfer alternative: set BANK_TRANSFER_DETAILS (newlines and/or
    // pipes between segments, "Label: value" segments get a label column) to
    // include account details directly; otherwise we invite a reply.
    const bank = (process.env.BANK_TRANSFER_DETAILS || '').trim();
    const bankIntro = 'If you would prefer to pay by bank transfer <em>(more of the profit gets reinvested in the database!)</em>';
    const bankBlock = bank
      ? `<p style="margin-bottom:8px;">${bankIntro}:</p>
        ${bankDetailsTable(bank)}
        <p>Please use your name as the payment reference, and reply to this email once sent so I can confirm receipt.</p>`
      : `<p>${bankIntro}, just reply to this email and I will send account details.</p>`;
    return this.sendMail({
      to: commission.commissioner_email,
      subject: 'Your edition commission — price and next steps',
      html: emailShell(`<p style="margin-top:0;">Dear ${esc(commission.commissioner_name)},</p>
        <p>Thank you for your commission enquiry for <strong>${esc(commission.piece_description)}</strong>.</p>
        <p>I can prepare this edition for <strong>${esc(price)}</strong>.</p>
        ${commission.admin_note ? `<p>${esc(commission.admin_note)}</p>` : ''}
        <p style="margin-bottom:0;">To accept and pay by card, or to decline, please visit:</p>
        ${emailButton(link, 'Pay by card')}
        <p style="font-size:12px;color:#64748b;margin-top:0;">or copy this link: <a href="${esc(link)}" style="color:#8b1538;">${esc(link)}</a></p>
        ${bankBlock}
        <p style="margin-bottom:0;">If you'd like to discuss changes first, just reply to this email.</p>`),
    });
  }

  // Tell the commissioner their finished edition is ready.
  async sendCommissionReadyEmail(commission) {
    const link = commission.edition_url && /^https?:\/\//i.test(commission.edition_url)
      ? commission.edition_url
      : '';
    return this.sendMail({
      to: commission.commissioner_email,
      subject: 'Your commissioned edition is ready',
      html: emailShell(`<p style="margin-top:0;">Dear ${esc(commission.commissioner_name)},</p>
        <p>Your commissioned edition of <strong>${esc(commission.piece_description)}</strong> is now ready.</p>
        ${link ? `<p style="margin-bottom:0;">You can download it here:</p>
        ${emailButton(link, 'Download your edition')}
        <p style="font-size:12px;color:#64748b;margin-top:0;">or copy this link: <a href="${esc(link)}" style="color:#8b1538;">${esc(link)}</a></p>`
               : `<p>We will be in touch with the finished edition shortly.</p>`}
        <p style="margin-bottom:0;">Thank you for supporting the Polyphony Database.</p>`),
    });
  }

  // Notify the admin that a commission was paid.
  async sendCommissionPaidAdmin(commission) {
    const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER || 'polyphonydatabase@gmail.com';
    const price = (commission.price_pence / 100).toLocaleString('en-GB', { style: 'currency', currency: commission.currency || 'GBP' });
    return this.sendMail({
      to: adminEmail,
      subject: `Commission paid: ${price} — ${commission.piece_description}`,
      html: `<p>${esc(commission.commissioner_name)} has paid ${esc(price)} for an edition of
        <strong>${esc(commission.piece_description)}</strong>.</p>
        <p><strong>Requirements / comments:</strong> ${esc(commission.requirements) || '—'}</p>
        <p><strong>Contact:</strong> ${esc(commission.commissioner_email)}</p>`,
    });
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