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
  let results = {
    removed_titles: 0,
    removed_groups: 0,
    removed_compositions: 0,
    removed_clef_combinations: 0,
    iterations: 0
  };
  
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

    // Run cleanup in iterations until nothing is removed
    let totalRemoved = 0;
    let iteration = 0;
    const maxIterations = 5; // Safety limit
    
    do {
      totalRemoved = 0;
      iteration++;
      
      if (!cleanup_type || cleanup_type === 'all') {
        // 1. Clean up orphaned compositions first (they don't depend on anything else)
        const orphanedCompositions = await client.query(`
          DELETE FROM compositions 
          WHERE id NOT IN (SELECT composition_id FROM inclusions WHERE composition_id IS NOT NULL)
          RETURNING id
        `);
        results.removed_compositions += orphanedCompositions.rowCount;
        totalRemoved += orphanedCompositions.rowCount;

        // 2. Clean up empty groups (now that compositions are gone)
        const emptyGroups = await client.query(`
          DELETE FROM groups 
          WHERE id NOT IN (SELECT group_id FROM compositions WHERE group_id IS NOT NULL)
          RETURNING id, display_title
        `);
        results.removed_groups += emptyGroups.rowCount;
        totalRemoved += emptyGroups.rowCount;

        // 3. Clean up unused titles (now that compositions are gone)
        const unusedTitles = await client.query(`
          DELETE FROM titles 
          WHERE id NOT IN (SELECT title_id FROM compositions WHERE title_id IS NOT NULL)
          RETURNING id, text
        `);
        results.removed_titles += unusedTitles.rowCount;
        totalRemoved += unusedTitles.rowCount;

        // 4. Clean up orphaned clef combinations (these don't create dependencies)
        if (iteration === 1) { // Only run once
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
            results.removed_clef_combinations += orphanedClefCombos.rowCount;
          } catch (error) {
            console.log('Clef combinations cleanup skipped (table may not exist):', error.message);
            results.removed_clef_combinations = 0;
          }
        }
      } else if (cleanup_type === 'titles') {
        const unusedTitles = await client.query(`
          DELETE FROM titles 
          WHERE id NOT IN (SELECT title_id FROM compositions WHERE title_id IS NOT NULL)
          RETURNING id, text
        `);
        results.removed_titles += unusedTitles.rowCount;
        totalRemoved += unusedTitles.rowCount;
      } else if (cleanup_type === 'groups') {
        const emptyGroups = await client.query(`
          DELETE FROM groups 
          WHERE id NOT IN (SELECT group_id FROM compositions WHERE group_id IS NOT NULL)
          RETURNING id, display_title
        `);
        results.removed_groups += emptyGroups.rowCount;
        totalRemoved += emptyGroups.rowCount;
      } else if (cleanup_type === 'compositions') {
        const orphanedCompositions = await client.query(`
          DELETE FROM compositions 
          WHERE id NOT IN (SELECT composition_id FROM inclusions WHERE composition_id IS NOT NULL)
          RETURNING id
        `);
        results.removed_compositions += orphanedCompositions.rowCount;
        totalRemoved += orphanedCompositions.rowCount;
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
          results.removed_clef_combinations += orphanedClefCombos.rowCount;
          totalRemoved += orphanedClefCombos.rowCount;
        } catch (error) {
          console.log('Clef combinations cleanup skipped (table may not exist):', error.message);
          results.removed_clef_combinations = 0;
        }
      }
      
    } while (totalRemoved > 0 && iteration < maxIterations);
    
    results.iterations = iteration;
    await client.query('COMMIT');
    return results;
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    throw error;
  } finally {
    if (client && !externalClient) client.release();
  }
}

/**
 * Safely triggers cleanup after a successful operation
 * @param {boolean} async - If true, runs cleanup asynchronously without blocking
 * @param {string} cleanup_type - Type of cleanup to run
 * @param {string} context - Context for logging (e.g., "after title merge")
 * @param {number} delay - Delay in milliseconds before running cleanup (default: 2000ms)
 */
export async function triggerCleanup(async = true, cleanup_type = 'all', context = '', delay = 2000) {
  const executeCleanup = async () => {
    try {
      const results = await runDatabaseCleanup(pool, cleanup_type);
      const totalRemoved = results.removed_titles + results.removed_groups + 
                          results.removed_compositions + results.removed_clef_combinations;
      
      if (totalRemoved > 0) {
        console.log(`✓ Cleanup ${context}: removed ${totalRemoved} orphaned items in ${results.iterations} iterations`);
        console.log(`  - Titles: ${results.removed_titles}, Groups: ${results.removed_groups}, Compositions: ${results.removed_compositions}, Clef combinations: ${results.removed_clef_combinations}`);
      } else {
        console.log(`✓ Cleanup ${context}: no orphaned items found`);
      }
      return results;
    } catch (error) {
      console.error(`✗ Cleanup error ${context}:`, error.message);
      // Don't throw - cleanup failures shouldn't break main operations
      return null;
    }
  };

  if (async) {
    // Run asynchronously with delay to ensure all concurrent operations complete
    setTimeout(executeCleanup, delay);
    return Promise.resolve();
  } else {
    // Run synchronously
    return executeCleanup();
  }
} 