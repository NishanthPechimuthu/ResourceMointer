const passport = require('passport');

exports.renderLogin = (req, res) => {
    if (req.isAuthenticated()) {
        return res.redirect('/dashboard');
    }
    // Check for error messages passed via query string (simple flash alternative)
    const errorMsg = req.query.error ? 'Invalid username or password.' : null;
    res.render('auth/login', { title: 'Login - NP Server Dashboard', error: errorMsg });
};

exports.loginSubmit = passport.authenticate('local', {
    successRedirect: '/dashboard',
    failureRedirect: '/auth/login?error=1',
});

exports.logout = (req, res, next) => {
    req.logout((err) => {
        if (err) { return next(err); }
        res.redirect('/auth/login');
    });
};
