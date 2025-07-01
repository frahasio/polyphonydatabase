import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

// Utility function to extract base title (remove roman numerals in square brackets)
function extractBaseTitle(titleText) {
  if (!titleText) return '';
  
  // Remove roman numerals in square brackets (e.g., [I], [II], [III], etc.)
  // Handle cases where brackets might be anywhere in the title
  const romanNumeralPattern = /\s*\[[IVX]+\]\s*/g;
  
  return titleText
    .replace(romanNumeralPattern, ' ')  // Replace with space to avoid joining words
    .replace(/\s+/g, ' ')               // Normalize multiple spaces to single space
    .trim();                            // Remove leading/trailing spaces
}

// Utility function to group titles by base text
function groupTitlesByBase(titles) {
  const groups = new Map();
  
  titles.forEach(title => {
    const baseText = extractBaseTitle(title.text);
    const key = baseText.toLowerCase(); // Case-insensitive grouping
    
    if (!groups.has(key)) {
      groups.set(key, {
        baseText: baseText,
        originalBaseText: baseText, // Keep original case for display
        titles: [],
        totalCompositions: 0,
        allFunctionNames: new Set()
      });
    }
    
    const group = groups.get(key);
    group.titles.push(title);
    group.totalCompositions += title.composition_count || 0;
    
    // Add function names to the set
    if (title.function_names && Array.isArray(title.function_names)) {
      title.function_names.forEach(name => {
        if (name) group.allFunctionNames.add(name);
      });
    }
    
    // Update base text to use the "best" version (prefer non-empty, maintain original case)
    if (baseText && baseText.length > group.originalBaseText.length) {
      group.originalBaseText = baseText;
    }
  });
  
  // Convert sets to arrays and finalize groups
  return Array.from(groups.values()).map(group => ({
    ...group,
    allFunctionNames: Array.from(group.allFunctionNames),
    variantCount: group.titles.length
  }));
}

// Get all functions with their associated titles
router.get('/', async (req, res) => {
  try {
    const searchTerm = req.query.search || '';
    let query = `
      SELECT 
        f.id,
        f.name,
        f.created_at,
        f.updated_at,
        COUNT(ft.title_id) as title_count
      FROM functions f
      LEFT JOIN functions_titles ft ON f.id = ft.function_id
    `;

    const queryParams = [];
    if (searchTerm) {
      query += ` WHERE f.name ILIKE $1`;
      queryParams.push(`%${searchTerm}%`);
    }

    query += `
      GROUP BY f.id, f.name, f.created_at, f.updated_at
      ORDER BY f.name
    `;

    const result = await pool.query(query, queryParams);
    
    res.json({
      functions: result.rows
    });
  } catch (error) {
    console.error('Error fetching functions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Test endpoint to verify title base extraction
router.get('/titles/test-extraction', async (req, res) => {
  try {
    const testTitles = [
      'Salve Regina [I]',
      'Salve Regina [II]',
      'Salve regina [I] - Eia ergo',
      'Salve regina [II] - O clemens',
      'Ave Maria [I]',
      'Ave Maria [II]',
      'Pange lingua [III]',
      'Te Deum',
      'Kyrie [IV] from Mass',
      '[I] Gloria in excelsis'
    ];

    const results = testTitles.map(title => ({
      original: title,
      baseText: extractBaseTitle(title),
      groupKey: extractBaseTitle(title).toLowerCase()
    }));

    // Group them to show how they would be grouped
    const grouped = {};
    results.forEach(result => {
      const key = result.groupKey;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(result.original);
    });

    res.json({
      individual: results,
      grouped: grouped,
      note: "This endpoint helps verify that title base extraction and grouping works correctly"
    });
  } catch (error) {
    console.error('Error in test extraction:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get languages - MUST come before /:id route!
router.get('/languages', async (req, res) => {
  try {
    let languages = [];
    
    try {
      // Try to get languages from a languages table
      const result = await pool.query('SELECT id, language as name FROM languages ORDER BY language');
      languages = result.rows;
    } catch (dbError) {
      console.log('Languages table not found or error accessing it:', dbError.message);
      // Languages table doesn't exist or error accessing it
    }

    // If no languages found in database, use fallback
    if (languages.length === 0) {
      languages = [
        { id: 1, name: 'Latin' },
        { id: 2, name: 'English' },
        { id: 3, name: 'French' },
        { id: 4, name: 'Italian' },
        { id: 5, name: 'German' },
        { id: 6, name: 'Spanish' },
        { id: 7, name: 'Dutch' },
        { id: 8, name: 'Portuguese' }
      ];
    }
    
    res.json({ languages });
  } catch (error) {
    console.error('Error in languages endpoint:', error);
    // Even on error, return fallback languages
    res.json({ 
      languages: [
        { id: 1, name: 'Latin' },
        { id: 2, name: 'English' },
        { id: 3, name: 'French' },
        { id: 4, name: 'Italian' },
        { id: 5, name: 'German' },
        { id: 6, name: 'Spanish' },
        { id: 7, name: 'Dutch' },
        { id: 8, name: 'Portuguese' }
      ]
    });
  }
});

// Get dashboard alerts for data quality issues
router.get('/dashboard/alerts', async (req, res) => {
  try {
    const alerts = [];

    // Check for titles with no functions assigned
    const titlesNoFunctions = await pool.query(`
      SELECT COUNT(*) as count
      FROM titles t
      LEFT JOIN functions_titles ft ON t.id = ft.title_id
      WHERE ft.title_id IS NULL
    `);

    if (parseInt(titlesNoFunctions.rows[0].count) > 0) {
      alerts.push({
        type: 'warning',
        title: 'Titles without Functions',
        count: parseInt(titlesNoFunctions.rows[0].count),
        description: 'titles have no functions assigned',
        action_url: '/modules/functions/index.html?filter=no_functions',
        action_text: 'Assign Functions'
      });
    }

    // Check for functions with no titles assigned
    const functionsNoTitles = await pool.query(`
      SELECT COUNT(*) as count
      FROM functions f
      LEFT JOIN functions_titles ft ON f.id = ft.function_id
      WHERE ft.function_id IS NULL
    `);

    if (parseInt(functionsNoTitles.rows[0].count) > 0) {
      alerts.push({
        type: 'info',
        title: 'Functions without Titles',
        count: parseInt(functionsNoTitles.rows[0].count),
        description: 'functions have no titles assigned',
        action_url: '/modules/functions/index.html?filter=empty_functions',
        action_text: 'Add Titles'
      });
    }

    // Check for titles with null language
    const titlesNoLanguage = await pool.query(`
      SELECT COUNT(*) as count
      FROM titles
      WHERE language IS NULL
    `);

    if (parseInt(titlesNoLanguage.rows[0].count) > 0) {
      alerts.push({
        type: 'warning',
        title: 'Titles without Language',
        count: parseInt(titlesNoLanguage.rows[0].count),
        description: 'titles have no language assigned',
        action_url: '/modules/functions/index.html?filter=no_language',
        action_text: 'Assign Languages'
      });
    }

    res.json({ alerts });
  } catch (error) {
    console.error('Error fetching dashboard alerts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get function by ID with its titles
router.get('/:id', async (req, res) => {
  try {
    const functionId = parseInt(req.params.id);

    // Get function details
    const functionQuery = `
      SELECT id, name, created_at, updated_at
      FROM functions
      WHERE id = $1
    `;

    const functionResult = await pool.query(functionQuery, [functionId]);
    
    if (functionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Function not found' });
    }

    // Get associated titles
    const titlesQuery = `
      SELECT t.id, t.text, t.language, t.created_at, t.updated_at
      FROM titles t
      INNER JOIN functions_titles ft ON t.id = ft.title_id
      WHERE ft.function_id = $1
      ORDER BY t.text
    `;

    const titlesResult = await pool.query(titlesQuery, [functionId]);

    res.json({
      function: functionResult.rows[0],
      titles: titlesResult.rows
    });
  } catch (error) {
    console.error('Error fetching function:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new function
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;

    const query = `
      INSERT INTO functions (name, created_at, updated_at)
      VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `;

    const result = await pool.query(query, [name]);
    
    const newFunction = result.rows[0];

    // Log audit entry
    try {
      await pool.query(
        `SELECT log_audit_entry($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.user?.id || null,
          req.user?.email || 'unknown@system.local',
          'CREATE',
          'functions',
          newFunction.id,
          null,
          JSON.stringify(newFunction)
        ]
      );
    } catch (auditError) {
      console.log('Audit logging skipped (audit system may not be set up):', auditError.message);
    }

    res.status(201).json(newFunction);
  } catch (error) {
    console.error('Error creating function:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update function
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    const query = `
      UPDATE functions
      SET name = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;

    const result = await pool.query(query, [name, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Function not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating function:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete function
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // First delete associations
    await pool.query('DELETE FROM functions_titles WHERE function_id = $1', [id]);
    
    // Then delete the function
    await pool.query('DELETE FROM functions WHERE id = $1', [id]);
    
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting function:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all titles with advanced search and similarity matching
router.get('/titles/search', async (req, res) => {
  try {
    const { 
      search = '', 
      language = '', 
      function_id = '',
      similar = 'false',
      grouped = 'false',
      page = 1,
      limit = 50 
    } = req.query;

    const offset = (page - 1) * limit;
    let countQuery = `
      SELECT COUNT(DISTINCT t.id) FROM titles t
      LEFT JOIN functions_titles ft ON t.id = ft.title_id
    `;
    let query = `
      SELECT 
        t.id,
        t.text,
        t.language,
        l.language as language_name,
        t.created_at,
        t.updated_at,
        COUNT(DISTINCT c.id) as composition_count,
        COUNT(DISTINCT ft.function_id) as function_count,
        ARRAY_AGG(DISTINCT f.name) FILTER (WHERE f.name IS NOT NULL) as function_names
      FROM titles t
      LEFT JOIN compositions c ON t.id = c.title_id
      LEFT JOIN functions_titles ft ON t.id = ft.title_id
      LEFT JOIN functions f ON ft.function_id = f.id
      LEFT JOIN languages l ON t.language = l.id
    `;

    const queryParams = [];
    const conditions = [];

    if (search) {
      // Handle special dashboard filters
      if (search === '*no_functions*') {
        conditions.push(`ft.title_id IS NULL`);
      } else if (search === '*no_language*') {
        conditions.push(`t.language IS NULL`);
      } else if (similar === 'true') {
        // Use basic similarity search for finding potential duplicates
        conditions.push(`(
          t.text ILIKE $${queryParams.length + 1} OR
          t.text ILIKE $${queryParams.length + 2} OR
          t.text ILIKE $${queryParams.length + 3}
        )`);
        queryParams.push(`%${search}%`, `%${search.toLowerCase()}%`, `%${search.toUpperCase()}%`);
      } else {
        conditions.push(`t.text ILIKE $${queryParams.length + 1}`);
        queryParams.push(`%${search}%`);
      }
    }

    if (language) {
      conditions.push(`t.language = $${queryParams.length + 1}`);
      queryParams.push(parseInt(language));
    }

    if (function_id) {
      conditions.push(`ft.function_id = $${queryParams.length + 1}`);
      queryParams.push(parseInt(function_id));
    }

    if (conditions.length > 0) {
      const whereClause = ` WHERE ${conditions.join(' AND ')}`;
      query += whereClause;
      countQuery += whereClause;
    }

    if (grouped === 'true') {
      // For grouped results, get all matching titles without pagination first
      const allTitlesQuery = query + `
        GROUP BY t.id, t.text, t.language, l.language, t.created_at, t.updated_at
        ORDER BY t.text
      `;
      
      const allTitlesResult = await pool.query(allTitlesQuery, queryParams);
      const groupedTitles = groupTitlesByBase(allTitlesResult.rows);
      
      // Apply pagination to groups
      const total = groupedTitles.length;
      const totalPages = Math.ceil(total / limit);
      const paginatedGroups = groupedTitles.slice(offset, offset + parseInt(limit));

      res.json({
        titleGroups: paginatedGroups,
        isGrouped: true,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      });
    } else {
      // Original individual title results
      query += `
        GROUP BY t.id, t.text, t.language, l.language, t.created_at, t.updated_at
        ORDER BY t.text
        LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
      `;

      queryParams.push(limit, offset);

      const [countResult, titlesResult] = await Promise.all([
        pool.query(countQuery, queryParams.slice(0, -2)),
        pool.query(query, queryParams)
      ]);

      const total = parseInt(countResult.rows[0].count);
      const totalPages = Math.ceil(total / limit);

      res.json({
        titles: titlesResult.rows,
        isGrouped: false,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      });
    }
  } catch (error) {
    console.error('Error searching titles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get details of a title group by base text
router.get('/titles/group/:baseText', async (req, res) => {
  try {
    const baseText = decodeURIComponent(req.params.baseText);
    
    // Find all titles that match this base text
    const query = `
      SELECT 
        t.id,
        t.text,
        t.language,
        l.language as language_name,
        t.created_at,
        t.updated_at,
        COUNT(DISTINCT c.id) as composition_count,
        COUNT(DISTINCT ft.function_id) as function_count,
        ARRAY_AGG(DISTINCT f.name) FILTER (WHERE f.name IS NOT NULL) as function_names
      FROM titles t
      LEFT JOIN compositions c ON t.id = c.title_id
      LEFT JOIN functions_titles ft ON t.id = ft.title_id
      LEFT JOIN functions f ON ft.function_id = f.id
      LEFT JOIN languages l ON t.language = l.id
      GROUP BY t.id, t.text, t.language, l.language, t.created_at, t.updated_at
      ORDER BY t.text
    `;

    const allTitlesResult = await pool.query(query);
    
    // Filter titles that match the base text
    const matchingTitles = allTitlesResult.rows.filter(title => 
      extractBaseTitle(title.text).toLowerCase() === baseText.toLowerCase()
    );

    if (matchingTitles.length === 0) {
      return res.status(404).json({ error: 'No titles found for this base text' });
    }

    // Group the matching titles
    const groups = groupTitlesByBase(matchingTitles);
    const group = groups[0]; // Should only be one group since we filtered by base text

    res.json({
      group: group,
      titles: matchingTitles
    });
  } catch (error) {
    console.error('Error fetching title group:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk update all titles in a group (update base text while preserving bracketed portions)
router.put('/titles/group/bulk-update', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { originalBaseText, newBaseText, language } = req.body;
    
    if (!originalBaseText || !newBaseText) {
      return res.status(400).json({ 
        error: 'originalBaseText and newBaseText are required' 
      });
    }

    await client.query('BEGIN');

    // Find all titles that match the original base text
    const findTitlesQuery = `
      SELECT id, text, language 
      FROM titles 
      ORDER BY text
    `;
    
    const allTitlesResult = await client.query(findTitlesQuery);
    
    // Filter titles that match the original base text
    const titlesToUpdate = allTitlesResult.rows.filter(title => 
      extractBaseTitle(title.text).toLowerCase() === originalBaseText.toLowerCase()
    );

    if (titlesToUpdate.length === 0) {
      throw new Error('No titles found matching the original base text');
    }

    // Calculate what the new titles will be and check for conflicts
    const titleUpdates = [];
    
    for (const title of titlesToUpdate) {
      const currentText = title.text;
      const currentBaseText = extractBaseTitle(currentText);
      
      // Replace the base text while preserving bracketed portions and other text
      let newFullText = currentText;
      
      // Find the bracketed roman numeral pattern
      const romanNumeralPattern = /\[[IVX]+\]/g;
      const matches = [...currentText.matchAll(romanNumeralPattern)];
      
      if (matches.length > 0) {
        // If there are bracketed portions, we need to carefully replace the base text
        // Strategy: split by brackets, replace the first non-bracket part that matches base
        const parts = currentText.split(/(\[[IVX]+\])/);
        
        // Find the largest part that contains the base text and replace it
        let replaced = false;
        for (let i = 0; i < parts.length; i++) {
          if (!parts[i].match(/^\[[IVX]+\]$/) && !replaced) {
            // This is not a bracketed part
            const partBase = extractBaseTitle(parts[i]);
            if (partBase.toLowerCase() === currentBaseText.toLowerCase()) {
              // Replace this part
              parts[i] = parts[i].replace(partBase, newBaseText);
              replaced = true;
              break;
            }
          }
        }
        
        newFullText = parts.join('');
      } else {
        // No brackets, simple replacement
        newFullText = newBaseText;
      }

      titleUpdates.push({
        id: title.id,
        currentText: currentText,
        newText: newFullText.trim(),
        language: language !== undefined ? language : title.language
      });
    }

    // First, handle internal conflicts within the titleUpdates array
    const internalMerges = [];
    const finalUpdates = [];
    const processedIds = new Set();

    for (const update of titleUpdates) {
      if (processedIds.has(update.id)) continue;

      // Find all other updates that would result in the same text
      const duplicates = titleUpdates.filter(u => 
        u.newText === update.newText && u.id !== update.id && !processedIds.has(u.id)
      );

      if (duplicates.length > 0) {
        // We have internal conflicts - merge them
        const allConflicting = [update, ...duplicates];
        
        // Choose the target (prefer the one with most compositions, or lowest ID as tiebreaker)
        let target = allConflicting[0];
        for (const candidate of allConflicting.slice(1)) {
          const targetCompositions = await client.query('SELECT COUNT(*) as count FROM compositions WHERE title_id = $1', [target.id]);
          const candidateCompositions = await client.query('SELECT COUNT(*) as count FROM compositions WHERE title_id = $1', [candidate.id]);
          
          const targetCount = parseInt(targetCompositions.rows[0].count);
          const candidateCount = parseInt(candidateCompositions.rows[0].count);
          
          if (candidateCount > targetCount || (candidateCount === targetCount && candidate.id < target.id)) {
            target = candidate;
          }
        }

        // Merge all others into the target
        for (const source of allConflicting) {
          if (source.id === target.id) continue;

          // Update compositions to point to target
          await client.query(`
            UPDATE compositions 
            SET title_id = $1, updated_at = CURRENT_TIMESTAMP 
            WHERE title_id = $2
          `, [target.id, source.id]);

          // Merge function associations
          const sourceFunctions = await client.query(`
            SELECT function_id FROM functions_titles WHERE title_id = $1
          `, [source.id]);

          for (const func of sourceFunctions.rows) {
            // Check if association already exists
            const existing = await client.query(`
              SELECT 1 FROM functions_titles 
              WHERE function_id = $1 AND title_id = $2
            `, [func.function_id, target.id]);

            if (existing.rows.length === 0) {
              await client.query(`
                INSERT INTO functions_titles (function_id, title_id)
                VALUES ($1, $2)
              `, [func.function_id, target.id]);
            }
          }

          // Remove associations from source
          await client.query(`
            DELETE FROM functions_titles WHERE title_id = $1
          `, [source.id]);

          // Delete source title
          await client.query('DELETE FROM titles WHERE id = $1', [source.id]);

          internalMerges.push({
            action: 'internal_merged',
            sourceId: source.id,
            sourceText: source.currentText,
            targetId: target.id,
            finalText: target.newText
          });

          processedIds.add(source.id);
        }

        // Add the target to final updates
        finalUpdates.push(target);
        processedIds.add(target.id);
      } else {
        // No internal conflicts for this update
        finalUpdates.push(update);
        processedIds.add(update.id);
      }
    }

    // Check for existing titles that would conflict with our new texts
    const newTexts = finalUpdates.map(update => update.newText);
    const conflictQuery = `
      SELECT t.id, t.text, t.language, 
             COUNT(DISTINCT c.id) as composition_count,
             ARRAY_AGG(DISTINCT f.name) FILTER (WHERE f.name IS NOT NULL) as function_names
      FROM titles t
      LEFT JOIN compositions c ON t.id = c.title_id
      LEFT JOIN functions_titles ft ON t.id = ft.title_id
      LEFT JOIN functions f ON ft.function_id = f.id
      WHERE t.text = ANY($1) AND t.id != ALL($2)
      GROUP BY t.id, t.text, t.language
    `;
    
    const existingTitleIds = finalUpdates.map(update => update.id);
    const conflictsResult = await client.query(conflictQuery, [newTexts, existingTitleIds]);
    
    if (conflictsResult.rows.length > 0) {
      // We have conflicts - need to merge rather than update
      const conflicts = conflictsResult.rows;
      const mergedTitles = [];
      
      for (const conflict of conflicts) {
        // Find which of our updates conflicts with this existing title
        const conflictingUpdate = finalUpdates.find(update => update.newText === conflict.text);
        
        if (conflictingUpdate) {
          // Merge the updating title into the existing one
          
          // Update compositions to point to the existing title
          await client.query(`
            UPDATE compositions 
            SET title_id = $1, updated_at = CURRENT_TIMESTAMP 
            WHERE title_id = $2
          `, [conflict.id, conflictingUpdate.id]);

          // Merge function associations
          const sourceFunctions = await client.query(`
            SELECT function_id FROM functions_titles WHERE title_id = $1
          `, [conflictingUpdate.id]);

          for (const func of sourceFunctions.rows) {
            // Check if association already exists
            const existing = await client.query(`
              SELECT 1 FROM functions_titles 
              WHERE function_id = $1 AND title_id = $2
            `, [func.function_id, conflict.id]);

            if (existing.rows.length === 0) {
              // Only insert if it doesn't exist
              await client.query(`
                INSERT INTO functions_titles (function_id, title_id)
                VALUES ($1, $2)
              `, [func.function_id, conflict.id]);
            }
          }

          // Remove associations from source title
          await client.query(`
            DELETE FROM functions_titles WHERE title_id = $1
          `, [conflictingUpdate.id]);

          // Delete the source title
          await client.query('DELETE FROM titles WHERE id = $1', [conflictingUpdate.id]);
          
          // Update the existing title's language if specified
          if (language !== undefined) {
            await client.query(`
              UPDATE titles 
              SET language = $1, updated_at = CURRENT_TIMESTAMP 
              WHERE id = $2
            `, [language, conflict.id]);
          }
          
          mergedTitles.push({
            action: 'external_merged',
            originalId: conflictingUpdate.id,
            originalText: conflictingUpdate.currentText,
            mergedIntoId: conflict.id,
            finalText: conflict.text
          });
          
          // Remove this update from our list since we handled it via merge
          const updateIndex = finalUpdates.findIndex(update => update.id === conflictingUpdate.id);
          if (updateIndex > -1) {
            finalUpdates.splice(updateIndex, 1);
          }
        }
      }
      
      // Continue with remaining non-conflicting updates
      const updatedTitles = [];
      for (const update of finalUpdates) {
        const updateQuery = `
          UPDATE titles 
          SET text = $1, language = $2, updated_at = CURRENT_TIMESTAMP 
          WHERE id = $3 
          RETURNING *
        `;
        
        const updateResult = await client.query(updateQuery, [
          update.newText,
          update.language,
          update.id
        ]);
        
        updatedTitles.push({
          action: 'updated',
          ...updateResult.rows[0]
        });
      }

      // Update groups display_title that match any of the original title texts
      const groupDisplayUpdates = [];
      if (originalBaseText !== newBaseText) {
        // Collect all original title texts that were part of this update
        const allOriginalTexts = [...titlesToUpdate.map(t => t.text)];
        
        // Find groups with display_title matching any of the original title texts
        const matchingGroupsQuery = `
          SELECT id, display_title FROM groups 
          WHERE display_title = ANY($1)
        `;
        const matchingGroupsResult = await client.query(matchingGroupsQuery, [allOriginalTexts]);

        // Update each matching group to use the new base text
        for (const group of matchingGroupsResult.rows) {
          // Determine what the new display_title should be
          let newDisplayTitle = newBaseText;
          
          // If the group's display_title had roman numerals, preserve them
          const groupBaseText = extractBaseTitle(group.display_title);
          if (groupBaseText.toLowerCase() === originalBaseText.toLowerCase() && group.display_title !== groupBaseText) {
            // The group display_title has additional parts (like roman numerals), preserve them
            const romanNumeralPattern = /\[[IVX]+\]/g;
            const matches = [...group.display_title.matchAll(romanNumeralPattern)];
            
            if (matches.length > 0) {
              const parts = group.display_title.split(/(\[[IVX]+\])/);
              let replaced = false;
              for (let i = 0; i < parts.length; i++) {
                if (!parts[i].match(/^\[[IVX]+\]$/) && !replaced) {
                  const partBase = extractBaseTitle(parts[i]);
                  if (partBase.toLowerCase() === groupBaseText.toLowerCase()) {
                    parts[i] = parts[i].replace(partBase, newBaseText);
                    replaced = true;
                    break;
                  }
                }
              }
              newDisplayTitle = parts.join('');
            }
          }
          
          const updateGroupQuery = `
            UPDATE groups 
            SET display_title = $1, updated_at = CURRENT_TIMESTAMP 
            WHERE id = $2 
            RETURNING *
          `;
          
          const updatedGroupResult = await client.query(updateGroupQuery, [newDisplayTitle.trim(), group.id]);
          groupDisplayUpdates.push(updatedGroupResult.rows[0]);
        }
      }

      await client.query('COMMIT');

      const totalProcessed = updatedTitles.length + mergedTitles.length + internalMerges.length;
      const messageDetails = [];
      if (updatedTitles.length > 0) messageDetails.push(`${updatedTitles.length} updated`);
      if (internalMerges.length > 0) messageDetails.push(`${internalMerges.length} internally merged`);
      if (mergedTitles.length > 0) messageDetails.push(`${mergedTitles.length} externally merged`);
      if (groupDisplayUpdates.length > 0) messageDetails.push(`${groupDisplayUpdates.length} group display titles updated`);

      res.json({
        success: true,
        message: `Successfully processed ${totalProcessed} titles (${messageDetails.join(', ')})`,
        updatedTitles: updatedTitles,
        internalMerges: internalMerges,
        mergedTitles: mergedTitles,
        groupDisplayUpdates: groupDisplayUpdates,
        originalBaseText,
        newBaseText,
        hadConflicts: true
      });

    } else {
      // No external conflicts, proceed with normal updates
      const updatedTitles = [];
      
      for (const update of finalUpdates) {
        const updateQuery = `
          UPDATE titles 
          SET text = $1, language = $2, updated_at = CURRENT_TIMESTAMP 
          WHERE id = $3 
          RETURNING *
        `;
        
        const updateResult = await client.query(updateQuery, [
          update.newText,
          update.language,
          update.id
        ]);
        
        updatedTitles.push(updateResult.rows[0]);
      }

      // Update groups display_title that match any of the original title texts
      const groupDisplayUpdates = [];
      if (originalBaseText !== newBaseText) {
        // Collect all original title texts that were part of this update
        const allOriginalTexts = [...titlesToUpdate.map(t => t.text)];
        
        // Find groups with display_title matching any of the original title texts
        const matchingGroupsQuery = `
          SELECT id, display_title FROM groups 
          WHERE display_title = ANY($1)
        `;
        const matchingGroupsResult = await client.query(matchingGroupsQuery, [allOriginalTexts]);

        // Update each matching group to use the new base text
        for (const group of matchingGroupsResult.rows) {
          // Determine what the new display_title should be
          let newDisplayTitle = newBaseText;
          
          // If the group's display_title had roman numerals, preserve them
          const groupBaseText = extractBaseTitle(group.display_title);
          if (groupBaseText.toLowerCase() === originalBaseText.toLowerCase() && group.display_title !== groupBaseText) {
            // The group display_title has additional parts (like roman numerals), preserve them
            const romanNumeralPattern = /\[[IVX]+\]/g;
            const matches = [...group.display_title.matchAll(romanNumeralPattern)];
            
            if (matches.length > 0) {
              const parts = group.display_title.split(/(\[[IVX]+\])/);
              let replaced = false;
              for (let i = 0; i < parts.length; i++) {
                if (!parts[i].match(/^\[[IVX]+\]$/) && !replaced) {
                  const partBase = extractBaseTitle(parts[i]);
                  if (partBase.toLowerCase() === groupBaseText.toLowerCase()) {
                    parts[i] = parts[i].replace(partBase, newBaseText);
                    replaced = true;
                    break;
                  }
                }
              }
              newDisplayTitle = parts.join('');
            }
          }
          
          const updateGroupQuery = `
            UPDATE groups 
            SET display_title = $1, updated_at = CURRENT_TIMESTAMP 
            WHERE id = $2 
            RETURNING *
          `;
          
          const updatedGroupResult = await client.query(updateGroupQuery, [newDisplayTitle.trim(), group.id]);
          groupDisplayUpdates.push(updatedGroupResult.rows[0]);
        }
      }

      await client.query('COMMIT');

      const totalProcessed = updatedTitles.length + internalMerges.length;
      const messageDetails = [];
      if (updatedTitles.length > 0) messageDetails.push(`${updatedTitles.length} updated`);
      if (internalMerges.length > 0) messageDetails.push(`${internalMerges.length} internally merged`);
      if (groupDisplayUpdates.length > 0) messageDetails.push(`${groupDisplayUpdates.length} group display titles updated`);

      res.json({
        success: true,
        message: `Successfully processed ${totalProcessed} titles (${messageDetails.join(', ')})`,
        updatedTitles: updatedTitles,
        internalMerges: internalMerges,
        groupDisplayUpdates: groupDisplayUpdates,
        originalBaseText,
        newBaseText,
        hadConflicts: internalMerges.length > 0 || groupDisplayUpdates.length > 0
      });
    }

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error bulk updating title group:', error);
    res.status(500).json({ 
      error: 'Failed to bulk update titles: ' + error.message 
    });
  } finally {
    client.release();
  }
});

// Create new title
router.post('/titles', async (req, res) => {
  try {
    const { text, language } = req.body;

    const query = `
      INSERT INTO titles (text, language, created_at, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `;

    const result = await pool.query(query, [text, language || null]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating title:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update title
router.put('/titles/:id', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    const { text, language } = req.body;

    // First, get the current title to check if base text will change
    const currentTitleQuery = `
      SELECT id, text, language FROM titles WHERE id = $1
    `;
    const currentTitleResult = await client.query(currentTitleQuery, [id]);
    
    if (currentTitleResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Title not found' });
    }

    const currentTitle = currentTitleResult.rows[0];
    const oldBaseText = extractBaseTitle(currentTitle.text);
    const newBaseText = extractBaseTitle(text);

    // Update the target title
    const updateQuery = `
      UPDATE titles
      SET text = $1, language = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `;

    const result = await client.query(updateQuery, [text, language || null, id]);
    const updatedTitle = result.rows[0];

    // If the base text changed, update other titles in the same group
    if (oldBaseText.toLowerCase() !== newBaseText.toLowerCase() && oldBaseText.trim() !== '') {
      
      // Find all other titles that share the same old base text
      const allTitlesQuery = `SELECT id, text, language FROM titles WHERE id != $1`;
      const allTitlesResult = await client.query(allTitlesQuery, [id]);
      
      const titlesToUpdate = allTitlesResult.rows.filter(title => 
        extractBaseTitle(title.text).toLowerCase() === oldBaseText.toLowerCase()
      );

      const groupUpdates = [];

      // Update each title in the group
      for (const titleToUpdate of titlesToUpdate) {
        const currentText = titleToUpdate.text;
        const currentBaseInTitle = extractBaseTitle(currentText);
        
        // Replace the base text while preserving bracketed portions
        let newFullText = currentText;
        
        // Find the bracketed roman numeral pattern
        const romanNumeralPattern = /\[[IVX]+\]/g;
        const matches = [...currentText.matchAll(romanNumeralPattern)];
        
        if (matches.length > 0) {
          // Split by brackets and replace the base text part
          const parts = currentText.split(/(\[[IVX]+\])/);
          
          let replaced = false;
          for (let i = 0; i < parts.length; i++) {
            if (!parts[i].match(/^\[[IVX]+\]$/) && !replaced) {
              const partBase = extractBaseTitle(parts[i]);
              if (partBase.toLowerCase() === currentBaseInTitle.toLowerCase()) {
                // Replace this part, maintaining the same case pattern as the new text
                parts[i] = parts[i].replace(partBase, newBaseText);
                replaced = true;
                break;
              }
            }
          }
          
          newFullText = parts.join('');
        } else {
          // No brackets, simple replacement
          newFullText = newBaseText;
        }

        // Update this related title
        const groupUpdateQuery = `
          UPDATE titles 
          SET text = $1, updated_at = CURRENT_TIMESTAMP 
          WHERE id = $2 
          RETURNING *
        `;
        
        const groupUpdateResult = await client.query(groupUpdateQuery, [
          newFullText.trim(),
          titleToUpdate.id
        ]);
        
        groupUpdates.push(groupUpdateResult.rows[0]);
      }

      // Also update any groups with matching display_title
      const groupDisplayUpdates = [];
      if (oldBaseText.trim() !== '' && oldBaseText !== newBaseText) {
        // Collect all the original title texts that were changed
        const originalTitleTexts = [currentTitle.text, ...titlesToUpdate.map(t => t.text)];
        
        // Find groups with display_title matching ANY of the changed title texts
        const placeholders = originalTitleTexts.map((_, index) => `$${index + 1}`).join(', ');
        const matchingGroupsQuery = `
          SELECT id, display_title FROM groups 
          WHERE display_title IN (${placeholders})
        `;
        const matchingGroupsResult = await client.query(matchingGroupsQuery, originalTitleTexts);

        // Update each matching group to use the new base text
        for (const group of matchingGroupsResult.rows) {
          // Determine what the new display_title should be
          let newDisplayTitle = newBaseText;
          
          // If the group's display_title had roman numerals, preserve them
          const groupBaseText = extractBaseTitle(group.display_title);
          if (groupBaseText.toLowerCase() === oldBaseText.toLowerCase() && group.display_title !== groupBaseText) {
            // The group display_title has additional parts (like roman numerals), preserve them
            const romanNumeralPattern = /\[[IVX]+\]/g;
            const matches = [...group.display_title.matchAll(romanNumeralPattern)];
            
            if (matches.length > 0) {
              const parts = group.display_title.split(/(\[[IVX]+\])/);
              let replaced = false;
              for (let i = 0; i < parts.length; i++) {
                if (!parts[i].match(/^\[[IVX]+\]$/) && !replaced) {
                  const partBase = extractBaseTitle(parts[i]);
                  if (partBase.toLowerCase() === groupBaseText.toLowerCase()) {
                    parts[i] = parts[i].replace(partBase, newBaseText);
                    replaced = true;
                    break;
                  }
                }
              }
              newDisplayTitle = parts.join('');
            }
          }
          
          const updateGroupQuery = `
            UPDATE groups 
            SET display_title = $1, updated_at = CURRENT_TIMESTAMP 
            WHERE id = $2 
            RETURNING *
          `;
          
          const updatedGroupResult = await client.query(updateGroupQuery, [newDisplayTitle.trim(), group.id]);
          groupDisplayUpdates.push(updatedGroupResult.rows[0]);
        }
      }

      await client.query('COMMIT');

      // Get updated group information for the new base text
      const allUpdatedTitles = [updatedTitle, ...groupUpdates];
      const updatedGroup = groupTitlesByBase(allUpdatedTitles);

      res.json({
        title: updatedTitle,
        groupUpdatesApplied: groupUpdates.length > 0,
        groupUpdates: groupUpdates,
        groupDisplayUpdatesApplied: groupDisplayUpdates.length > 0,
        groupDisplayUpdates: groupDisplayUpdates,
        updatedGroup: updatedGroup[0], // The group containing all the updated titles
        groupDisplayTitleChange: {
          oldDisplayTitle: oldBaseText,
          newDisplayTitle: newBaseText,
          changed: oldBaseText !== newBaseText
        },
        oldBaseText: oldBaseText,
        newBaseText: newBaseText,
        message: [
          `Updated title`,
          groupUpdates.length > 0 ? `and ${groupUpdates.length} related titles in the same group` : '',
          groupDisplayUpdates.length > 0 ? `and ${groupDisplayUpdates.length} group display titles` : ''
        ].filter(Boolean).join(' ') + '.'
      });

    } else {
      // No base text change, just return the updated title
      await client.query('COMMIT');
      res.json({
        title: updatedTitle,
        groupUpdatesApplied: false,
        message: 'Updated title'
      });
    }

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating title:', error);
    
    // Check if this is a unique constraint violation (duplicate title text)
    if (error.code === '23505' && error.constraint === 'index_titles_on_text') {
      // Find the existing title that conflicts
      try {
        const conflictQuery = `
          SELECT t.id, t.text, t.language, 
                 COUNT(DISTINCT c.id) as composition_count,
                 ARRAY_AGG(DISTINCT f.name) FILTER (WHERE f.name IS NOT NULL) as function_names
          FROM titles t
          LEFT JOIN compositions c ON t.id = c.title_id
          LEFT JOIN functions_titles ft ON t.id = ft.title_id
          LEFT JOIN functions f ON ft.function_id = f.id
          WHERE t.text = $1 AND t.id != $2
          GROUP BY t.id, t.text, t.language
        `;
        
        const conflictResult = await pool.query(conflictQuery, [req.body.text, req.params.id]);
        
        if (conflictResult.rows.length > 0) {
          const existingTitle = conflictResult.rows[0];
          return res.status(409).json({
            error: 'DUPLICATE_TITLE',
            message: `A title with the text "${req.body.text}" already exists.`,
            existingTitle: existingTitle,
            suggestMerge: true
          });
        }
      } catch (lookupError) {
        console.error('Error looking up conflicting title:', lookupError);
      }
    }
    
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Merge titles - combines multiple titles into one and updates all references
router.post('/titles/merge', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { target_title_id: initial_target_id, source_title_ids, final_text, final_language } = req.body;
    
    if (!initial_target_id || !source_title_ids || source_title_ids.length === 0) {
      throw new Error('target_title_id and source_title_ids are required');
    }

    let target_title_id = initial_target_id;

    // Check if final text already exists (excluding target)
    const existingTitle = await client.query(`
      SELECT id FROM titles 
      WHERE text = $1 AND id != $2
    `, [final_text, target_title_id]);

    if (existingTitle.rows.length > 0) {
      // If final text exists, merge with that existing title instead
      const existingTitleId = existingTitle.rows[0].id;
      
      // Update target title to use existing title
      target_title_id = existingTitleId;
      
      // Update language if specified
      if (final_language) {
        await client.query(`
          UPDATE titles 
          SET language = $1, updated_at = CURRENT_TIMESTAMP 
          WHERE id = $2
        `, [final_language, target_title_id]);
      }
    } else {
      // Update the target title with final text and language
      await client.query(`
        UPDATE titles 
        SET text = $1, language = $2, updated_at = CURRENT_TIMESTAMP 
        WHERE id = $3
      `, [final_text, final_language || null, target_title_id]);
    }

    // Update all compositions that reference source titles to point to target title
    for (const sourceId of source_title_ids) {
      if (sourceId !== target_title_id) {
        await client.query(`
          UPDATE compositions 
          SET title_id = $1, updated_at = CURRENT_TIMESTAMP 
          WHERE title_id = $2
        `, [target_title_id, sourceId]);
      }
    }

    // Merge function associations - move all to target title
    for (const sourceId of source_title_ids) {
      if (sourceId !== target_title_id) {
        // First, get functions associated with source title
        const sourceFunctions = await client.query(`
          SELECT function_id FROM functions_titles WHERE title_id = $1
        `, [sourceId]);

        // Add associations to target title (ignore conflicts)
        for (const func of sourceFunctions.rows) {
          // Check if association already exists
          const existing = await client.query(`
            SELECT 1 FROM functions_titles 
            WHERE function_id = $1 AND title_id = $2
          `, [func.function_id, target_title_id]);

          if (existing.rows.length === 0) {
            // Only insert if it doesn't exist
            await client.query(`
              INSERT INTO functions_titles (function_id, title_id)
              VALUES ($1, $2)
            `, [func.function_id, target_title_id]);
          }
        }

        // Remove associations from source title
        await client.query(`
          DELETE FROM functions_titles WHERE title_id = $1
        `, [sourceId]);
      }
    }

    // Delete source titles (but not the target)
    for (const sourceId of source_title_ids) {
      if (sourceId !== target_title_id) {
        await client.query('DELETE FROM titles WHERE id = $1', [sourceId]);
      }
    }

    await client.query('COMMIT');

    // Return updated target title
    const result = await client.query(`
      SELECT t.*, 
             COUNT(DISTINCT c.id) as composition_count,
             COUNT(DISTINCT ft.function_id) as function_count
      FROM titles t
      LEFT JOIN compositions c ON t.id = c.title_id
      LEFT JOIN functions_titles ft ON t.id = ft.title_id
      WHERE t.id = $1
      GROUP BY t.id
    `, [target_title_id]);

    res.json({
      success: true,
      merged_title: result.rows[0],
      message: `Successfully merged ${source_title_ids.length} titles`
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error merging titles:', error);
    res.status(500).json({ error: 'Failed to merge titles: ' + error.message });
  } finally {
    client.release();
  }
});

// Assign/unassign title to function
router.post('/titles/:titleId/functions/:functionId', async (req, res) => {
  try {
    const { titleId, functionId } = req.params;

    // Check if association already exists
    const existing = await pool.query(`
      SELECT 1 FROM functions_titles 
      WHERE function_id = $1 AND title_id = $2
    `, [functionId, titleId]);

    if (existing.rows.length === 0) {
      // Only insert if it doesn't exist
      await pool.query(`
        INSERT INTO functions_titles (function_id, title_id)
        VALUES ($1, $2)
      `, [functionId, titleId]);
    }

    res.json({ success: true, message: 'Title assigned to function' });
  } catch (error) {
    console.error('Error assigning title to function:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/titles/:titleId/functions/:functionId', async (req, res) => {
  try {
    const { titleId, functionId } = req.params;

    await pool.query(`
      DELETE FROM functions_titles 
      WHERE function_id = $1 AND title_id = $2
    `, [functionId, titleId]);

    res.json({ success: true, message: 'Title unassigned from function' });
  } catch (error) {
    console.error('Error unassigning title from function:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk replace all function associations for a title
router.put('/titles/:titleId/functions', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { titleId } = req.params;
    const { functionIds } = req.body; // Array of function IDs

    if (!Array.isArray(functionIds)) {
      return res.status(400).json({ error: 'functionIds must be an array' });
    }

    await client.query('BEGIN');

    // Step 1: Delete all existing function associations for this title
    await client.query(`
      DELETE FROM functions_titles WHERE title_id = $1
    `, [titleId]);

    // Step 2: Insert new function associations
    if (functionIds.length > 0) {
      // Validate that all function IDs exist
      const validFunctions = await client.query(`
        SELECT id FROM functions WHERE id = ANY($1)
      `, [functionIds]);

      if (validFunctions.rows.length !== functionIds.length) {
        throw new Error('One or more function IDs are invalid');
      }

      // Insert all new associations in a single query
      const values = functionIds.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`).join(', ');
      const params = functionIds.flatMap(functionId => [functionId, titleId]);
      
      await client.query(`
        INSERT INTO functions_titles (function_id, title_id)
        VALUES ${values}
      `, params);
    }

    await client.query('COMMIT');

    res.json({ 
      success: true, 
      message: `Successfully updated function associations. ${functionIds.length} functions assigned.`
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating title function associations:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  } finally {
    client.release();
  }
});

export default router; 