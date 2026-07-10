const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const UserModel = require('../models/userModel');

module.exports = function(passport) {
    passport.use(new LocalStrategy(
        { usernameField: 'username' },
        async (username, password, done) => {
            try {
                const user = await UserModel.findByUsername(username);
                if (!user) {
                    return done(null, false, { message: 'Incorrect username.' });
                }

                const match = await bcrypt.compare(password, user.password_hash);
                if (match) {
                    return done(null, user);
                } else {
                    return done(null, false, { message: 'Incorrect password.' });
                }
            } catch (err) {
                return done(err);
            }
        }
    ));

    passport.serializeUser((user, done) => {
        done(null, user.id);
    });

    passport.deserializeUser(async (id, done) => {
        try {
            const user = await UserModel.findById(id);
            done(null, user);
        } catch (err) {
            done(err);
        }
    });
};
