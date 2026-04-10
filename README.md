# Polyphony Database

A comprehensive web application for cataloguing and managing polyphonic music sources from the Renaissance period. This system provides tools for researchers, musicologists, and librarians to document musical manuscripts and printed sources with detailed metadata, compositions, and analytical data.

## Features

### 🔍 **Source Management**
- Catalog manuscripts and printed sources with comprehensive metadata
- Track source types, formats, locations, and dating information
- Link sources to publishers, scribes, and institutions
- Manage source images and digital resources

### 🎵 **Composition Cataloguing**
- Document individual compositions with titles, composers, and musical details
- Support multiple languages for titles and annotations
- Track composition types (Mass, Motet, Chanson, etc.)
- Link compositions to their sources and performance contexts

### 👥 **Contributor Management**
- Comprehensive database of composers, editors, performers, and scribes
- Biographical information and historical context
- Attribution tracking and uncertainty handling

### 🎼 **Musical Analysis**
- Clef combination tracking and voicing analysis
- Tone and mode documentation
- Performance practice annotations
- Musical function classification

### 🔐 **User Management**
- Secure authentication system with role-based access
- Admin approval workflow for new users
- User activity tracking and audit logging

### 📊 **Data Quality**
- Automated data quality checks and alerts
- Validation for musical terminology and relationships
- Cleanup tools for orphaned or inconsistent data

## Technology Stack

- **Backend**: Node.js with Express.js
- **Database**: PostgreSQL with advanced JSONB features
- **Authentication**: JWT-based with bcrypt password hashing
- **Frontend**: Vanilla JavaScript with responsive HTML/CSS
- **Deployment**: Heroku-ready with Procfile configuration

## Quick Start

### Prerequisites
- Node.js 18.0.0 or higher
- PostgreSQL database
- npm or yarn package manager

### Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd polyphonydatabase
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   Create a `.env` file with:
   ```env
   DATABASE_URL=your_postgresql_connection_string
   JWT_SECRET=your_jwt_secret_key
   SESSION_SECRET=your_session_secret
   NODE_ENV=development
   ```

4. **Set up the database:**
   - Create a PostgreSQL database
   - Run the schema migration (see `migration.sql`)
   - The system will create default admin user on first run

5. **Start the development server:**
   ```bash
   npm run dev
   ```

6. **Access the application:**
   - Open `http://localhost:3000` in your browser
   - Login with the default admin account (see setup instructions)

## Database Schema

The application uses a comprehensive PostgreSQL schema designed for musical source cataloguing. Key tables include:

- **sources**: Manuscript and printed source metadata
- **compositions**: Individual musical works
- **groups**: Collections of related compositions
- **inclusions**: Source-composition relationships
- **contributors**: Composers, editors, performers, scribes
- **clef_combinations**: Musical notation analysis
- **audit_log**: Complete change tracking

For detailed schema information, see `SCHEMA_REFERENCE.md`.

## Liturgy booklet PDF export (server)

The booklet **Download PDF** button calls `POST /api/booklet/pdf` (signed-in users). The server renders HTML with **Puppeteer** and **headless Chrome/Chromium**. A **503** response almost always means the host cannot load Puppeteer or cannot start a browser—not a bug in the booklet editor.

### Local development

Run `npm install`. The `postinstall` script runs `npx puppeteer browsers install chrome` so a Chromium build is available to Puppeteer.

### Production (e.g. Heroku)

1. **Install a real Chrome/Chromium on the dyno** (Puppeteer’s downloaded browser is easy to lose or block on slim images). Typical approach: add a **Google Chrome** / **Chrome for Testing** [Heroku buildpack](https://elements.heroku.com/buildpacks) or an **apt** buildpack that installs `google-chrome-stable` or `chromium`.
2. **Point Puppeteer at that binary**, for example:
   - `PUPPETEER_EXECUTABLE_PATH=/app/.apt/usr/bin/google-chrome-stable`  
   (exact path depends on the buildpack; use `heroku run ls /app/.apt/usr/bin/` or similar to confirm.)
   - Alternatively set `GOOGLE_CHROME_BIN` to the same path (this app checks both).
3. **Optional (saves slug size):** set `PUPPETEER_SKIP_DOWNLOAD=true` before install so npm does not also download Chromium if you only use the system binary.
4. Redeploy and watch logs when triggering PDF export. Messages like `puppeteer import failed` vs `puppeteer launch failed` tell you whether the problem is **missing npm module** vs **missing/broken Chrome**.

### Quick sanity check on the server

After deploy, from the project root:

```bash
node -e "import('puppeteer').then(async m => { const b = await m.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'], executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined }); await b.close(); console.log('puppeteer ok'); })"
```

If that throws, fix Node/Puppeteer/Chrome on the host before expecting the booklet PDF route to work.

## API Documentation

The application provides a RESTful API for programmatic access:

- **Authentication**: `/api/auth/*` - Login, registration, user management
- **Sources**: `/api/sources/*` - Source CRUD operations
- **Compositions**: `/api/compositions/*` - Composition management
- **Search**: `/api/search/*` - Advanced search functionality
- **Admin**: `/api/admin/*` - Administrative functions

## Contributing

This is a research tool designed for musicological applications. Contributions are welcome, particularly:

- Data quality improvements
- Additional musical terminology support
- Enhanced search capabilities
- User interface improvements
- Documentation updates

Please ensure all contributions maintain data integrity and follow established coding standards.

## License

[Add your license information here]

## Support

For technical support or questions about the database schema, please refer to the documentation or create an issue in the repository.

---

**Note**: This system is designed for academic and research use. Please ensure compliance with relevant data protection and copyright regulations when cataloguing musical sources.
