# Server Crash Diagnosis

## Issue
Heroku app crashing with exit status 1, showing spinning wheels on both admin and public pages.

## Most Likely Cause
The `suggestion_flags` table doesn't exist on the production database, causing SQL errors when the flag checking code runs.

## Error Source
The new flag checking code added here:
```javascript
const flagQuery = `
  SELECT 1 FROM suggestion_flags 
  WHERE ((group1_id = $1 AND group2_id = $2) OR (group1_id = $2 AND group2_id = $1))
  AND flag_type = 'not_same'
`;
const flagResult = await client.query(flagQuery, [anonGroup.id, compareGroup.id]);
```

## Quick Fix Applied
Added try-catch around the flag checking to prevent crashes:
```javascript
try {
  const flagQuery = `...`;
  const flagResult = await client.query(flagQuery, [anonGroup.id, compareGroup.id]);
  if (flagResult.rows.length > 0) continue;
} catch (flagError) {
  console.error('Flag check error:', flagError);
  // Continue processing if flag check fails
}
```

## Action Needed
1. **Deploy this fix immediately** to stop the crashing
2. **Create the suggestion_flags table** on production:
   ```sql
   CREATE TABLE suggestion_flags (
       id SERIAL PRIMARY KEY,
       group1_id INTEGER REFERENCES groups(id),
       group2_id INTEGER REFERENCES groups(id),
       flag_type VARCHAR(50) DEFAULT 'not_same',
       created_by INTEGER REFERENCES users(id),
       created_at TIMESTAMP DEFAULT NOW(),
       notes TEXT,
       UNIQUE(group1_id, group2_id, flag_type)
   );
   ```

## Alternative Solutions
If you can't create the table immediately:
1. Comment out the flagging code entirely
2. Or create a feature flag to disable flagging until the table exists

## Prevention
Always test database schema changes on a staging environment before production deployment.