const db = require('../config/db');

class UserModel {
    static async findByUsername(username) {
        const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        return result.rows[0];
    }

    static async findById(id) {
        const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
        return result.rows[0];
    }

    static async updateTotpSecret(id, secret) {
        await db.query('UPDATE users SET totp_secret = $1 WHERE id = $2', [secret, id]);
    }
}

module.exports = UserModel;
