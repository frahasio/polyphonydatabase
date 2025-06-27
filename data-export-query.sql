-- Data Export Query for Direct pgAdmin Import
-- This query extracts data from the old system and formats it as INSERT statements
-- Copy the results and paste directly into pgAdmin

WITH cte AS (
    SELECT * FROM openquery(POLYPHONYDATABASE,'
        SELECT
            i.source_id,
            i.order as position,
            t.text as composition_name,
            ct.name as composition_type,
            -- Join with composers table to get full names
            STRING_AGG(DISTINCT comp.name, '', '' ORDER BY comp.name) as composers,
            ci.clef,
            ci.optional,
            ci.incomplete,
            ci.missing,
            ci.transitions_to,
            c.tone,
            c.even_odd,
            c.composition_type_id,
            c.number_of_voices,
            c.composer_id_list as composer_ids_json
        FROM
            inclusions i
            INNER JOIN compositions c ON c.id = i.composition_id
            INNER JOIN titles t ON t.id = c.title_id
            INNER JOIN clef_inclusions ci ON ci.inclusion_id = i.id
            LEFT JOIN composition_types ct ON ct.id = c.composition_type_id
            -- Join with composers table to get full names
            LEFT JOIN LATERAL (
                SELECT unnest(c.composer_id_list) as composer_id
            ) comp_ids ON true
            LEFT JOIN composers comp ON comp.id = comp_ids.composer_id
        WHERE
            i.source_id = 791
        GROUP BY
            i.source_id,
            i.order,
            t.text,
            ct.name,
            ci.clef,
            ci.optional,
            ci.incomplete,
            ci.missing,
            ci.transitions_to,
            c.tone,
            c.even_odd,
            c.composition_type_id,
            c.number_of_voices,
            c.composer_id_list
        ORDER BY position
    ')
),
grouped_data AS (
    SELECT
        source_id,
        position,
        composition_name,
        composition_type,
        composers,
        -- Build proper JSON for clefs with NULL handling
        '[' + STRING_AGG(
            '{"clef":"' + clef + '"' +
            CASE WHEN optional = 1 THEN ',"optional":true' ELSE '' END +
            CASE WHEN incomplete = 1 THEN ',"incomplete":true' ELSE '' END +
            CASE WHEN missing = 1 THEN ',"missing":true' ELSE '' END +
            CASE 
                WHEN transitions_to IS NOT NULL AND transitions_to != '' 
                THEN ',"transitions_to":' + 
                     CASE 
                         -- Handle PostgreSQL array format {item1,item2,item3}
                         WHEN transitions_to LIKE '{%}' 
                         THEN '["' + REPLACE(REPLACE(REPLACE(transitions_to, '{', ''), '}', ''), ',', '","') + '"]'
                         -- Handle comma-separated format
                         WHEN transitions_to LIKE '%,%'
                         THEN '["' + REPLACE(transitions_to, ',', '","') + '"]'
                         -- Handle single item
                         ELSE '["' + transitions_to + '"]'
                     END
                ELSE '' 
            END +
            '}', ','
        ) + ']' AS clefs,
        tone,
        even_odd,
        composition_type_id,
        number_of_voices,
        -- Convert PostgreSQL array to JavaScript JSON array format
        CASE 
            WHEN composer_ids_json IS NOT NULL AND composer_ids_json != '{}'
            THEN '[' + REPLACE(REPLACE(REPLACE(CAST(composer_ids_json AS VARCHAR), '{', ''), '}', ''), ',', ',') + ']'
            ELSE '[]'
        END AS composer_ids_json
    FROM cte
    GROUP BY
        source_id,
        position,
        composition_name,
        composition_type,
        composers,
        tone,
        even_odd,
        composition_type_id,
        number_of_voices,
        composer_ids_json
)
SELECT 
    'INSERT INTO temp_inclusions (source_id, position, composition_name, composition_type, composers, clefs, tone, even_odd, composition_type_id, number_of_voices, composer_ids_json) VALUES (' +
    CAST(source_id AS VARCHAR) + ', ' +
    CAST(position AS VARCHAR) + ', ' +
    '''' + REPLACE(composition_name, '''', '''''') + ''', ' +
    CASE WHEN composition_type IS NOT NULL THEN '''' + REPLACE(composition_type, '''', '''''') + '''' ELSE 'NULL' END + ', ' +
    CASE WHEN composers IS NOT NULL THEN '''' + REPLACE(composers, '''', '''''') + '''' ELSE 'NULL' END + ', ' +
    '''' + REPLACE(clefs, '''', '''''') + ''', ' +
    CASE WHEN tone IS NOT NULL THEN '''' + CAST(tone AS VARCHAR) + '''' ELSE 'NULL' END + ', ' +
    CASE WHEN even_odd IS NOT NULL THEN CAST(even_odd AS VARCHAR) ELSE 'NULL' END + ', ' +
    CASE WHEN composition_type_id IS NOT NULL THEN CAST(composition_type_id AS VARCHAR) ELSE 'NULL' END + ', ' +
    CASE WHEN number_of_voices IS NOT NULL THEN CAST(number_of_voices AS VARCHAR) ELSE 'NULL' END + ', ' +
    '''' + composer_ids_json + '''' +
    ');' AS insert_statement
FROM grouped_data
ORDER BY position;

-- Alternative simpler version if the above is too complex:
-- Just output the data cleanly formatted for manual INSERT creation

/*
WITH cte AS (
    -- Same CTE as above
),
grouped_data AS (
    -- Same grouped_data as above  
)
SELECT 
    source_id,
    position,
    '"' + REPLACE(composition_name, '"', '""') + '"' AS composition_name,
    '"' + ISNULL(composition_type, '') + '"' AS composition_type,
    '"' + ISNULL(composers, '') + '"' AS composers,
    '"' + clefs + '"' AS clefs,
    ISNULL(tone, 'NULL') AS tone,
    ISNULL(CAST(even_odd AS VARCHAR), 'NULL') AS even_odd,
    ISNULL(CAST(composition_type_id AS VARCHAR), 'NULL') AS composition_type_id,
    ISNULL(CAST(number_of_voices AS VARCHAR), 'NULL') AS number_of_voices,
    '"[]"' AS composer_ids_json
FROM grouped_data
ORDER BY position;
*/ 