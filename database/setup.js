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

        console.log('Creating "attackers" table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS attackers (
                ip VARCHAR(45) PRIMARY KEY,
                total_score INTEGER DEFAULT 0,
                offense_count INTEGER DEFAULT 0,
                first_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_attackers_total_score ON attackers (total_score DESC);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_attackers_last_seen   ON attackers (last_seen DESC);`);

        console.log('Creating "requests" table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS requests (
                id SERIAL PRIMARY KEY,
                ip VARCHAR(45) NOT NULL,
                method VARCHAR(10),
                url TEXT,
                user_agent TEXT,
                payload TEXT,
                score INTEGER DEFAULT 0,
                timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // Performance indexes for ban-policy evaluation queries
        await client.query(`CREATE INDEX IF NOT EXISTS idx_requests_ip_timestamp ON requests (ip, timestamp DESC);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_requests_timestamp    ON requests (timestamp DESC);`);

        console.log('Creating "bans" table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS bans (
                id SERIAL PRIMARY KEY,
                ip VARCHAR(45) NOT NULL,
                reason TEXT,
                ban_type VARCHAR(50),
                expires_at TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // FIX: Add unique constraint on ip so ON CONFLICT works and duplicates are prevented
        await client.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'bans_ip_unique' AND conrelid = 'bans'::regclass
                ) THEN
                    ALTER TABLE bans ADD CONSTRAINT bans_ip_unique UNIQUE (ip);
                END IF;
            END
            $$;
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_bans_ip          ON bans (ip);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_bans_expires_at  ON bans (expires_at);`);

        console.log('Creating "whitelist" table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS whitelist (
                ip VARCHAR(45) PRIMARY KEY,
                description TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('Creating "blacklist" table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS blacklist (
                ip VARCHAR(45) PRIMARY KEY,
                reason TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('✅ Database setup complete.');

    } catch (err) {
        console.error('Error during database setup:', err);
    } finally {
        client.release();
        pool.end();
    }
}

setupDatabase();
