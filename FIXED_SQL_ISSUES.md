# Fixed SQL Issues

## Issues and Solutions

### 1. **pg_trgm Extension Missing**
**Error**: `operator class "gin_trgm_ops" does not exist for access method "gin"`

**Solution**: Added extension creation at the beginning of the SQL file:
```sql
-- 0. Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

### 2. **JSON Aggregation with DISTINCT**
**Error**: `could not identify an equality operator for type json`

**Problem**: PostgreSQL cannot use `DISTINCT` with `json_agg()` because JSON objects don't have built-in equality operators.

**Solution**: Restructured the queries to use `DISTINCT` on the underlying data before JSON aggregation:

**Before** (broken):
```sql
SELECT json_agg(DISTINCT json_build_object('id', comp.id, 'name', comp.name, ...))
```

**After** (working):
```sql
SELECT json_agg(composer_data)
FROM (
  SELECT DISTINCT comp.id, comp.name, comp.from_year, comp.to_year
  FROM compositions c
  JOIN composers comp ON comp.id = ANY(c.composer_id_list)
  WHERE c.group_id = g.id AND c.composer_id_list IS NOT NULL
) comp_distinct(id, name, from_year, to_year)
CROSS JOIN LATERAL json_build_object(
  'id', comp_distinct.id, 
  'name', comp_distinct.name, 
  'from_year', comp_distinct.from_year, 
  'to_year', comp_distinct.to_year
) composer_data
```

### 3. **Color Readability Issues**
**Problem**: Dark green success badges had poor text contrast.

**Solution**: 
- Changed high confidence border color to teal (#20c997)
- Added custom CSS to override Bootstrap success badge colors
- Used `text-dark` class on success badges for better contrast

## Files Updated

1. **performance_optimizations.sql**
   - Added pg_trgm extension enablement
   - Fixed composer_details aggregation
   - Fixed source_details aggregation

2. **public/admin-group-suggestions.html**
   - Updated color scheme for better readability
   - Added custom CSS for success badges
   - Improved text contrast

## Ready to Deploy

The SQL file should now run without errors. Make sure to:

1. Run the SQL as a superuser or user with extension creation privileges
2. The pg_trgm extension will be created if it doesn't exist
3. All indexes and materialized views should create successfully

## Testing

After running the SQL optimizations:
1. Test the 4-6 voice searches that were causing 500 errors
2. Verify the interface colors are more readable
3. Check that the materialized view refreshes properly with:
   ```sql
   SELECT refresh_group_analysis_cache();
   ```