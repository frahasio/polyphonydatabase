const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/polyphony',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function checkAuditLogSystem() {
  console.log('🔍 Checking Audit Log System...\n');
  
  try {
    // Check if audit_log table exists
    console.log('1. Checking if audit_log table exists...');
    const auditTableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'audit_log'
      );
    `);
    
    const auditTableExists = auditTableCheck.rows[0].exists;
    console.log(`   ✅ audit_log table: ${auditTableExists ? 'EXISTS' : 'MISSING'}`);
    
    if (!auditTableExists) {
      console.log('   ❌ ISSUE: audit_log table does not exist');
      console.log('   💡 FIX: Run the audit-log-migration.sql script');
      return;
    }
    
    // Check if log_audit_entry function exists
    console.log('\n2. Checking if log_audit_entry function exists...');
    const functionCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.routines 
        WHERE routine_name = 'log_audit_entry'
      );
    `);
    
    const functionExists = functionCheck.rows[0].exists;
    console.log(`   ✅ log_audit_entry function: ${functionExists ? 'EXISTS' : 'MISSING'}`);
    
    if (!functionExists) {
      console.log('   ❌ ISSUE: log_audit_entry function does not exist');
      console.log('   💡 FIX: Run the audit-log-migration.sql script');
      return;
    }
    
    // Check if ignored_alerts table exists
    console.log('\n3. Checking if ignored_alerts table exists...');
    const ignoredTableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'ignored_alerts'
      );
    `);
    
    const ignoredTableExists = ignoredTableCheck.rows[0].exists;
    console.log(`   ✅ ignored_alerts table: ${ignoredTableExists ? 'EXISTS' : 'MISSING'}`);
    
    if (!ignoredTableExists) {
      console.log('   ❌ ISSUE: ignored_alerts table does not exist');
      console.log('   💡 FIX: Run the audit-log-migration.sql script');
    }
    
    // Check if users table has required columns
    console.log('\n4. Checking users table columns...');
    const usersColumnsCheck = await pool.query(`
      SELECT column_name
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND column_name IN ('email', 'is_admin')
    `);
    
    const userColumns = usersColumnsCheck.rows.map(row => row.column_name);
    const hasEmail = userColumns.includes('email');
    const hasIsAdmin = userColumns.includes('is_admin');
    
    console.log(`   ✅ users.email column: ${hasEmail ? 'EXISTS' : 'MISSING'}`);
    console.log(`   ✅ users.is_admin column: ${hasIsAdmin ? 'EXISTS' : 'MISSING'}`);
    
    if (!hasEmail || !hasIsAdmin) {
      console.log('   ❌ ISSUE: users table missing required columns for audit system');
      console.log('   💡 FIX: Run the audit-log-migration.sql script');
    }
    
    // Test the audit function
    console.log('\n5. Testing audit function...');
    try {
      const testResult = await pool.query(`
        SELECT log_audit_entry(
          1, 
          'test@example.com', 
          'TEST', 
          'test_table', 
          999, 
          '{"old": "value"}', 
          '{"new": "value"}'
        ) as audit_id
      `);
      
      const auditId = testResult.rows[0].audit_id;
      console.log(`   ✅ Test audit entry created with ID: ${auditId}`);
      
      // Clean up test entry
      await pool.query('DELETE FROM audit_log WHERE id = $1', [auditId]);
      console.log('   ✅ Test entry cleaned up');
      
    } catch (error) {
      console.log('   ❌ ISSUE: Error testing audit function:', error.message);
      return;
    }
    
    // Check recent audit entries
    console.log('\n6. Checking recent audit entries...');
    const recentEntries = await pool.query(`
      SELECT COUNT(*) as count, MAX(created_at) as latest_entry
      FROM audit_log
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `);
    
    const recentCount = recentEntries.rows[0].count;
    const latestEntry = recentEntries.rows[0].latest_entry;
    
    console.log(`   📊 Recent audit entries (last 7 days): ${recentCount}`);
    console.log(`   📅 Latest entry: ${latestEntry || 'None'}`);
    
    if (recentCount === 0) {
      console.log('   ⚠️  WARNING: No recent audit entries found');
      console.log('   💡 This might indicate that audit logging is not working in the application');
      console.log('   🔧 Check that your application code is calling the audit functions');
    }
    
    console.log('\n✅ Audit log system check complete!');
    
    if (auditTableExists && functionExists && ignoredTableExists && hasEmail && hasIsAdmin) {
      console.log('🎉 All components are properly set up');
      if (recentCount === 0) {
        console.log('⚠️  However, no recent audit entries suggest application-level issues');
      }
    } else {
      console.log('❌ Some components are missing - run audit-log-migration.sql');
    }
    
  } catch (error) {
    console.error('❌ Error checking audit log system:', error.message);
  } finally {
    await pool.end();
  }
}

// Run the check
checkAuditLogSystem(); 