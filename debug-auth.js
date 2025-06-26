import bcrypt from 'bcrypt';
import { pool } from './src/db.js';

async function debugAuthenticationSetup() {
    console.log('🔍 Debugging Authentication Setup...\n');

    try {
        // Check if users table exists
        console.log('1. Checking if users table exists...');
        const tableExists = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'users'
            );
        `);
        
        if (!tableExists.rows[0].exists) {
            console.log('❌ Users table does not exist!');
            console.log('   You need to run the migration script.');
            return;
        }
        console.log('✅ Users table exists');

        // Check table structure
        console.log('\n2. Checking users table structure...');
        const columns = await pool.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'users' 
            ORDER BY ordinal_position;
        `);
        
        console.log('   Table columns:');
        columns.rows.forEach(col => {
            console.log(`   - ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
        });

        // Check if any users exist
        console.log('\n3. Checking existing users...');
        const users = await pool.query('SELECT id, email, name, status, role, created_at FROM users ORDER BY created_at');
        
        if (users.rows.length === 0) {
            console.log('❌ No users found in database!');
            console.log('   The migration may not have run completely.');
        } else {
            console.log(`✅ Found ${users.rows.length} user(s):`);
            users.rows.forEach(user => {
                console.log(`   - ${user.email} (${user.name}) - Status: ${user.status}, Role: ${user.role}`);
            });
        }

        // Check specifically for admin user
        console.log('\n4. Checking for default admin user...');
        const adminUser = await pool.query('SELECT * FROM users WHERE email = $1', ['admin@polyphony.local']);
        
        if (adminUser.rows.length === 0) {
            console.log('❌ Default admin user not found!');
            console.log('\n🔧 Creating admin user now...');
            await createAdminUser();
        } else {
            console.log('✅ Default admin user found');
            const admin = adminUser.rows[0];
            console.log(`   Email: ${admin.email}`);
            console.log(`   Name: ${admin.name}`);
            console.log(`   Status: ${admin.status}`);
            console.log(`   Role: ${admin.role}`);
            
            // Test password hash
            console.log('\n5. Testing password hash...');
            const testPassword = 'tempPassword123!';
            const passwordMatch = await bcrypt.compare(testPassword, admin.password_hash);
            
            if (passwordMatch) {
                console.log('✅ Password hash is correct');
                console.log(`   You should be able to login with: admin@polyphony.local / ${testPassword}`);
            } else {
                console.log('❌ Password hash does not match!');
                console.log('   Recreating admin user with correct password...');
                await recreateAdminUser();
            }
        }

        console.log('\n✅ Debug complete!');

    } catch (error) {
        console.error('❌ Error during debug:', error);
    } finally {
        await pool.end();
    }
}

async function createAdminUser() {
    try {
        const password = 'tempPassword123!';
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        const result = await pool.query(`
            INSERT INTO users (email, password_hash, name, status, role) 
            VALUES ($1, $2, $3, $4, $5) 
            RETURNING id, email, name, status, role
        `, ['admin@polyphony.local', passwordHash, 'System Administrator', 'approved', 'admin']);

        const newAdmin = result.rows[0];
        console.log('✅ Admin user created successfully:');
        console.log(`   Email: ${newAdmin.email}`);
        console.log(`   Password: ${password}`);
        console.log(`   Status: ${newAdmin.status}`);
        console.log(`   Role: ${newAdmin.role}`);
    } catch (error) {
        console.error('❌ Error creating admin user:', error);
    }
}

async function recreateAdminUser() {
    try {
        // Delete existing admin user
        await pool.query('DELETE FROM users WHERE email = $1', ['admin@polyphony.local']);
        console.log('   Deleted existing admin user');
        
        // Create new one
        await createAdminUser();
    } catch (error) {
        console.error('❌ Error recreating admin user:', error);
    }
}

// Run the debug script
debugAuthenticationSetup(); 