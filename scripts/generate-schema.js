const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Get database URL from environment variable
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error('Error: DATABASE_URL environment variable is not set');
    process.exit(1);
}

// Generate timestamp for the filename
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputFile = path.join(__dirname, `../schemas/schema-${timestamp}.json`);

// Ensure schemas directory exists
if (!fs.existsSync(path.join(__dirname, '../schemas'))) {
    fs.mkdirSync(path.join(__dirname, '../schemas'));
}

async function generateSchema() {
    const client = new Client({
        connectionString: DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        await client.connect();
        
        // Get all tables
        const tablesResult = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);

        const schema = {};
        
        // For each table, get its columns
        for (const table of tablesResult.rows) {
            const columnsResult = await client.query(`
                SELECT 
                    column_name as column,
                    data_type as type,
                    character_maximum_length as "maxLength",
                    column_default as default,
                    is_nullable as nullable
                FROM information_schema.columns 
                WHERE table_name = $1
                ORDER BY ordinal_position
            `, [table.table_name]);

            schema[table.table_name] = columnsResult.rows;
        }

        // Write to file
        fs.writeFileSync(outputFile, JSON.stringify(schema, null, 2));
        console.log(`Schema saved to: ${outputFile}`);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

generateSchema(); 