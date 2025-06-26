# Polyphony Database Schema Reference

## Core Tables

### clef_combinations
```sql
id (PK, INTEGER, AUTO)
clef_combination (VARCHAR, NOT NULL, UNIQUE) -- e.g., "g2c2c3f3", "c1c1c2c4f4"
```
Automatically populated by source editor when new clef combinations are created.

### voicings
```sql
id (PK, INTEGER, AUTO) 
voicing (VARCHAR, NOT NULL, UNIQUE) -- e.g., "SATB", "SSAATBarB", "SSA"
```
Manually maintained list of voicing types.

### clef_combinations_voicings (Many-to-Many)
```sql
clef_combination_id (FK -> clef_combinations.id)
voicing_id (FK -> voicings.id)
PRIMARY KEY (clef_combination_id, voicing_id)
```
Associates voicing types with clef combinations through admin interface.

#### Voicing Filter Implementation
The public search voicing filter works by:

1. **Clef Combination Lookup**: Gets all clef combinations associated with selected voicings from `clef_combinations_voicings`
2. **Clef Parsing**: Parses the `clef_combination` string (e.g., "g2c2c3f3") into individual clef identifiers
3. **JSONB Path Matching**: Uses PostgreSQL's `jsonb_path_exists()` to match against the `clefs` JSONB field in inclusions
4. **Count Validation**: Ensures the inclusion has exactly the same number of clefs as the combination

**SQL Pattern:**
```sql
EXISTS (
  SELECT 1 FROM compositions c2
  JOIN inclusions i ON c2.id = i.composition_id
  WHERE c2.group_id = g.id 
  AND i.clefs IS NOT NULL
  AND jsonb_array_length(i.clefs) = [clef_count]
  AND jsonb_path_exists(i.clefs, '$[*] ? (@.clef == "g2")')
  AND jsonb_path_exists(i.clefs, '$[*] ? (@.clef == "c2")')
  [... for each clef in combination]
)
```

This approach is robust against clef object properties like `optional`, `missing`, `incomplete`, or `transitions_to`.

### ignored_alerts
```sql
id (PK, INTEGER, AUTO)
alert_type (VARCHAR, NOT NULL) -- e.g., 'clef_combo_no_voicing', 'voicing_no_clef_combo'
entity_type (VARCHAR, NOT NULL) -- e.g., 'clef_combination', 'voicing', 'composer', 'group'
entity_id (INTEGER, NOT NULL) -- ID of the entity to ignore
ignored_by (INTEGER, FK -> users.id)
ignored_at (TIMESTAMP, DEFAULT CURRENT_TIMESTAMP)
reason (TEXT)
UNIQUE(alert_type, entity_type, entity_id)
```
Tracks permanently dismissed data quality alerts.

#### Data Quality Management
The system automatically detects and reports:
- **Unused clef combinations**: Clef combinations not linked to any voicings
- **Unused voicings**: Voicings not linked to any clef combinations  
- **Invalid clef combinations**: Combinations containing non-existent clef names
- **Unused titles**: Titles not linked to compositions or functions
- **Empty groups**: Groups with no compositions
- **Orphaned compositions**: Compositions referencing non-existent groups

**Valid Clef Names:**
`g1`, `g2`, `g3`, `g4`, `g5`, `g28`, `c1`, `c2`, `c3`, `c4`, `c5`, `f1`, `f2`, `f3`, `f4`, `f5`, `d1`, `d2`, `d3`, `d4`, `d5`, `x1`, `x2`, `x3`, `x4`, `x5`, `y1`, `y2`, `y3`, `y4`, `y5`, `org`, `bc`, `lut`

**Cleanup Operations:**
- Can be run individually by type or all together
- Include preview mode to show what would be deleted
- Support both unused and invalid data cleanup
- Transaction-safe with rollback on error

## Legacy Tables

### sources
```sql
id (PK, INTEGER, AUTO)
code (VARCHAR, UNIQUE, NOT NULL)
title (VARCHAR)
type (VARCHAR) -- 'MS', 'Print', 'Print/MS'
format (VARCHAR) -- 'Choirbook', 'Partbook', 'Score', 'Tablature', 'Tablebook', 'Multiple_choirbooks', 'Choirbook/score', 'Partbook/score', 'Unidentifiable/fragment'
town (VARCHAR)
rism_link (VARCHAR)
catalogued (BOOLEAN, DEFAULT FALSE)
from_year (INTEGER)
to_year (INTEGER)
from_year_annotation (VARCHAR) -- e.g., 'c.', 'ca.', 'before', 'after'
to_year_annotation (VARCHAR)
created_at (TIMESTAMP)
updated_at (TIMESTAMP)
```

### source_images
```sql
id (PK, INTEGER, AUTO)
url (VARCHAR, NOT NULL)
label (VARCHAR)
source_id (FK -> sources.id)
created_at (TIMESTAMP)
updated_at (TIMESTAMP)
```

### publishers
```sql
id (PK, INTEGER, AUTO)
name (VARCHAR, NOT NULL)
created_at (TIMESTAMP)
updated_at (TIMESTAMP)
```

### scribes
```sql
id (PK, INTEGER, AUTO)
name (VARCHAR, NOT NULL)
created_at (TIMESTAMP)
updated_at (TIMESTAMP)
```

### publishers_sources (Many-to-Many)
```sql
publisher_id (FK -> publishers.id)
source_id (FK -> sources.id)
PRIMARY KEY (publisher_id, source_id)
```

### scribes_sources (Many-to-Many)
```sql
scribe_id (FK -> scribes.id)
source_id (FK -> sources.id)
PRIMARY KEY (scribe_id, source_id)
```

## Composition Tables

### titles
```sql
id (PK, INTEGER, AUTO)
text (TEXT, NOT NULL)
language (INTEGER)
created_at (TIMESTAMP)
updated_at (TIMESTAMP)
```

### composition_types
```sql
id (PK, INTEGER, AUTO) -- Note: Should be INT not BIGINT
name (TEXT, NOT NULL) 
created_at (TIMESTAMP)
updated_at (TIMESTAMP)
```

**Values:**
- Mass, Hymn, Responsory, Alleluia, Instrumental, Introit, Lamentation, Litany, Passion, Service, Reading, Response(s), Verse anthem, Round/canon, Reproaches, Alternatim psalm/canticle, Requiem/Burial service, Sequence

### groups
```sql
id (PK, INTEGER, AUTO)
display_title (TEXT)
created_at (TIMESTAMP)
updated_at (TIMESTAMP)
```

### compositions
```sql
id (PK, INTEGER, AUTO)
number_of_voices (INTEGER)
group_id (INTEGER, FK -> groups.id)
title_id (INTEGER, FK -> titles.id)
composition_type_id (INTEGER, FK -> composition_types.id) -- Should be INT not BIGINT
tone (TEXT) -- See tone values below, null allowed
even_odd (TEXT) -- 'even', 'odd', 'both', null allowed
composer_id_list (INTEGER[]) -- Array of composer IDs
created_at (TIMESTAMP)
updated_at (TIMESTAMP)

-- UNIQUE CONSTRAINT on (number_of_voices, title_id, composition_type_id, tone, even_odd, composer_id_list)
-- number_of_voices auto-calculated from clefs but still part of uniqueness
```

### composers
```sql
id (PK, INTEGER, AUTO)
name (TEXT, NOT NULL)
from_year (INTEGER)
to_year (INTEGER)
birthplace_1 (TEXT)
birthplace_2 (INTEGER)
deathplace_1 (TEXT)
deathplace_2 (INTEGER)
image_url (TEXT)
created_at (TIMESTAMP)
updated_at (TIMESTAMP)
```

### inclusions
```sql
id (PK, INTEGER, AUTO)
source_id (INTEGER, FK -> sources.id, NOT NULL)
composition_id (INTEGER, FK -> compositions.id)
notes (TEXT)
order (INTEGER) -- Sort order within source
position (TEXT) -- Folio/page reference
clefs (JSONB) -- Array of clef objects
attribution_texts (JSONB) -- Array of attribution strings as they appear in source
composer_ids (JSONB) -- Array of composer IDs this attribution refers to
created_at (TIMESTAMP)
updated_at (TIMESTAMP)
```

## API Data Formats

### GET /api/sources/:id Response
```json
{
  "source": {
    "id": 3161,
    "code": "ABC123",
    "title": "Source Title",
    "type": "MS",
    "format": "Choirbook",
    "town": "Paris",
    "rism_link": "https://rism.info/sources/123456",
    "catalogued": true,
    "created_at": "2023-01-15T10:30:00.000Z",
    "updated_at": "2023-06-20T11:28:00.000Z",
    "from_year": 1450,
    "to_year": 1500,
    "from_year_annotation": "c.",
    "to_year_annotation": "after",
    "publishers": [
      {"id": 1, "name": "Petrucci Press"}
    ],
    "scribes": [
      {"id": 3, "name": "Johannes Scriptor"}
    ],
    "source_images": [
      {
        "id": 12,
        "url": "https://example.com/images/source123_page1.jpg",
        "label": "Folio 1r"
      }
    ]
  },
  "inclusions": [
    {
      "id": 1234,
      "source_id": 3161,
      "composition_id": 5678,
      "notes": "Some notes about this inclusion",
      "order": 1,
      "position": "f.1r",
      "attribution_texts": ["Josquin", "des Prez"],
      "composer_ids": [10, 11],
      "clefs": [
        {
          "clef": "c3",
          "missing": false,
          "optional": false,
          "incomplete": false,
          "transitions_to": []
        },
        {
          "clef": "c4",
          "missing": true,
          "optional": false,
          "incomplete": false,
          "transitions_to": []
        }
      ],
      // Resolved composition data for display:
      "composition": {
        "title_text": "Ave Maria", 
        "composition_type_name": "Motet",
        "tone": "1",
        "even_odd": null,
        "composer_names": ["Josquin des Prez", "Pierre de la Rue"]
      }
    }
  ],
  "pagination": {
    "total": 25,
    "page": 1,
    "limit": 40,
    "totalPages": 1,
    "hasNextPage": false,
    "hasPrevPage": false
  }
}
```

### PUT /api/sources/:id Request Body
```json
{
  "code": "ABC123",
  "title": "Source Title",
  "type": "MS",
  "format": "Choirbook",
  "town": "Paris",
  "rism_link": "https://rism.info/sources/123456",
  "catalogued": true,
  "from_year": 1450,
  "to_year": 1500,
  "from_year_annotation": "c.",
  "to_year_annotation": "after"
}
```

## Implementation Status

### ✅ Completed
- Basic sources table structure
- source_images relationship
- publishers/scribes many-to-many relationships
- Source CRUD operations (GET, PUT)
- Frontend source editing form
- **Functions & Titles Management Module** (Complete CRUD interface)
- Functions table with many-to-many relationship to titles
- Languages table integration
- Dashboard alerts system for data quality monitoring
- Bulk operations for title management (assign functions/languages, merge duplicates)

### 🚧 In Progress
- Inclusions/compositions structure definition
- Clef handling system

### ⏳ Pending
- Bulk save with inclusions processing
- Temporary table composition matching
- Migration scripts

## Clef System

### Clef Object Structure (JSONB)
```json
{
  "clef": "c3",
  "missing": false,
  "optional": false, 
  "incomplete": false,
  "transitions_to": ["c4"]
}
```

### Clef Display Order (Pitch Order)
```
g1, g2, g3, c1, g4, c2, g5, c3, f1, g28, c4, f2, c5, d1, f3, d2, f4, d3, y1, f5, d4, y2, d5, y3, y4, y5, x1, x2, x3, x4, x5, org, bc, lut
```

### Voice Count Rules
- Each clef counts toward number_of_voices UNLESS:
  - It's marked as optional: true
  - It's an instrumental clef: org, bc, lut

### Rendering Rules
- Optional clefs: rendered in (parentheses)
- Missing clefs: rendered in [brackets]
- Incomplete clefs: rendered in {braces}
- Transitions: main/transition (e.g., c3/c4)

### Clef Input Styling
- Missing clefs: red border
- Incomplete clefs: green border
- Optional clefs: grey border
- Transitions: blue border

## Tone Values (ID => Display)
```
"1" => "primi toni"
"2" => "secundi toni" 
"3" => "tertii toni"
"4" => "quarti toni"
"5" => "quinti toni"
"6" => "sexti toni"
"7" => "septimi toni"
"8" => "octavi toni"
"9" => "noni toni"
"12" => "duodecimi toni"
"mix" => "mixti toni"
"per" => "peregrini toni"
"pro" => "proprii toni"
```

## Even/Odd Values
- even
- odd  
- both

## Composition Uniqueness

A composition is unique by the combination of:
- number_of_voices (auto-calculated from clefs)
- title_id (from titles table)
- composition_type_id (from composition_types table)
- tone (see tone values above, or null)
- even_odd ('even', 'odd', 'both', or null)
- composer_id_list (array of composer IDs)

## Save Process Flow

1. User edits inclusions in frontend
2. On save, collect all composition data for each inclusion
3. Insert into temporary processing table
4. For each row:
   - Check if composition with same unique values exists
   - If exists: use existing composition_id
   - If not: create new composition + new group, use new composition_id
5. Update/insert inclusions with final composition_ids
6. Process synchronously to handle duplicate compositions in temp table

## Composition Matching Algorithm (Detailed)

The composition matching follows a multi-step process to avoid creating duplicate compositions:

### Phase 1: Title-Only Matching
```sql
UPDATE temp_inclusions 
SET composition_id = c.id, processed = TRUE
FROM compositions c
INNER JOIN titles t ON c.title_id = t.id
WHERE temp_inclusions.composition_name = t.text
AND temp_inclusions.composition_id IS NULL
AND temp_inclusions.composition_name != ''
```

### Phase 2: Comprehensive Uniqueness Check
Before creating new compositions, check for exact matches:
```sql
SELECT id FROM compositions 
WHERE title_id = $1 
AND (composition_type_id = $2 OR ($2 IS NULL AND composition_type_id IS NULL))
AND (tone = $3 OR ($3 IS NULL AND tone IS NULL))
AND (even_odd = $4 OR ($4 IS NULL AND even_odd IS NULL))
AND (number_of_voices = $5 OR ($5 IS NULL AND number_of_voices IS NULL))
```

### Phase 3: New Composition Creation
Only if no exact match found in Phase 2.

## Data Type Handling & Common Pitfalls

### Critical Type Conversions

1. **composition_type_id**: Must be INTEGER in database
   - Frontend sends: `composition_type_id: 4` (number)
   - Backend receives: `composition_type_id: 4` (number)
   - Database stores: `4` (INTEGER)

2. **even_odd**: Stored as INTEGER (0=even, 1=odd, 2=both)
   - Frontend may send: `"even"` (string) or `0` (number)
   - Backend converts: `"even" → 0`, `"odd" → 1`, `"both" → 2`
   - Database stores: `0`, `1`, or `2` (INTEGER)

3. **number_of_voices**: Calculated from non-optional clefs
   - Calculation: `clefs.filter(c => c.clef && c.clef.trim() && !c.optional).length`
   - Must be converted to INTEGER before database storage

### 🚨 Search Query Integer Casting Issues

**Problem**: Empty strings in database fields cause "invalid input syntax for type integer" errors when cast to INTEGER in complex SQL queries.

**Common Fields with Empty String Issues:**
- `sources.from_year`, `sources.to_year` (should be INTEGER but may contain empty strings)
- `inclusions.position` (should be INTEGER but may contain empty strings)  
- `source_images.id` (should be INTEGER but may contain empty strings)

**Safe Casting Pattern:**
```sql
-- Instead of: s.from_year::integer (FAILS on empty strings)
-- Use: CASE WHEN s.from_year IS NOT NULL AND s.from_year != '' THEN s.from_year::integer ELSE NULL END

-- Or simpler PostgreSQL approach:
-- NULLIF(s.from_year, '')::integer
```

**Search Debug Pattern:**
```javascript
// Add to search endpoints for troubleshooting:
console.log('=== SEARCH DEBUG ===');
console.log('Query parameters:', queryParams);
console.log('Parameter count:', queryParams.length);
console.log('Where conditions:', whereConditions.length);
```

**Error Signatures to Watch For:**
- Error code: `22P02` 
- Message: `"invalid input syntax for type integer: ""`
- Position: Various (moves as issues are fixed)
- File: `numutils.c`, routine: `pg_strtoint32_safe`

**Progressive Debugging Approach:**
1. Identify error position in SQL query
2. Count characters to locate problematic field
3. Apply safe casting to that specific field only
4. Re-test and repeat for next issue
5. Avoid over-engineering - fix only what's broken

### Frontend-Backend Data Flow

**Load (Backend → Frontend):**
- Backend query MUST include `c.composition_type_id` to send ID to frontend
- Frontend receives both `composition_type_name` and `composition_type_id`
- Dropdown selection uses ID when available, falls back to name

**Save (Frontend → Backend):**
- Frontend sends composition object with proper field types
- Backend validates and converts types before database operations
- Uses comprehensive matching before creating new compositions

## Debugging Tips

### Frontend Logging
Check browser console for:
```javascript
// Data received from server
console.log('even_odd:', inclusion.composition?.even_odd, 'type:', typeof inclusion.composition?.even_odd);
console.log('composition_type_id:', inclusion.composition?.composition_type_id);
```

### Backend Logging
Check server logs for:
```javascript
// Comprehensive save logging with data types
console.log('Final composition data:', {
  titleId, compositionTypeId, tone, evenOdd, numberOfVoices,
  compositionTypeIdType: typeof compositionTypeId,
  evenOddType: typeof evenOdd
});
```

### Common Issues & Solutions

1. **"composition_type_id: undefined"**: Backend not including `c.composition_type_id` in SELECT
2. **"operator does not exist: integer = text"**: Type casting issue, ensure `parseInt()` conversions
3. **New compositions created for unchanged data**: Matching algorithm not finding existing compositions due to type mismatches
4. **"even_odd always null"**: Frontend not properly sending integer values to backend

## Performance Considerations

- Temporary table approach allows batch processing of inclusions
- Composition matching happens in SQL for efficiency
- Transaction-based approach ensures data consistency
- Single-pass processing minimizes database round trips

## Functions & Titles Module

### Database Tables

#### functions
```sql
id (PK, INTEGER, AUTO)
name (TEXT, NOT NULL)
created_at (TIMESTAMP)
updated_at (TIMESTAMP)
```

#### functions_titles (Many-to-Many Junction Table)
```sql
function_id (FK -> functions.id)
title_id (FK -> titles.id)
PRIMARY KEY (function_id, title_id)
```

**Important**: This table may NOT have a unique constraint in all environments. Always use explicit existence checks rather than `ON CONFLICT` clauses.

#### languages
```sql
id (PK, INTEGER, AUTO)
language (TEXT, NOT NULL) -- Note: column name is 'language', not 'name'
```

### API Endpoints

#### Functions Management
- `GET /api/functions` - List all functions with title counts
- `GET /api/functions/:id` - Get function with associated titles
- `POST /api/functions` - Create new function
- `PUT /api/functions/:id` - Update function name
- `DELETE /api/functions/:id` - Delete function (removes all title associations)

#### Titles Management
- `GET /api/functions/titles/search` - Advanced search with filters
  - Supports special filters: `*no_functions*`, `*no_language*`
  - Similarity search for duplicate detection
  - Pagination (default 50 per page)
  - Language and function filtering
- `POST /api/functions/titles` - Create new title
- `PUT /api/functions/titles/:id` - Update title text and language
- `POST /api/functions/titles/merge` - Merge multiple titles into one

#### Title-Function Associations
- `POST /api/functions/titles/:titleId/functions/:functionId` - Assign function to title
- `DELETE /api/functions/titles/:titleId/functions/:functionId` - Remove function from title

#### System Endpoints
- `GET /api/functions/languages` - Get all available languages (with fallback)
- `GET /api/functions/dashboard/alerts` - Data quality alerts for dashboard

### Critical Implementation Notes

#### Route Ordering
**CRITICAL**: In Express.js, specific routes MUST come before parameterized routes:
```javascript
router.get('/languages', ...);     // MUST come first
router.get('/dashboard/alerts', ...); // MUST come first
router.get('/:id', ...);           // Parameterized route comes last
```

#### Database Constraints
- The `functions_titles` table may not have unique constraints in all environments
- Always use explicit existence checks instead of `ON CONFLICT` clauses:

## Voicing & Clef Combination System

### Overview
The voicing system provides a simplified, database-driven approach to match search filters with clef combinations. It replaces the complex algorithmic approach with a straightforward admin-managed mapping system.

### Core Components

#### 1. Clef Combinations (`clef_combinations`)
- **Auto-populated**: Created automatically when source editor encounters new clef combinations
- **Format**: Simple string concatenation (e.g., "g2c2c3f3")
- **Variants**: Includes all possible combinations considering optional, missing, incomplete, and transitional clefs
- **Example**: An inclusion with clefs `c1, (c1), c2/c3, c4, f4` creates entries for:
  - `c1c1c2c4f4` (with optional c1)
  - `c1c2c4f4` (without optional c1)
  - `c1c1c3c4f4` (with transition c2→c3)
  - `c1c3c4f4` (without optional, with transition)

#### 2. Voicings (`voicings`)
- **Manually maintained**: Admins add voicing types as needed
- **Examples**: SATB, SSAATBarB, SSA, TTBB, etc.
- **Flexible naming**: Supports complex voicing descriptions like "SATB (Canonic)"

#### 3. Admin Interface (`/admin/clef-voicings`)
- **Pill-style interface**: Click voicing pills to toggle assignment to clef combinations
- **Real-time updates**: Immediate visual feedback and database updates
- **Add new voicings**: Simple form to add custom voicing types
- **Data management**: View all clef combinations with their assigned voicings

### API Integration

#### Search Endpoints
- `GET /api/search/voicings` - Returns available voicing options for public search
- Uses many-to-many relationships to filter compositions by clef combinations

#### Admin Endpoints
- `GET /api/admin/clef-combinations` - List all clef combinations
- `GET /api/admin/clef-voicing-mappings` - Get current mappings
- `POST /api/admin/clef-voicing-mappings` - Create new mapping
- `DELETE /api/admin/clef-voicing-mappings` - Remove mapping
- `POST /api/admin/voicings` - Add new voicing type

#### Data Quality
- `GET /api/admin/data-quality-alerts` - Reports unmapped clef combinations and unused voicings
- Ignorable alerts system prevents permanent dismissal of known issues

### Search Logic
1. User selects voicing(s) in public search interface
2. System queries `clef_combos_voicings` to find associated clef combinations  
3. Converts clef combo strings to clef objects for JSON matching against `inclusions.clefs`
4. Returns compositions where inclusions match any of the clef combinations

### Migration Notes
- Created via `voicing-migration.sql`
- Pre-populated with common voicings (SATB, SSA, etc.)
- Sample clef combinations and mappings included for immediate functionality
- Indexes optimized for search performance

### Benefits Over Previous System
- **Simplicity**: No complex algorithmic matching
- **Flexibility**: Easy to add new voicing types and mappings
- **Performance**: Direct database queries instead of calculations
- **Maintainability**: Clear admin interface for ongoing management
- **Accuracy**: Human-verified mappings instead of algorithmic guessing

```javascript
// ❌ Don't use - may fail if constraint doesn't exist
INSERT ... ON CONFLICT (function_id, title_id) DO NOTHING

// ✅ Use this pattern instead
const existing = await pool.query(`
  SELECT 1 FROM functions_titles 
  WHERE function_id = $1 AND title_id = $2
`, [functionId, titleId]);

if (existing.rows.length === 0) {
  await pool.query(`
    INSERT INTO functions_titles (function_id, title_id)
    VALUES ($1, $2)
  `, [functionId, titleId]);
}
```

#### Title Merging
- Updates all `compositions.title_id` references to point to merged title
- Merges function associations from all source titles
- Handles duplicate final text by merging with existing title
- Transactional operation ensures data integrity
- Deletes source titles after successful merge

#### Language Handling
- Languages table uses column name `language` (not `name`)
- API returns as `{ id, name }` for frontend compatibility
- Robust fallback to hardcoded languages if table doesn't exist
- Never returns 500 errors - always provides fallback data

### Frontend Features

#### Titles Management Tab
- Advanced search with similarity matching for duplicate detection
- Bulk selection with checkbox interface
- Bulk operations: assign functions, assign languages, merge titles
- Individual title editing with inline function assignment
- Special dashboard filters for data quality issues
- Pagination with 50 items per page

#### Functions Management Tab
- CRUD operations for functions
- Card-based interface with dropdown menus
- Function deletion with cascade warning

#### Dashboard Integration
- Data quality alerts with actionable links
- Counts of problematic records (titles without functions, etc.)
- Direct links to filtered views for remediation

### Data Quality Checks

The system monitors these data quality issues:
1. **Titles without functions assigned** - Links to `?filter=no_functions`
2. **Functions without titles assigned** - Links to `?filter=empty_functions` 
3. **Titles without language assigned** - Links to `?filter=no_language`

### Error Handling Patterns

#### API Error Handling
```javascript
// Pattern for robust language/reference data loading
try {
  const result = await pool.query('SELECT ...');
  languages = result.rows;
} catch (dbError) {
  console.log('Table not found:', dbError.message);
}

// Always provide fallback data
if (languages.length === 0) {
  languages = [...fallbackData];
}

res.json({ languages }); // Never return 500 for reference data
```

#### Frontend Error Handling
- Graceful degradation when APIs fail
- Fallback data for dropdown populations
- User-friendly error messages for failed operations
- Retry mechanisms for transient failures

## Technical Implementation Details

### Authentication System

#### Session-Based Authentication
All admin interfaces use session-based authentication with `credentials: 'include'` for proper cookie handling:

```javascript
// ✅ Correct authentication pattern
const response = await fetch('/api/admin/endpoint', {
    credentials: 'include',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
});

// Handle authentication errors
if (response.status === 401 || response.status === 403) {
    window.location.href = '/login';
    return;
}
```

#### Authentication Troubleshooting
- **302 Redirects**: Usually indicate missing `credentials: 'include'` in fetch requests
- **401/403 Errors**: Check session validity and admin privileges
- **CORS Issues**: Ensure credentials are included in cross-origin requests

### Search Parameter Indexing

#### Critical Parameter Management
**Problem**: PostgreSQL parameter indexing must be sequential and consistent across queries.

**Solution Pattern:**
```javascript
// ✅ Correct parameter indexing
let paramIndex = 1;
let queryParams = [];

// Each filter increments paramIndex consistently
if (composers.length > 0) {
    whereConditions.push(`composers && $${paramIndex}::integer[]`);
    queryParams.push(composers);
    paramIndex++;
}

// Voicing filter uses separate query with fixed parameters
const voicingQuery = `SELECT clef_combination FROM ... WHERE voicing_id = ANY($1::integer[])`;
const voicingResult = await pool.query(voicingQuery, [voicingIds]);
```

**Common Pitfalls:**
- Using `$${paramIndex + 1}` without incrementing by 1
- Reusing parameter indexes across sub-queries
- Forgetting to increment `paramIndex` after adding parameters

### Select2 Integration

#### Safe Initialization Pattern
```javascript
function initializeSelect2Components() {
    // ✅ Check for existing instances before destroying
    $('.voicing-select').each(function() {
        if ($(this).hasClass('select2-hidden-accessible')) {
            $(this).select2('destroy');
        }
    });
    
    // Initialize fresh instances
    $('.voicing-select').select2({
        placeholder: 'Select voicings...',
        allowClear: true,
        width: '100%'
    });
}
```

**Error Prevention:**
- Always check for `select2-hidden-accessible` class before destroying
- Reinitialize Select2 after DOM changes (pagination, content updates)
- Handle programmatic value changes to prevent infinite loops

### URL State Management

#### Public Search Pagination
```javascript
// ✅ Complete URL state management
function updateURL() {
    const params = new URLSearchParams();
    
    // Include all filter states
    if (title) params.set('title', title);
    if (composers) params.set('composers', composers);
    if (currentPage !== 1) params.set('page', currentPage);
    if (currentPageSize !== 25) params.set('page_size', currentPageSize);
    
    // Update URL without page reload
    const newURL = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
    window.history.replaceState({}, document.title, newURL);
}

// Load state from URL on page load
function loadFiltersFromURL() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('page')) {
        currentPage = parseInt(params.get('page')) || 1;
    }
    // ... load other parameters
}
```

### Data Quality Management Enhancements

#### Enhanced Cleanup Operations
```sql
-- Preview unused clef combinations
SELECT cc.id, cc.clef_combination, 
       CASE WHEN used.clef_combination_id IS NULL THEN 'unused' ELSE 'used' END as status
FROM clef_combinations cc
LEFT JOIN (
    SELECT DISTINCT ccv.clef_combination_id 
    FROM clef_combinations_voicings ccv
) used ON cc.id = used.clef_combination_id
WHERE used.clef_combination_id IS NULL;

-- Validate clef combinations against official clef list
SELECT id, clef_combination
FROM clef_combinations 
WHERE NOT EXISTS (
    SELECT 1 WHERE validate_clef_combination(clef_combination) = true
);
```

#### Invalid Data Detection
- **Invalid clef names**: Check against 35 official clef types
- **Unused relationships**: Clef combinations without voicings, voicings without clef combinations
- **Orphaned records**: Compositions without groups, titles without usage
- **Data integrity**: Automatic constraint validation and cleanup suggestions

### Performance Optimization

#### Voicing Filter Performance Enhancement
Create optional performance optimization with indexed columns:

```sql
-- voicing-performance-migration.sql
-- Add indexed columns for fast clef combination matching
ALTER TABLE inclusions 
ADD COLUMN sorted_clef_combination_required TEXT,
ADD COLUMN sorted_clef_combination_all TEXT;

-- Create specialized indexes
CREATE INDEX idx_inclusions_sorted_clef_required 
ON inclusions USING btree (sorted_clef_combination_required);

CREATE INDEX idx_inclusions_sorted_clef_all 
ON inclusions USING btree (sorted_clef_combination_all);

-- Automatic trigger to maintain columns
CREATE OR REPLACE FUNCTION update_sorted_clef_combinations()
RETURNS TRIGGER AS $$
BEGIN
    NEW.sorted_clef_combination_required := sort_clef_combination(NEW.clefs, false);
    NEW.sorted_clef_combination_all := sort_clef_combination(NEW.clefs, true);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Benefits:**
- 10-100x faster voicing searches on large datasets
- Automatic maintenance via triggers
- Backward compatibility with existing search logic

### Source Editor Clef Management

#### Clef Sorting Implementation
```javascript
// Consistent clef display order
const clefDisplayOrder = [
    'g1', 'g2', 'g3', 'c1', 'g4', 'c2', 'g5', 'c3', 'f1', 
    'g28', 'c4', 'f2', 'c5', 'd1', 'f3', 'd2', 'f4', 'd3', 
    'y1', 'f5', 'd4', 'y2', 'd5', 'y3', 'y4', 'y5', 
    'x1', 'x2', 'x3', 'x4', 'x5', 'org', 'bc', 'lut'
];

function sortClefs(clefs) {
    return clefs.sort((a, b) => {
        const indexA = clefDisplayOrder.indexOf(a.clef?.trim());
        const indexB = clefDisplayOrder.indexOf(b.clef?.trim());
        return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
    });
}
```

**Migration Strategy:**
- UI automatically sorts clefs for display
- Database gradually updates as sources are re-edited
- No breaking changes to existing data
- Consistent clef ordering improves voicing matching accuracy

### Troubleshooting Common Issues

#### Parameter Type Errors
```
Error: could not determine data type of parameter $1
```
**Cause**: Parameter indexing mismatch or type confusion
**Solution**: Check parameter order and ensure sequential numbering

#### Select2 Destruction Errors
```
The select2('destroy') method was called on an element that is not using Select2
```
**Cause**: Attempting to destroy non-initialized Select2 instances
**Solution**: Check for `select2-hidden-accessible` class before destroying

#### Voicing Filter Not Working with Other Filters
**Cause**: Parameter conflicts between separate query contexts
**Solution**: Use fixed parameter positions (`$1`) for sub-queries, maintain separate parameter tracking

#### Authentication 302 Redirects
**Cause**: Missing session credentials in API requests
**Solution**: Add `credentials: 'include'` to all admin fetch requests

### Development Best Practices

#### Admin Interface Development
1. **Authentication**: Always include session credentials
2. **Error Handling**: Graceful degradation and user feedback
3. **State Management**: Maintain UI state during operations
4. **Performance**: Use pagination for large datasets
5. **Accessibility**: Proper ARIA labels and keyboard navigation

#### Search API Development
1. **Parameter Validation**: Sanitize and validate all inputs
2. **Query Optimization**: Use indexes and efficient joins
3. **Error Recovery**: Fallback mechanisms for failed sub-queries
4. **Debugging**: Comprehensive logging for complex queries
5. **Pagination**: Consistent pagination across all endpoints

#### Database Migration Planning
1. **Backward Compatibility**: New features don't break existing functionality
2. **Performance Testing**: Index impact analysis before deployment
3. **Rollback Strategy**: Clear rollback procedures for schema changes
4. **Data Validation**: Comprehensive validation before and after migrations
5. **Gradual Deployment**: Staged rollouts for major changes

## Notes

- PostgreSQL: TEXT and VARCHAR have identical performance characteristics
- All timestamps should be UTC
- Foreign key constraints should be enforced
- Consider adding indexes on frequently queried fields (code, name fields)
- Unique constraint on compositions table ensures no duplicates
- composer_id_list array allows multiple composers per composition
- **Route order matters**: Specific routes must come before parameterized routes in Express.js
- **Constraint assumptions**: Never assume unique constraints exist - always check explicitly
- **Reference data robustness**: Language/dropdown APIs should never fail - always provide fallbacks
- **Parameter indexing**: PostgreSQL parameters must be sequential ($1, $2, $3...) within each query context
- **Session authentication**: All admin interfaces require `credentials: 'include'` for proper session handling
- **Select2 management**: Always check for existing instances before destroying to prevent console errors
- **URL state**: Include pagination and filter state in URLs for bookmarkable searches
- **Performance optimization**: Consider indexed columns for frequently filtered large datasets 

## New Media Tables

### editions
```sql
id (SERIAL PRIMARY KEY)
group_id (INTEGER) - FK to groups
editor_id (INTEGER) - FK to editors
voicing (TEXT) - Voicing description
file_url (TEXT) - URL to edition file
created_at (TIMESTAMP)
updated_at (TIMESTAMP)
```

### recordings
```sql
id (SERIAL PRIMARY KEY)
group_id (INTEGER) - FK to groups
performer_id (INTEGER) - FK to performers
file_url (TEXT) - URL to recording file
created_at (TIMESTAMP)
updated_at (TIMESTAMP)
```

## API Endpoints

### Public Search API (`/api/search/`)

#### `/api/search/groups`
Public search endpoint for groups with multi-dimensional filtering.

**Query Parameters:**
- `title` - Search group titles and composition titles
- `composers` - Comma-separated composer IDs (OR within, AND between filters)
- `voices` - Comma-separated voice counts
- `functions` - Comma-separated function IDs
- `languages` - Comma-separated language IDs
- `countries` - Comma-separated country IDs (composer birth countries)
- `sources` - Comma-separated source IDs
- `publishers` - Comma-separated publisher IDs
- `cities` - Comma-separated city names (publication places)
- `page` - Page number (default: 1)
- `limit` - Results per page (default: 20)

**Response:**
```json
{
  "groups": [
    {
      "id": 1,
      "display_title": "Magnificat primi toni (impares)",
      "composer_names": ["Lobo, Alonso", "Victoria, Tomás Luis de"],
      "composers_with_dates": [
        {"id": 1, "name": "Lobo, Alonso", "dates": "(1555–1617)"}
      ],
      "voice_counts": [4, 5],
      "function_names": ["Magnificat", "Canticle"]
    }
  ],
  "pagination": {
    "total": 150,
    "page": 1,
    "limit": 20,
    "totalPages": 8,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

#### `/api/search/groups/:id/sources`
Get detailed source information for a specific group.

**Response:**
```json
{
  "sources": [
    {
      "id": 1,
      "code": "E-SE s.s.",
      "title": "Liber primus missarum",
      "type": "Print",
      "format": "Choirbook",
      "place_of_publication": "Venice",
      "from_year": 1600,
      "to_year": null,
      "rism_link": "https://opac.rism.info/...",
      "publishers": ["Gardano, Angelo"],
      "scribes": null
    }
  ]
}
```

### Admin API Endpoints

#### Existing Admin Endpoints
- `/api/composers/` - CRUD operations for composers
- `/api/sources/` - CRUD operations for sources
- `/api/sources/composers` - Composers for dropdowns
- `/api/sources/publishers` - Publishers for dropdowns
- `/api/sources/scribes` - Scribes for dropdowns
- `/api/functions/` - CRUD operations for functions
- `/api/functions/languages` - Languages for dropdowns
- `/api/groups/` - CRUD operations for groups (new)

#### Authentication Endpoints (`/api/auth/`)
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `POST /api/auth/forgot-password` - Password reset request
- `POST /api/auth/reset-password` - Password reset completion

## Data Enhancement Logic

### Composer Attribution Display
- **Single composer**: "Lobo, Alonso (1555–1617)"
- **Anonymous only**: "Anon"
- **Multiple composers**: "Conflicting attributions"

### Title Enhancement
Automatically appends tone and even/odd information:
- Tone mapping: "1" → "primi toni", "2" → "secundi toni", etc.
- Even/odd mapping: "odd" → "impares", "even" → "pares"
- Example: "Magnificat" + tone "1" + even_odd "odd" → "Magnificat primi toni (impares)"

### Multi-Select Filtering Logic
- **OR within filter**: Multiple values in same filter are ORed
- **AND between filters**: Different filters are ANDed together
- Example: voices=4,5 AND functions=1,2 finds groups with (4 OR 5 voices) AND (function 1 OR 2)

## Migration Notes

### Groups Migration (`groups-migration.sql`)
Creates the new group structure and automatically migrates existing compositions into initial groups. Each composition starts in its own group, which can then be merged through the admin interface.

### User Authentication Migration (`migration.sql`)
Creates the users table with email-based authentication, roles, and approval workflow.

## Security Features

- JWT-based authentication with HTTP-only cookies
- bcrypt password hashing (12 salt rounds)
- Rate limiting on login attempts and registrations
- User approval workflow for new registrations
- Role-based access control (user/admin)
- Account lockout after failed login attempts 