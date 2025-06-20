# Polyphony Database Schema Reference

## Core Tables

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

## Notes

- PostgreSQL: TEXT and VARCHAR have identical performance characteristics
- All timestamps should be UTC
- Foreign key constraints should be enforced
- Consider adding indexes on frequently queried fields (code, name fields)
- Unique constraint on compositions table ensures no duplicates
- composer_id_list array allows multiple composers per composition 