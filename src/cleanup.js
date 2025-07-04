import { pool } from './db.js';

/**
 * Cleans up orphaned titles, groups, compositions, and clef combinations.
 * @param {object} dbClient - pg.Pool or pg.PoolClient
 * @param {string} [cleanup_type] - Optional: 'all', 'titles', 'groups', 'compositions', 'clef_combinations'
 * @returns {Promise<object>} - Results of cleanup
 */
export async function runDatabaseCleanup(dbClient = pool, cleanup_type = 'all') {
  let client;
  let externalClient = false;
  let results = {};
  try {
    // Accept either a pool or a client
    // Check if it's a pool (has totalCount property) or an already connected client
    if (typeof dbClient.totalCount === 'number') {
      // It's a pool, need to get a client
      client = await dbClient.connect();
    } else {
      // It's an already connected client
      client = dbClient;
      externalClient = true;
    }
    await client.query('BEGIN');

    if (!cleanup_type || cleanup_type === 'all') {
      // 1. Clean up unused titles = titles not referenced in compositions
      const unusedTitles = await client.query(`
        DELETE FROM titles 
        WHERE id NOT IN (SELECT title_id FROM compositions WHERE title_id IS NOT NULL)
        RETURNING id, text
      `);
      results.removed_titles = unusedTitles.rowCount;

      // 2. Clean up empty groups = groups with no compositions
      const emptyGroups = await client.query(`
        DELETE FROM groups 
        WHERE id NOT IN (SELECT group_id FROM compositions WHERE group_id IS NOT NULL)
        RETURNING id, display_title
      `);
      results.removed_groups = emptyGroups.rowCount;

      // 3. Clean up orphaned compositions = compositions not in any inclusions
      const orphanedCompositions = await client.query(`
        DELETE FROM compositions 
        WHERE id NOT IN (SELECT composition_id FROM inclusions WHERE composition_id IS NOT NULL)
        RETURNING id
      `);
      results.removed_compositions = orphanedCompositions.rowCount;

      // 4. Clean up orphaned clef combinations = clef combinations not used in inclusions
      try {
        const orphanedClefCombos = await client.query(`
          DELETE FROM clef_combinations 
          WHERE clef_combination NOT IN (
            SELECT sorted_clef_combination_required FROM inclusions 
            WHERE sorted_clef_combination_required IS NOT NULL
          )
          AND clef_combination NOT IN (
            SELECT sorted_clef_combination_all FROM inclusions 
            WHERE sorted_clef_combination_all IS NOT NULL
          )
          RETURNING id, clef_combination
        `);
        results.removed_clef_combinations = orphanedClefCombos.rowCount;
      } catch (error) {
        console.log('Clef combinations cleanup skipped (table may not exist):', error.message);
        results.removed_clef_combinations = 0;
      }
    } else if (cleanup_type === 'titles') {
      const unusedTitles = await client.query(`
        DELETE FROM titles 
        WHERE id NOT IN (SELECT title_id FROM compositions WHERE title_id IS NOT NULL)
        RETURNING id, text
      `);
      results.removed_titles = unusedTitles.rowCount;
    } else if (cleanup_type === 'groups') {
      const emptyGroups = await client.query(`
        DELETE FROM groups 
        WHERE id NOT IN (SELECT group_id FROM compositions WHERE group_id IS NOT NULL)
        RETURNING id, display_title
      `);
      results.removed_groups = emptyGroups.rowCount;
    } else if (cleanup_type === 'compositions') {
      const orphanedCompositions = await client.query(`
        DELETE FROM compositions 
        WHERE id NOT IN (SELECT composition_id FROM inclusions WHERE composition_id IS NOT NULL)
        RETURNING id
      `);
      results.removed_compositions = orphanedCompositions.rowCount;
    } else if (cleanup_type === 'clef_combinations') {
      try {
        const orphanedClefCombos = await client.query(`
          DELETE FROM clef_combinations 
          WHERE clef_combination NOT IN (
            SELECT sorted_clef_combination_required FROM inclusions 
            WHERE sorted_clef_combination_required IS NOT NULL
          )
          AND clef_combination NOT IN (
            SELECT sorted_clef_combination_all FROM inclusions 
            WHERE sorted_clef_combination_all IS NOT NULL
          )
          RETURNING id, clef_combination
        `);
        results.removed_clef_combinations = orphanedClefCombos.rowCount;
      } catch (error) {
        console.log('Clef combinations cleanup skipped (table may not exist):', error.message);
        results.removed_clef_combinations = 0;
      }
    }
    await client.query('COMMIT');
    return results;
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    throw error;
  } finally {
    if (client && !externalClient) client.release();
  }
} 