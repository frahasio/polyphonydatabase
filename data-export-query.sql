-- Data Export Query for Direct pgAdmin Import
-- This query extracts data from the old system and formats it as INSERT statements
-- Copy the results and paste directly into pgAdmin

WITH inclusion_data AS (
    SELECT * FROM openquery(POLYPHONYDATABASE,'
        SELECT DISTINCT
            i.source_id,
            i.id as inclusion_id,
            i.order as position,
            t.text as composition_name,
            ct.name as composition_type,
            c.tone,
            c.even_odd,
            c.composition_type_id,
            c.number_of_voices,
            c.composer_id_list as composer_ids_json
        FROM
            inclusions i
            INNER JOIN compositions c ON c.id = i.composition_id
            INNER JOIN titles t ON t.id = c.title_id
            LEFT JOIN composition_types ct ON ct.id = c.composition_type_id
        WHERE
            i.source_id = 791
    ')
),
clef_data AS (
    SELECT * FROM openquery(POLYPHONYDATABASE,'
        SELECT
            i.id as inclusion_id,
            ci.clef,
            ci.optional,
            ci.incomplete,
            ci.missing,
            ci.transitions_to,
            ci.order as clef_order
        FROM
            inclusions i
            INNER JOIN clef_inclusions ci ON ci.inclusion_id = i.id
        WHERE
            i.source_id = 791
        ORDER BY i.order, ci.order
    ')
),
composer_data AS (
    SELECT * FROM openquery(POLYPHONYDATABASE,'
        SELECT
            i.id as inclusion_id,
            STRING_AGG(comp.name, '', '' ORDER BY comp.name) as composers
        FROM
            inclusions i
            INNER JOIN compositions c ON c.id = i.composition_id
            LEFT JOIN LATERAL (
                SELECT unnest(c.composer_id_list) as composer_id
            ) comp_ids ON true
            LEFT JOIN composers comp ON comp.id = comp_ids.composer_id
        WHERE
            i.source_id = 791
        GROUP BY i.id
    ')
),
grouped_data AS (
    SELECT
        inc.source_id,
        inc.position,
        inc.composition_name,
        inc.composition_type,
        comp.composers,
        -- Build proper JSON for clefs preserving duplicates and order
        '[' + STRING_AGG(
            '{"clef":"' + clef_data.clef + '"' +
            CASE WHEN clef_data.optional = 1 THEN ',"optional":true' ELSE '' END +
            CASE WHEN clef_data.incomplete = 1 THEN ',"incomplete":true' ELSE '' END +
            CASE WHEN clef_data.missing = 1 THEN ',"missing":true' ELSE '' END +
            CASE 
                WHEN clef_data.transitions_to IS NOT NULL AND clef_data.transitions_to != '' AND clef_data.transitions_to != '{}' 
                THEN ',"transitions_to":' + 
                     CASE 
                         -- Handle PostgreSQL array format {item1,item2,item3}
                         WHEN clef_data.transitions_to LIKE '{%}' 
                         THEN '["' + REPLACE(REPLACE(REPLACE(clef_data.transitions_to, '{', ''), '}', ''), ',', '","') + '"]'
                         -- Handle comma-separated format
                         WHEN clef_data.transitions_to LIKE '%,%'
                         THEN '["' + REPLACE(clef_data.transitions_to, ',', '","') + '"]'
                         -- Handle single item
                         ELSE '["' + clef_data.transitions_to + '"]'
                     END
                ELSE '' 
            END +
            '}', ','
            ORDER BY clef_data.clef_order
        ) + ']' AS clefs,
        inc.tone,
        inc.even_odd,
        inc.composition_type_id,
        inc.number_of_voices,
        -- Convert PostgreSQL array to JavaScript JSON array format
        CASE 
            WHEN inc.composer_ids_json IS NOT NULL AND inc.composer_ids_json != '{}'
            THEN '[' + REPLACE(REPLACE(REPLACE(CAST(inc.composer_ids_json AS VARCHAR), '{', ''), '}', ''), ',', ',') + ']'
            ELSE '[]'
        END AS composer_ids_json
    FROM inclusion_data inc
    LEFT JOIN clef_data ON clef_data.inclusion_id = inc.inclusion_id
    LEFT JOIN composer_data comp ON comp.inclusion_id = inc.inclusion_id
    GROUP BY
        inc.source_id,
        inc.inclusion_id,
        inc.position,
        inc.composition_name,
        inc.composition_type,
        comp.composers,
        inc.tone,
        inc.even_odd,
        inc.composition_type_id,
        inc.number_of_voices,
        inc.composer_ids_json
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