import express from 'express';
import { pool } from '../db.js';
import { CLEF_DISPLAY_ORDER } from '../constants.js';

const router = express.Router();

// Detect whether compositions.tone is text[] (post-migration) or varchar (pre-migration).
// Caches result so the detection query only runs once.
let _toneIsArray = null;
async function toneIsArray() {
  if (_toneIsArray !== null) return _toneIsArray;
  try {
    const res = await pool.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'compositions' AND column_name = 'tone'
    `);
    _toneIsArray = res.rows.length > 0 && res.rows[0].data_type === 'ARRAY';
  } catch {
    _toneIsArray = false;
  }
  return _toneIsArray;
}

// Main public search endpoint for groups
router.get('/groups', async (req, res) => {
  try {
    const {
      title = '',
      composers = '',
      voices = '',
      functions = '',
      languages = '',
      countries = '',
      sources = '',
      publisher_scribe_editor = '',
      cities = '',
      composition_types = '',
      tones = '',
      even_odd = '',
      voicing = '',
      has_editions = 'false',
      has_recordings = 'false',
      year_from = '',
      year_to = '',
      clef = '',
      source_type = '',
      source_format = '',
      anniversary_year = '',
      sort = '',
      page = 1,
      page_size = 25
    } = req.query;

    const limit = parseInt(page_size);
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const isArray = await toneIsArray();
    
    // Parse multi-select parameters (comma-separated)
    const composerIds = composers && composers.trim() ? composers.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const voiceOptions = voices && voices.trim() ? voices.split(',').map(v => parseInt(v)).filter(v => !isNaN(v)) : [];
    const functionIds = functions && functions.trim() ? functions.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const languageIds = languages && languages.trim() ? languages.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const countryNames = countries && countries.trim() ? countries.split(',').map(country => country.trim()).filter(country => country) : [];
    // Parse sources - can be IDs or wildcard patterns (e.g., "P-%")
    const sourceInputs = sources && sources.trim() ? sources.split(',').map(s => s.trim()).filter(s => s) : [];
    const sourceIds = [];
    const sourcePatterns = [];
    
    sourceInputs.forEach(input => {
      if (input.includes('%')) {
        // This is a wildcard pattern
        sourcePatterns.push(input);
      } else {
        // Try to parse as integer ID
        const id = parseInt(input);
        if (!isNaN(id)) {
          sourceIds.push(id);
        }
      }
    });
    // Parse publisher/scribe/editor - can contain composite values like "p:123,s:456" for people who are both
    // Format: "p:123" for publisher only, "s:456" for scribe only, "p:123,s:456" for both
    let publisherIds = [];
    let scribeIds = [];
    
    if (publisher_scribe_editor && publisher_scribe_editor.trim()) {
      const values = publisher_scribe_editor.split(',').map(v => v.trim()).filter(v => v);
      
      values.forEach(value => {
        // Check if it's a composite format (p:123 or s:456 or p:123,s:456)
        if (value.includes(':')) {
          // Parse prefixed IDs
          const parts = value.split(',');
          parts.forEach(part => {
            const trimmed = part.trim();
            if (trimmed.startsWith('p:')) {
              const id = parseInt(trimmed.substring(2));
              if (!isNaN(id)) publisherIds.push(id);
            } else if (trimmed.startsWith('s:')) {
              const id = parseInt(trimmed.substring(2));
              if (!isNaN(id)) scribeIds.push(id);
            }
          });
        } else {
          // Legacy format: just a number (for backward compatibility)
          // Query database to determine if it's a publisher or scribe
          const id = parseInt(value);
          if (!isNaN(id)) {
            // We'll determine this later by querying both tables
            publisherIds.push(id);
            scribeIds.push(id);
          }
        }
      });
      
      // Remove duplicates
      publisherIds = [...new Set(publisherIds)];
      scribeIds = [...new Set(scribeIds)];
      
      // For legacy format (numeric IDs without prefix), query database to separate them
      // This handles backward compatibility with old URLs/bookmarks
      const legacyIds = values.filter(v => !v.includes(':')).map(v => parseInt(v)).filter(id => !isNaN(id));
      if (legacyIds.length > 0) {
        try {
          // Query to find which IDs are publishers
          const publisherQuery = `
            SELECT id FROM publishers WHERE id = ANY($1::integer[])
          `;
          const publisherResult = await pool.query(publisherQuery, [legacyIds]);
          const foundPublisherIds = publisherResult.rows.map(row => row.id);
          
          // Query to find which IDs are scribes
          const scribeQuery = `
            SELECT id FROM scribes WHERE id = ANY($1::integer[])
          `;
          const scribeResult = await pool.query(scribeQuery, [legacyIds]);
          const foundScribeIds = scribeResult.rows.map(row => row.id);
          
          // Add found IDs (remove from the temporary arrays first to avoid duplicates)
          publisherIds = publisherIds.filter(id => !legacyIds.includes(id));
          scribeIds = scribeIds.filter(id => !legacyIds.includes(id));
          publisherIds.push(...foundPublisherIds);
          scribeIds.push(...foundScribeIds);
          
          // Remove duplicates again
          publisherIds = [...new Set(publisherIds)];
          scribeIds = [...new Set(scribeIds)];
        } catch (error) {
          console.error('Error separating legacy publisher/scribe IDs:', error);
        }
      }
    }
    const cityNames = cities && cities.trim() ? cities.split(',').map(city => city.trim()).filter(city => city) : [];
    const compositionTypeIds = composition_types && composition_types.trim() ? composition_types.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const toneValues = tones && tones.trim() ? tones.split(',').map(tone => tone.trim()).filter(tone => tone) : [];
    const evenOddValues = even_odd && even_odd.trim() ? even_odd.split(',').map(eo => eo.trim()).filter(eo => eo && !isNaN(parseInt(eo))) : [];
    const voicingIds = voicing && voicing.trim() ? voicing.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [];
    const hasEditions = has_editions === 'true';
    const hasRecordings = has_recordings === 'true';
    
    // Parse new filter parameters
    const yearFrom = year_from && year_from.trim() ? parseInt(year_from.trim()) : null;
    const yearTo = year_to && year_to.trim() ? parseInt(year_to.trim()) : null;
    const clefPattern = clef && clef.trim() ? clef.trim() : '';
    const sourceTypes = source_type && source_type.trim() ? source_type.split(',').map(t => t.trim()).filter(t => t) : [];
    const sourceFormats = source_format && source_format.trim() ? source_format.split(',').map(f => f.trim()).filter(f => f) : [];
    const anniversaryYear = anniversary_year && anniversary_year.trim() ? parseInt(anniversary_year.trim()) : null;
    // Ensure anniversaryYear is a valid number if provided
    if (anniversaryYear !== null && isNaN(anniversaryYear)) {
      console.error('Invalid anniversary_year parameter:', anniversary_year);
    }

    let whereConditions = [];
    let queryParams = [];
        let paramIndex = 1;

    // Always exclude groups with no compositions
    whereConditions.push('EXISTS (SELECT 1 FROM compositions c WHERE c.group_id = g.id)');

    // Title search - search both group display_title AND composition titles
    if (title.trim()) {
      const searchTerm = title.trim();
      
      // Function to normalize text by removing punctuation but preserving % wildcards
      const normalizeText = (text) => {
        return text.toLowerCase()
          .replace(/[^a-z0-9\s%{}]/g, '') // Keep % signs and {} for literal brace searches like {N}, {psalm}
          .replace(/\s+/g, ' ')
          .trim();
      };
      
      const createVariations = (searchTerm) => {
        const variations = new Set();
        const normalizedTerm = normalizeText(searchTerm);
        
        // Add the normalized version
        variations.add(normalizedTerm);
        
        // Historical spelling variations (i/j and u/v interchangeability)
        if (normalizedTerm.includes('i') || normalizedTerm.includes('j')) {
          variations.add(normalizedTerm.replace(/i/g, 'j'));
          variations.add(normalizedTerm.replace(/j/g, 'i'));
        }
        if (normalizedTerm.includes('u') || normalizedTerm.includes('v')) {
          variations.add(normalizedTerm.replace(/u/g, 'v'));
          variations.add(normalizedTerm.replace(/v/g, 'u'));
        }
        
        // Create all combinations of i/j and u/v if both sets are present
        if ((normalizedTerm.includes('i') || normalizedTerm.includes('j')) && 
            (normalizedTerm.includes('u') || normalizedTerm.includes('v'))) {
          const variants = Array.from(variations);
          variants.forEach(variant => {
            variations.add(variant.replace(/u/g, 'v'));
            variations.add(variant.replace(/v/g, 'u'));
          });
        }
        
        return Array.from(variations).slice(0, 6); // Limit to 6 variations max for performance
      };
      
      const searchVariations = createVariations(searchTerm);
      
      // Build search conditions for all variations using punctuation-tolerant comparison
      const titleConditions = searchVariations.map((variation) => {
        const p = paramIndex;
        queryParams.push(`%${variation}%`);
        paramIndex++;
        return `(
          TRANSLATE(LOWER(g.display_title), '.,;:!?"''()[]/-', '') ILIKE $${p} OR
          EXISTS (
            SELECT 1 FROM compositions c2
            JOIN titles t2 ON c2.title_id = t2.id
            WHERE c2.group_id = g.id AND TRANSLATE(LOWER(t2.text), '.,;:!?"''()[]/-', '') ILIKE $${p}
          ) OR
          EXISTS (
            SELECT 1 FROM compositions c2
            CROSS JOIN LATERAL unnest(COALESCE(c2.composer_id_list, ARRAY[]::integer[])) AS cid
            JOIN composers comp ON comp.id = cid AND comp.id != 23
            WHERE c2.group_id = g.id
            AND TRANSLATE(LOWER(comp.name), '.,;:!?"''()[]/-', '') ILIKE $${p}
          )
        )`;
      });
      
      whereConditions.push(`(${titleConditions.join(' OR ')})`);
    }

    // Composers filter
    if (composerIds.length > 0) {
      const includesAnonymous = composerIds.includes(23);
      const namedComposerIds = composerIds.filter(id => id !== 23);
      
      if (includesAnonymous && namedComposerIds.length === 0) {
        // Only anonymous selected - groups must be entirely anonymous
        whereConditions.push(`NOT EXISTS (
          SELECT 1 FROM compositions c2
          CROSS JOIN unnest(COALESCE(c2.composer_id_list, ARRAY[]::integer[])) AS composer_id
          WHERE c2.group_id = g.id 
          AND c2.composer_id_list IS NOT NULL
          AND array_length(c2.composer_id_list, 1) > 0
          AND composer_id != 23
        )`);
      } else if (includesAnonymous && namedComposerIds.length > 0) {
        // Both anonymous and named composers selected - this is contradictory
        // Show groups that have the named composers OR are entirely anonymous
        whereConditions.push(`(
          EXISTS (
            SELECT 1 FROM compositions c2
            WHERE c2.group_id = g.id 
            AND c2.composer_id_list IS NOT NULL
            AND array_remove(c2.composer_id_list, NULL) && $${paramIndex}::integer[]
          )
          OR
          NOT EXISTS (
            SELECT 1 FROM compositions c2
            CROSS JOIN unnest(COALESCE(c2.composer_id_list, ARRAY[]::integer[])) AS composer_id
            WHERE c2.group_id = g.id 
            AND c2.composer_id_list IS NOT NULL
            AND array_length(c2.composer_id_list, 1) > 0
            AND composer_id != 23
          )
        )`);
        queryParams.push(namedComposerIds);
        paramIndex++;
      } else {
        // Only named composers selected - use original logic
        whereConditions.push(`EXISTS (
          SELECT 1 FROM compositions c2
          WHERE c2.group_id = g.id 
          AND c2.composer_id_list IS NOT NULL
          AND array_remove(c2.composer_id_list, NULL) && $${paramIndex}::integer[]
        )`);
        queryParams.push(composerIds);
        paramIndex++;
      }
    }

    // Voices filter
    if (voiceOptions.length > 0) {
      const voiceConditions = voiceOptions.map((voiceCount, index) => {
        const condition = `EXISTS (
          SELECT 1 FROM compositions c2
          WHERE c2.group_id = g.id AND c2.number_of_voices = $${paramIndex}
        )`;
        queryParams.push(voiceCount);
        paramIndex++;
        return condition;
      });
      whereConditions.push(`(${voiceConditions.join(' OR ')})`);
    }

    // Functions filter
    if (functionIds.length > 0) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM compositions c2
        JOIN titles t2 ON c2.title_id = t2.id
        JOIN functions_titles ft ON t2.id = ft.title_id
        WHERE c2.group_id = g.id AND ft.function_id = ANY($${paramIndex}::integer[])
      )`);
      queryParams.push(functionIds);
      paramIndex++;
    }

    // Languages filter
    if (languageIds.length > 0) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM compositions c2
        JOIN titles t2 ON c2.title_id = t2.id
        WHERE c2.group_id = g.id AND t2.language = ANY($${paramIndex}::integer[])
      )`);
      queryParams.push(languageIds);
      paramIndex++;
    }

    // Countries filter (composer birth countries) - optimized
    if (countryNames.length > 0) {
      whereConditions.push(`g.id IN (
        SELECT DISTINCT c2.group_id
        FROM compositions c2
        JOIN composers comp ON comp.id = ANY(c2.composer_id_list)
        WHERE comp.birthplace_2 = ANY($${paramIndex}::text[])
      )`);
      queryParams.push(countryNames);
      paramIndex++;
    }

    // Sources filter (from inclusions) - supports both IDs and wildcard patterns
    if (sourceIds.length > 0 || sourcePatterns.length > 0) {
      const sourceConditions = [];
      
      // Add condition for source IDs
      if (sourceIds.length > 0) {
        sourceConditions.push(`i.source_id = ANY($${paramIndex}::integer[])`);
        queryParams.push(sourceIds);
        paramIndex++;
      }
      
      // Add conditions for wildcard patterns
      sourcePatterns.forEach(pattern => {
        sourceConditions.push(`s.code ILIKE $${paramIndex}`);
        queryParams.push(pattern);
        paramIndex++;
      });
      
      whereConditions.push(`EXISTS (
        SELECT 1 FROM compositions c2
        JOIN inclusions i ON c2.id = i.composition_id
        JOIN sources s ON i.source_id = s.id
        WHERE c2.group_id = g.id AND (${sourceConditions.join(' OR ')})
      )`);
    }

    // Publisher/Scribe/Editor filter - check both publishers and scribes separately
    if (publisherIds.length > 0 || scribeIds.length > 0) {
      const conditions = [];
      
      // Check publishers - only if we have publisher IDs
      if (publisherIds.length > 0) {
        const publisherCondition = `EXISTS (
          SELECT 1 FROM compositions c2
          JOIN inclusions i ON c2.id = i.composition_id
          JOIN sources s ON i.source_id = s.id
          JOIN publishers_sources ps ON s.id = ps.source_id
          WHERE c2.group_id = g.id 
            AND s.catalogued = true
            AND ps.publisher_id IS NOT NULL
            AND ps.publisher_id = ANY($${paramIndex}::integer[])
        )`;
        queryParams.push(publisherIds);
        paramIndex++;
        conditions.push(publisherCondition);
      }
      
      // Check scribes - only if we have scribe IDs
      if (scribeIds.length > 0) {
        const scribeCondition = `EXISTS (
          SELECT 1 FROM compositions c2
          JOIN inclusions i ON c2.id = i.composition_id
          JOIN sources s ON i.source_id = s.id
          JOIN scribes_sources ss ON s.id = ss.source_id
          WHERE c2.group_id = g.id 
            AND s.catalogued = true
            AND ss.scribe_id IS NOT NULL
            AND ss.scribe_id = ANY($${paramIndex}::integer[])
        )`;
        queryParams.push(scribeIds);
        paramIndex++;
        conditions.push(scribeCondition);
      }
      
      // Combine with OR - a composition matches if it has any of the selected publishers OR scribes
      if (conditions.length > 0) {
        whereConditions.push(`(${conditions.join(' OR ')})`);
      }
    }

    // Cities filter (publication places)
    if (cityNames.length > 0) {
      const cityConditions = cityNames.map((cityName, index) => {
        const condition = `EXISTS (
          SELECT 1 FROM compositions c2
          JOIN inclusions i ON c2.id = i.composition_id
          JOIN sources s ON i.source_id = s.id
          WHERE c2.group_id = g.id AND s.town ILIKE $${paramIndex}
        )`;
        queryParams.push(`%${cityName}%`);
        paramIndex++;
        return condition;
      });
      whereConditions.push(`(${cityConditions.join(' OR ')})`);
    }

    // Has editions filter
    if (hasEditions) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM editions e
        WHERE e.group_id = g.id
      )`);
    }

    // Has recordings filter
    if (hasRecordings) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM recordings r
        WHERE r.group_id = g.id
      )`);
    }

    // Composition types filter
    if (compositionTypeIds.length > 0) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM compositions c2
        WHERE c2.group_id = g.id AND c2.composition_type_id = ANY($${paramIndex}::integer[])
      )`);
      queryParams.push(compositionTypeIds);
      paramIndex++;
    }

    // Tones filter  
    if (toneValues.length > 0) {
      // Use tone values directly as strings for database query
      const validToneValues = toneValues.filter(val => val && val.trim());
      
      if (validToneValues.length > 0) {
        if (isArray) {
          whereConditions.push(`EXISTS (
            SELECT 1 FROM compositions c2
            WHERE c2.group_id = g.id AND c2.tone && $${paramIndex}::text[]
          )`);
          queryParams.push(validToneValues);
        } else {
          whereConditions.push(`EXISTS (
            SELECT 1 FROM compositions c2
            WHERE c2.group_id = g.id AND c2.tone = ANY($${paramIndex}::text[])
          )`);
          queryParams.push(validToneValues);
        }
        paramIndex++;
      }
    }

    // Even/Odd filter
    if (evenOddValues.length > 0) {
      const validEvenOddIntegers = evenOddValues.map(val => parseInt(val)).filter(val => !isNaN(val));
      if (validEvenOddIntegers.length > 0) {
        whereConditions.push(`EXISTS (
          SELECT 1 FROM compositions c2
          WHERE c2.group_id = g.id AND c2.even_odd = ANY($${paramIndex}::integer[])
        )`);
        queryParams.push(validEvenOddIntegers);
        paramIndex++;
      }
    }

    // Voicing filter (database-driven clef combinations) - skip if tables don't exist
    if (voicingIds.length > 0) {
      try {
        // Get clef combinations associated with selected voicings
        const voicingClefsQuery = `
          SELECT DISTINCT cc.clef_combination
          FROM clef_combinations_voicings ccv
          JOIN clef_combinations cc ON ccv.clef_combination_id = cc.id
          WHERE ccv.voicing_id = ANY($1::integer[])
        `;
        
        const voicingClefsResult = await pool.query(voicingClefsQuery, [voicingIds]);
        
        if (voicingClefsResult.rows.length > 0) {
          // Use the new indexed sorted_clef_combination column for fast matching
          const targetClefCombinations = voicingClefsResult.rows
            .map(row => row.clef_combination)
            .filter(combo => combo && combo.trim());
          
          if (targetClefCombinations.length > 0) {
            // Test if the new columns exist with a simple query first
            try {
              await pool.query('SELECT sorted_clef_combination_required FROM inclusions LIMIT 1');
              
              // Simple exact matching - the clef_combinations_voicings mapping already defines valid combinations
              const condition = `EXISTS (
                SELECT 1 FROM compositions c2
                JOIN inclusions i ON c2.id = i.composition_id
                WHERE c2.group_id = g.id 
                AND (
                  i.sorted_clef_combination_required = ANY($${paramIndex}::text[])
                  OR i.sorted_clef_combination_all = ANY($${paramIndex}::text[])
                )
              )`;
              
              whereConditions.push(condition);
              queryParams.push(targetClefCombinations);
              paramIndex++;
            } catch (columnError) {
              throw columnError; // This will trigger the fallback
            }
          }
        }
              } catch (voicingError) {
        console.error('Voicing filter skipped (tables may not exist):', voicingError.message);
        // Fallback to old logic if new column doesn't exist yet
        try {
          const voicingClefsQuery = `
            SELECT DISTINCT cc.clef_combination
            FROM clef_combinations_voicings ccv
            JOIN clef_combinations cc ON ccv.clef_combination_id = cc.id
            WHERE ccv.voicing_id = ANY($1::integer[])
          `;
          
          const voicingClefsResult = await pool.query(voicingClefsQuery, [voicingIds]);
          
          if (voicingClefsResult.rows.length > 0) {
            const voicingConditions = voicingClefsResult.rows.map((row) => {
              const targetClefCombination = row.clef_combination;
              if (!targetClefCombination) return null;
              
              const condition = `EXISTS (
                SELECT 1 FROM compositions c2
                JOIN inclusions i ON c2.id = i.composition_id
                WHERE c2.group_id = g.id 
                AND i.clefs IS NOT NULL
                AND (
                  SELECT string_agg(clef_obj->>'clef', '' ORDER BY 
                    CASE clef_obj->>'clef'
                      ${CLEF_DISPLAY_ORDER.map((clef, idx) => `WHEN '${clef}' THEN ${idx}`).join(' ')}
                      ELSE 999
                    END
                  )
                  FROM jsonb_array_elements(i.clefs) AS clef_obj
                  WHERE (clef_obj->>'optional')::boolean IS NOT TRUE
                  AND clef_obj->>'clef' IS NOT NULL
                  AND clef_obj->>'clef' != ''
                ) = '${targetClefCombination}'
              )`;
              
              return condition;
            }).filter(condition => condition !== null);
            
            if (voicingConditions.length > 0) {
              whereConditions.push(`(${voicingConditions.join(' OR ')})`);
            }
          }
        } catch (fallbackError) {
          console.error('Voicing filter completely failed:', fallbackError.message);
        }
      }
    }

    // Date filter - filter by earliest source date
    // Find groups where at least one source's date range overlaps with the specified range
    if (yearFrom !== null || yearTo !== null) {
      // Date filter logic:
      // - Only yearFrom: sources that end on or after yearFrom (s.to_year >= yearFrom) - EXCLUDE sources without dates
      // - Only yearTo: sources that start on or before yearTo (s.from_year <= yearTo) - EXCLUDE sources without dates
      // - Both: sources that overlap with the range (s.from_year <= yearTo AND s.to_year >= yearFrom) - EXCLUDE sources without dates
      let dateCondition = `EXISTS (
        SELECT 1 FROM compositions c2
        JOIN inclusions i ON c2.id = i.composition_id
        JOIN sources s ON i.source_id = s.id
        WHERE c2.group_id = g.id
        AND s.from_year IS NOT NULL
        AND s.to_year IS NOT NULL
        AND (
          ${yearFrom !== null && yearTo !== null 
            ? `s.from_year <= $${paramIndex + 1} AND s.to_year >= $${paramIndex}`
            : yearFrom !== null 
              ? `s.to_year >= $${paramIndex}`
              : `s.from_year <= $${paramIndex}`
          }
        )
      )`;
      
      if (yearFrom !== null) {
        queryParams.push(yearFrom);
        paramIndex++;
      }
      if (yearTo !== null) {
        queryParams.push(yearTo);
        paramIndex++;
      }
      
      whereConditions.push(dateCondition);
    }

    // Clef filter - search by clef combination pattern with wildcards
    // Supports multiple comma-separated patterns (OR logic)
    if (clefPattern) {
      // Parse comma-separated patterns
      const clefPatterns = clefPattern.split(',').map(p => p.trim()).filter(p => p);
      
      if (clefPatterns.length > 0) {
        // Build conditions for each pattern
        const patternConditions = [];
        
        clefPatterns.forEach((pattern) => {
            // Convert pattern to SQL LIKE pattern (replace % with SQL %)
            const sqlPattern = pattern.replace(/%/g, '%');
            
            // Check if pattern contains wildcards
            const hasWildcards = pattern.includes('%');
            
            if (hasWildcards) {
              // Use LIKE for wildcard matching
              patternConditions.push(`(
                (
                  SELECT string_agg(clef_obj->>'clef', '' ORDER BY 
                    CASE clef_obj->>'clef'
                      ${CLEF_DISPLAY_ORDER.map((clef, idx) => `WHEN '${clef}' THEN ${idx}`).join(' ')}
                      ELSE 999
                    END
                  )
                  FROM jsonb_array_elements(i.clefs) AS clef_obj
                  WHERE (clef_obj->>'optional')::boolean IS NOT TRUE
                  AND clef_obj->>'clef' IS NOT NULL
                  AND clef_obj->>'clef' != ''
                ) LIKE $${paramIndex}
                OR
                (
                  SELECT string_agg(clef_obj->>'clef', '' ORDER BY 
                    CASE clef_obj->>'clef'
                      ${CLEF_DISPLAY_ORDER.map((clef, idx) => `WHEN '${clef}' THEN ${idx}`).join(' ')}
                      ELSE 999
                    END
                  )
                  FROM jsonb_array_elements(i.clefs) AS clef_obj
                  WHERE clef_obj->>'clef' IS NOT NULL
                  AND clef_obj->>'clef' != ''
                ) LIKE $${paramIndex}
              )`);
              queryParams.push(sqlPattern);
              paramIndex++;
            } else {
              // Exact match
              patternConditions.push(`(
                (
                  SELECT string_agg(clef_obj->>'clef', '' ORDER BY 
                    CASE clef_obj->>'clef'
                      ${CLEF_DISPLAY_ORDER.map((clef, idx) => `WHEN '${clef}' THEN ${idx}`).join(' ')}
                      ELSE 999
                    END
                  )
                  FROM jsonb_array_elements(i.clefs) AS clef_obj
                  WHERE (clef_obj->>'optional')::boolean IS NOT TRUE
                  AND clef_obj->>'clef' IS NOT NULL
                  AND clef_obj->>'clef' != ''
                ) = $${paramIndex}
                OR
                (
                  SELECT string_agg(clef_obj->>'clef', '' ORDER BY 
                    CASE clef_obj->>'clef'
                      ${CLEF_DISPLAY_ORDER.map((clef, idx) => `WHEN '${clef}' THEN ${idx}`).join(' ')}
                      ELSE 999
                    END
                  )
                  FROM jsonb_array_elements(i.clefs) AS clef_obj
                  WHERE clef_obj->>'clef' IS NOT NULL
                  AND clef_obj->>'clef' != ''
                ) = $${paramIndex}
              )`);
              queryParams.push(pattern);
              paramIndex++;
            }
          });
          
          // Combine all patterns with OR logic
          if (patternConditions.length > 0) {
            whereConditions.push(`EXISTS (
              SELECT 1 FROM compositions c2
              JOIN inclusions i ON c2.id = i.composition_id
              WHERE c2.group_id = g.id
              AND i.clefs IS NOT NULL
              AND (${patternConditions.join(' OR ')})
            )`);
          }
        }
      }

    // Source type filter - filter by source type (at least one source has this type)
    if (sourceTypes.length > 0) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM compositions c2
        JOIN inclusions i ON c2.id = i.composition_id
        JOIN sources s ON i.source_id = s.id
        WHERE c2.group_id = g.id 
          AND s.catalogued = true
          AND s.type IS NOT NULL
          AND s.type != ''
          AND s.type = ANY($${paramIndex}::text[])
      )`);
      queryParams.push(sourceTypes);
      paramIndex++;
    }

    // Source format filter - filter by source format (at least one source has this format)
    if (sourceFormats.length > 0) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM compositions c2
        JOIN inclusions i ON c2.id = i.composition_id
        JOIN sources s ON i.source_id = s.id
        WHERE c2.group_id = g.id 
          AND s.catalogued = true
          AND s.format IS NOT NULL
          AND s.format != ''
          AND s.format = ANY($${paramIndex}::text[])
      )`);
      queryParams.push(sourceFormats);
      paramIndex++;
    }

    // Anniversary filter - find composers with birth or death anniversaries (multiples of 50 years)
    if (anniversaryYear !== null && !isNaN(anniversaryYear)) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM compositions c2
        CROSS JOIN unnest(COALESCE(c2.composer_id_list, ARRAY[]::integer[])) AS composer_id
        JOIN composers comp ON comp.id = composer_id
        WHERE c2.group_id = g.id
          AND comp.id != 23 -- Exclude anonymous composer
          AND (
            (comp.from_year IS NOT NULL AND ($${paramIndex} - comp.from_year) % 50 = 0)
            OR
            (comp.to_year IS NOT NULL AND ($${paramIndex} - comp.to_year) % 50 = 0)
          )
      )`);
      queryParams.push(anniversaryYear);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Subquery to get a numeric sort key from the first tone of a group's composition
    const toneSortExpr = isArray
      ? `(SELECT CASE c.tone[1]
            WHEN '1' THEN 1 WHEN '2' THEN 2 WHEN '3' THEN 3 WHEN '4' THEN 4
            WHEN '5' THEN 5 WHEN '6' THEN 6 WHEN '7' THEN 7 WHEN '8' THEN 8
            WHEN '9' THEN 9 WHEN '10' THEN 10 WHEN '11' THEN 11 WHEN '12' THEN 12
            WHEN 'mix' THEN 13 WHEN 'per' THEN 14 WHEN 'pro' THEN 15 ELSE 99 END
          FROM compositions c WHERE c.group_id = g.id AND c.tone IS NOT NULL LIMIT 1)`
      : `(SELECT CASE c.tone
            WHEN '1' THEN 1 WHEN '2' THEN 2 WHEN '3' THEN 3 WHEN '4' THEN 4
            WHEN '5' THEN 5 WHEN '6' THEN 6 WHEN '7' THEN 7 WHEN '8' THEN 8
            WHEN '9' THEN 9 WHEN '10' THEN 10 WHEN '11' THEN 11 WHEN '12' THEN 12
            WHEN 'mix' THEN 13 WHEN 'per' THEN 14 WHEN 'pro' THEN 15 ELSE 99 END
          FROM compositions c WHERE c.group_id = g.id AND c.tone IS NOT NULL LIMIT 1)`;

    // Build ORDER BY clause based on sort parameter
    let orderByClause = '';
    switch (sort) {
      case 'title':
        orderByClause = `ORDER BY g.display_title, ${toneSortExpr} NULLS LAST`;
        break;
      case 'title_desc':
        orderByClause = `ORDER BY g.display_title DESC, ${toneSortExpr} DESC NULLS LAST`;
        break;
      case 'function':
        orderByClause = `ORDER BY (
          SELECT string_agg(func_name, ', ' ORDER BY func_name)
          FROM (
            SELECT DISTINCT 
              CASE 
                WHEN ct.name IS NOT NULL AND func.name IS NOT NULL THEN '(' || ct.name || ') ' || func.name
                WHEN ct.name IS NOT NULL THEN '(' || ct.name || ')'
                WHEN func.name IS NOT NULL THEN func.name
                ELSE NULL
              END as func_name
            FROM compositions c
            LEFT JOIN composition_types ct ON c.composition_type_id = ct.id
            JOIN titles t ON c.title_id = t.id
            LEFT JOIN functions_titles ft ON t.id = ft.title_id
            LEFT JOIN functions func ON ft.function_id = func.id
            WHERE c.group_id = g.id AND (func.name IS NOT NULL OR ct.name IS NOT NULL)
          ) funcs
          WHERE func_name IS NOT NULL
        )`;
        break;
      case 'function_desc':
        orderByClause = `ORDER BY (
          SELECT string_agg(func_name, ', ' ORDER BY func_name DESC)
          FROM (
            SELECT DISTINCT 
              CASE 
                WHEN ct.name IS NOT NULL AND func.name IS NOT NULL THEN '(' || ct.name || ') ' || func.name
                WHEN ct.name IS NOT NULL THEN '(' || ct.name || ')'
                WHEN func.name IS NOT NULL THEN func.name
                ELSE NULL
              END as func_name
            FROM compositions c
            LEFT JOIN composition_types ct ON c.composition_type_id = ct.id
            JOIN titles t ON c.title_id = t.id
            LEFT JOIN functions_titles ft ON t.id = ft.title_id
            LEFT JOIN functions func ON ft.function_id = func.id
            WHERE c.group_id = g.id AND (func.name IS NOT NULL OR ct.name IS NOT NULL)
          ) funcs
          WHERE func_name IS NOT NULL
        ) DESC`;
        break;
      case 'composer':
        orderByClause = 'ORDER BY composer_display';
        break;
      case 'composer_desc':
        orderByClause = 'ORDER BY composer_display DESC';
        break;
      case 'voices':
        orderByClause = `ORDER BY (
          SELECT MIN(voice_count)
          FROM (
            SELECT DISTINCT c.number_of_voices as voice_count
            FROM compositions c
            WHERE c.group_id = g.id AND c.number_of_voices IS NOT NULL
          ) voices
        )`;
        break;
      case 'voices_desc':
        orderByClause = `ORDER BY (
          SELECT MIN(voice_count)
          FROM (
            SELECT DISTINCT c.number_of_voices as voice_count
            FROM compositions c
            WHERE c.group_id = g.id AND c.number_of_voices IS NOT NULL
          ) voices
        ) DESC`;
        break;
      case 'sources_earliest':
        orderByClause = `ORDER BY (
          SELECT MIN(s.from_year) 
          FROM compositions comp
          JOIN inclusions i ON comp.id = i.composition_id
          JOIN sources s ON i.source_id = s.id
          WHERE comp.group_id = g.id AND s.from_year IS NOT NULL
        )`;
        break;
      case 'sources_latest':
        orderByClause = `ORDER BY (
          SELECT MAX(s.to_year) 
          FROM compositions comp
          JOIN inclusions i ON comp.id = i.composition_id
          JOIN sources s ON i.source_id = s.id
          WHERE comp.group_id = g.id AND s.to_year IS NOT NULL
        ) DESC`;
        break;
      case 'order_in_source':
        if (sourceIds.length === 1 && sourcePatterns.length === 0) {
          // Sort by order in the selected source (only if exactly one ID, no patterns)
          orderByClause = `ORDER BY (
            SELECT MIN(i.order)
            FROM compositions comp
            JOIN inclusions i ON comp.id = i.composition_id
            WHERE comp.group_id = g.id AND i.source_id = ${sourceIds[0]}
          )`;
        } else {
          // Sort by lowest order across all sources
          orderByClause = `ORDER BY (
            SELECT MIN(i.order)
            FROM compositions comp
            JOIN inclusions i ON comp.id = i.composition_id
            WHERE comp.group_id = g.id
          )`;
        }
        break;
      case 'order_in_source_desc':
        if (sourceIds.length === 1 && sourcePatterns.length === 0) {
          // Sort by order in the selected source (descending) - only if exactly one ID, no patterns
          orderByClause = `ORDER BY (
            SELECT MIN(i.order)
            FROM compositions comp
            JOIN inclusions i ON comp.id = i.composition_id
            WHERE comp.group_id = g.id AND i.source_id = ${sourceIds[0]}
          ) DESC`;
        } else {
          // Sort by lowest order across all sources (descending)
          orderByClause = `ORDER BY (
            SELECT MIN(i.order)
            FROM compositions comp
            JOIN inclusions i ON comp.id = i.composition_id
            WHERE comp.group_id = g.id
          ) DESC`;
        }
        break;
      case 'recent':
        orderByClause = 'ORDER BY g.updated_at DESC NULLS LAST';
        break;
      default:
        orderByClause = 'ORDER BY g.display_title';
        break;
    }

    const toneSubquery = isArray
      ? `(SELECT c.tone FROM compositions c WHERE c.group_id = g.id AND c.tone IS NOT NULL LIMIT 1)`
      : `(SELECT ARRAY[c.tone] FROM compositions c WHERE c.group_id = g.id AND c.tone IS NOT NULL LIMIT 1)`;

    // Count query for pagination
    const countQuery = `
      SELECT COUNT(DISTINCT g.id) as total
      FROM groups g
      ${whereClause}
    `;

    // Main search query with all related data
    const searchQuery = `
      SELECT 
        g.id,
        g.display_title,
        g.created_at,
        g.updated_at,
        gc_info.composer_display,
        gc_info.composer_dates,
        (
          SELECT array_agg(voice_count ORDER BY voice_count)
          FROM (
            SELECT DISTINCT c.number_of_voices as voice_count
            FROM compositions c
            WHERE c.group_id = g.id AND c.number_of_voices IS NOT NULL
          ) voices
        ) as voice_counts,
        ${toneSubquery} as tone,
        (
          SELECT c.tone_connector
          FROM compositions c
          WHERE c.group_id = g.id AND c.tone_connector IS NOT NULL
          LIMIT 1
        ) as tone_connector,
        (
          SELECT DISTINCT c.even_odd
          FROM compositions c
          WHERE c.group_id = g.id AND c.even_odd IS NOT NULL
          LIMIT 1
        ) as even_odd,
        (
          SELECT array_agg(func_name ORDER BY func_name)
          FROM (
            SELECT DISTINCT 
              CASE 
                WHEN ct.name IS NOT NULL AND func.name IS NOT NULL THEN '(' || ct.name || ') ' || func.name
                WHEN ct.name IS NOT NULL THEN '(' || ct.name || ')'
                WHEN func.name IS NOT NULL THEN func.name
                ELSE NULL
              END as func_name
            FROM compositions c
            LEFT JOIN composition_types ct ON c.composition_type_id = ct.id
            JOIN titles t ON c.title_id = t.id
            LEFT JOIN functions_titles ft ON t.id = ft.title_id
            LEFT JOIN functions func ON ft.function_id = func.id
            WHERE c.group_id = g.id AND (func.name IS NOT NULL OR ct.name IS NOT NULL)
          ) funcs
          WHERE func_name IS NOT NULL
        ) as function_names,
        -- Get editions for this group
        (
          SELECT json_agg(json_build_object(
            'id', e.id,
            'editor_name', ed.name,
            'voicing', e.voicing,
            'file_url', e.file_url
          ) ORDER BY ed.name)
          FROM editions e
          LEFT JOIN editors ed ON e.editor_id = ed.id
          WHERE e.group_id = g.id
        ) as editions,
        -- Get recordings for this group
        (
          SELECT json_agg(json_build_object(
            'id', r.id,
            'performer_name', p.name,
            'file_url', r.file_url
          ) ORDER BY p.name)
          FROM recordings r
          LEFT JOIN performers p ON r.performer_id = p.id
          WHERE r.group_id = g.id
        ) as recordings,
        -- Get sources for this group
        (
          SELECT json_agg(json_build_object(
            'id', s.id,
            'code', s.code,
            'title', s.title,
            'type', s.type,
            'format', s.format,
            'town', s.town,
            'from_year', s.from_year,
            'to_year', s.to_year,
            'from_year_annotation', s.from_year_annotation,
            'to_year_annotation', s.to_year_annotation,
            'rism_link', s.rism_link,
            'source_notes', s.notes,
            'position', i.position,
            'order', i.order,
            'attribution_texts', i.attribution_texts,
            'inclusion_notes', i.notes,
            'clefs', i.clefs,
            'composition_titles', COALESCE(comp_titles.titles, '[]'::json),
            'publishers', COALESCE(pubs.publishers, '[]'::json),
            'scribes', COALESCE(scr.scribes, '[]'::json),
            'source_images', COALESCE(imgs.images, '[]'::json)
          ) ORDER BY s.from_year, s.code, s.title)
          FROM compositions comp
          JOIN inclusions i ON comp.id = i.composition_id
          JOIN sources s ON i.source_id = s.id
          LEFT JOIN (
            SELECT i2.source_id, json_agg(DISTINCT t.text ORDER BY t.text) as titles
            FROM inclusions i2
            JOIN compositions c2 ON i2.composition_id = c2.id
            JOIN titles t ON c2.title_id = t.id
            WHERE c2.group_id = g.id
            GROUP BY i2.source_id
          ) comp_titles ON s.id = comp_titles.source_id
          LEFT JOIN (
            SELECT ps.source_id, json_agg(p.name ORDER BY p.name) as publishers
            FROM publishers_sources ps
            JOIN publishers p ON ps.publisher_id = p.id
            GROUP BY ps.source_id
          ) pubs ON s.id = pubs.source_id
          LEFT JOIN (
            SELECT ss.source_id, json_agg(sc.name ORDER BY sc.name) as scribes
            FROM scribes_sources ss
            JOIN scribes sc ON ss.scribe_id = sc.id
            GROUP BY ss.source_id
          ) scr ON s.id = scr.source_id
          LEFT JOIN (
            SELECT si.source_id, json_agg(json_build_object(
              'id', si.id,
              'url', si.url,
              'label', si.label
            ) ORDER BY si.id) as images
            FROM source_images si
            GROUP BY si.source_id
          ) imgs ON s.id = imgs.source_id
          WHERE comp.group_id = g.id AND s.catalogued = true
        ) as sources
      FROM groups g
      LEFT JOIN LATERAL (
        SELECT
          CASE 
            WHEN named_ct > 1 THEN 'conflicting attributions'
            WHEN named_ct = 1 THEN single_name
            ELSE 'Anon'
          END as composer_display,
          CASE 
            WHEN named_ct = 1 THEN (
              SELECT CASE 
                WHEN comp.from_year IS NOT NULL AND comp.to_year IS NOT NULL 
                THEN '(' || COALESCE(comp.from_year_annotation, '') || comp.from_year || '–' || COALESCE(comp.to_year_annotation, '') || comp.to_year || ')'
                WHEN comp.from_year IS NOT NULL 
                THEN '(' || COALESCE(comp.from_year_annotation, '') || comp.from_year || '–)'
                WHEN comp.to_year IS NOT NULL 
                THEN '(–' || COALESCE(comp.to_year_annotation, '') || comp.to_year || ')'
                ELSE NULL
              END
              FROM composers comp WHERE comp.id = single_id
            )
            ELSE NULL
          END as composer_dates
        FROM (
          SELECT 
            COUNT(DISTINCT cid) as named_ct,
            MIN(cid) as single_id,
            (SELECT comp2.name FROM composers comp2 WHERE comp2.id = MIN(cid)) as single_name
          FROM (
            SELECT DISTINCT unnest_id as cid
            FROM compositions c2
            CROSS JOIN unnest(COALESCE(c2.composer_id_list, ARRAY[]::integer[])) AS unnest_id
            WHERE c2.group_id = g.id 
              AND c2.composer_id_list IS NOT NULL 
              AND array_length(c2.composer_id_list, 1) > 0
              AND unnest_id != 23
          ) named
        ) agg
      ) gc_info ON true
      ${whereClause}
      GROUP BY g.id, g.display_title, g.created_at, g.updated_at, gc_info.composer_display, gc_info.composer_dates
      ${orderByClause}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    // Ensure limit and offset are valid integers
    const finalLimit = parseInt(limit) || 25;
    const finalOffset = parseInt(offset) || 0;
    
        queryParams.push(finalLimit, finalOffset);

    const [countResult, searchResult] = await Promise.all([
      pool.query(countQuery, queryParams.slice(0, -2)),
      pool.query(searchQuery, queryParams)
    ]);

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / parseInt(limit));

    res.json({
      groups: searchResult.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages,
        hasNextPage: parseInt(page) < totalPages,
        hasPrevPage: parseInt(page) > 1
      }
    });

  } catch (error) {
    console.error('Error in public groups search:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});



// Public endpoints for filter data (no authentication required)
router.get('/composers', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT c.id, c.name
      FROM composers c
      INNER JOIN (
        SELECT DISTINCT unnest(composer_id_list) as composer_id
        FROM compositions comp
        INNER JOIN groups g ON comp.group_id = g.id
      ) comp_composers ON c.id = comp_composers.composer_id
      WHERE c.name IS NOT NULL
      ORDER BY c.name
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching composers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/functions', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT f.id, f.name
      FROM functions f
      INNER JOIN functions_titles ft ON f.id = ft.function_id
      INNER JOIN titles t ON ft.title_id = t.id
      INNER JOIN compositions c ON t.id = c.title_id
      INNER JOIN groups g ON c.group_id = g.id
      ORDER BY f.name
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching functions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/languages', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT l.id, l.language as name
      FROM languages l
      INNER JOIN titles t ON l.id = t.language
      INNER JOIN compositions c ON t.id = c.title_id
      INNER JOIN groups g ON c.group_id = g.id
      ORDER BY l.language
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching languages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/countries', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT comp.birthplace_2 as name
      FROM composers comp
      INNER JOIN (
        SELECT DISTINCT unnest(composer_id_list) as composer_id
        FROM compositions
        WHERE composer_id_list IS NOT NULL
      ) used_composers ON comp.id = used_composers.composer_id
      WHERE comp.birthplace_2 IS NOT NULL AND comp.birthplace_2 != ''
      ORDER BY comp.birthplace_2
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching countries:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/sources', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT s.id, s.code, s.title
      FROM sources s
      INNER JOIN inclusions i ON s.id = i.source_id
      INNER JOIN compositions c ON i.composition_id = c.id
      INNER JOIN groups g ON c.group_id = g.id
      WHERE s.code IS NOT NULL AND s.catalogued = true
      ORDER BY s.code
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching sources:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/publishers', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT p.id, p.name
      FROM publishers p
      INNER JOIN publishers_sources ps ON p.id = ps.publisher_id
      INNER JOIN sources s ON ps.source_id = s.id
      INNER JOIN inclusions i ON s.id = i.source_id
      INNER JOIN compositions c ON i.composition_id = c.id
      INNER JOIN groups g ON c.group_id = g.id
      WHERE s.catalogued = true
      ORDER BY p.name
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching publishers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/cities', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT s.town as name
      FROM sources s
      INNER JOIN inclusions i ON s.id = i.source_id
      INNER JOIN compositions c ON i.composition_id = c.id
      INNER JOIN groups g ON c.group_id = g.id
      WHERE s.town IS NOT NULL AND s.town != '' AND s.catalogued = true
      ORDER BY s.town
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching cities:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/voicings', async (req, res) => {
  try {
    const query = `
      SELECT id, voicing as name
      FROM voicings
      ORDER BY voicing
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching voicings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/voices', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT number_of_voices as voice_count
      FROM compositions
      WHERE number_of_voices IS NOT NULL
      ORDER BY number_of_voices
    `;
    const result = await pool.query(query);
    res.json(result.rows.map(row => ({ value: row.voice_count, name: row.voice_count.toString() })));
  } catch (error) {
    console.error('Error fetching voice counts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/composition-types', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT ct.id, ct.name
      FROM composition_types ct
      INNER JOIN compositions c ON ct.id = c.composition_type_id
      INNER JOIN groups g ON c.group_id = g.id
      ORDER BY ct.name
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching composition types:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/tones', async (req, res) => {
  try {
    const isArray = await toneIsArray();
    const toneOrder = `CASE tone
        WHEN '1' THEN 1 WHEN '2' THEN 2 WHEN '3' THEN 3
        WHEN '4' THEN 4 WHEN '5' THEN 5 WHEN '6' THEN 6
        WHEN '7' THEN 7 WHEN '8' THEN 8 WHEN '9' THEN 9
        WHEN '10' THEN 10 WHEN '11' THEN 11 WHEN '12' THEN 12
        WHEN 'per' THEN 13 WHEN 'mix' THEN 14 WHEN 'pro' THEN 15
        ELSE 99 END`;
    const query = isArray
      ? `SELECT tone FROM (
           SELECT DISTINCT unnest(tone) AS tone FROM compositions WHERE tone IS NOT NULL
         ) sub WHERE tone != '' ORDER BY ${toneOrder}`
      : `SELECT tone FROM (
           SELECT DISTINCT tone FROM compositions WHERE tone IS NOT NULL AND tone != ''
         ) sub ORDER BY ${toneOrder}`;
    const result = await pool.query(query);
    
    const toneMapping = {
      "1": "primi toni",
      "2": "secundi toni", 
      "3": "tertii toni",
      "4": "quarti toni",
      "5": "quinti toni",
      "6": "sexti toni",
      "7": "septimi toni",
      "8": "octavi toni",
      "9": "noni toni",
      "10": "decimi toni",
      "11": "undecimi toni",
      "12": "duodecimi toni",
      "mix": "mixti toni",
      "per": "peregrini toni",
      "pro": "proprii toni"
    };
    
    res.json(result.rows.map(row => ({ 
      value: row.tone, 
      name: toneMapping[row.tone] || `Tone ${row.tone}` 
    })));
  } catch (error) {
    console.error('Error fetching tones:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/even-odd', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT even_odd
      FROM compositions
      WHERE even_odd IS NOT NULL
      ORDER BY even_odd
    `;
    const result = await pool.query(query);
    const evenOddMapping = {
      0: 'even',
      1: 'odd', 
      2: 'both'
    };
    res.json(result.rows.map(row => ({ 
      value: row.even_odd, 
      name: evenOddMapping[row.even_odd] || row.even_odd 
    })));
  } catch (error) {
    console.error('Error fetching even/odd values:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/scribes', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT s.id, s.name
      FROM scribes s
      INNER JOIN scribes_sources ss ON s.id = ss.scribe_id
      INNER JOIN sources src ON ss.source_id = src.id
      INNER JOIN inclusions i ON src.id = i.source_id
      INNER JOIN compositions c ON i.composition_id = c.id
      INNER JOIN groups g ON c.group_id = g.id
      WHERE s.name IS NOT NULL
      ORDER BY s.name
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching scribes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/source-types', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT s.type as name
      FROM sources s
      INNER JOIN inclusions i ON s.id = i.source_id
      INNER JOIN compositions c ON i.composition_id = c.id
      INNER JOIN groups g ON c.group_id = g.id
      WHERE s.type IS NOT NULL AND s.type != ''
      ORDER BY s.type
    `;
    const result = await pool.query(query);
    res.json(result.rows.map(row => ({ name: row.name })));
  } catch (error) {
    console.error('Error fetching source types:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/source-formats', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT s.format as name
      FROM sources s
      INNER JOIN inclusions i ON s.id = i.source_id
      INNER JOIN compositions c ON i.composition_id = c.id
      INNER JOIN groups g ON c.group_id = g.id
      WHERE s.format IS NOT NULL AND s.format != ''
      ORDER BY s.format
    `;
    const result = await pool.query(query);
    res.json(result.rows.map(row => ({ name: row.name })));
  } catch (error) {
    console.error('Error fetching source formats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 