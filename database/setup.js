const { pool } = require('../config/db');
const bcrypt = require('bcrypt');

async function setupDatabase() {
    console.log('Connecting to database...');
    const client = await pool.connect();
    
    try {
        console.log('Creating "session" table (for connect-pg-simple)...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS "session" (
                "sid" varchar NOT NULL COLLATE "default",
                "sess" json NOT NULL,
                "expire" timestamp(6) NOT NULL,
                CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
            )
            WITH (OIDS=FALSE);
        `);
        // We also need an index on expire for performance of deleting expired sessions
        await client.query(`
            CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
        `);

        console.log('Creating "users" table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                totp_secret VARCHAR(255),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('Checking for default admin user...');
        const adminEmail = 'admin@nishanth.qzz.io';
        const res = await client.query('SELECT * FROM users WHERE username = $1', [adminEmail]);

        if (res.rows.length === 0) {
            console.log('Admin user not found. Creating admin user...');
            const saltRounds = 10;
            const plainPassword = 'NanoTechno28@';
            const hash = await bcrypt.hash(plainPassword, saltRounds);

            await client.query(
                'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
                [adminEmail, hash]
            );
            console.log(`Admin user '${adminEmail}' created successfully.`);
        } else {
            console.log(`Admin user '${adminEmail}' already exists. Skipping creation.`);
        }

        console.log('Database setup complete.');

    } catch (err) {
        console.error('Error during database setup:', err);
    } finally {
        client.release();
        pool.end(); // close pool completely since this is a one-off script
    }
}

setupDatabase();
