const passport = require('passport');
const { generateSecret, generateURI, verifySync } = require('otplib');
const qrcode = require('qrcode');
const UserModel = require('../models/userModel');

exports.renderLogin = (req, res) => {
    if (req.isAuthenticated()) {
        return res.redirect('/dashboard');
    }
    const errorMsg = req.query.error ? 'Invalid email or password.' : null;
    res.render('auth/login', { title: 'Login - NP Server Dashboard', error: errorMsg });
};

// Step 1: Verify Password
exports.loginSubmit = (req, res, next) => {
    passport.authenticate('local', (err, user, info) => {
        if (err) return next(err);
        if (!user) {
            return res.redirect('/auth/login?error=1');
        }
        
        // Don't fully log them in yet, just store pending state in session
        req.session.pendingUserId = user.id;
        res.redirect('/auth/totp');
    })(req, res, next);
};

// Step 2: Render TOTP view
exports.renderTotp = async (req, res) => {
    if (!req.session.pendingUserId) {
        return res.redirect('/auth/login');
    }

    try {
        const user = await UserModel.findById(req.session.pendingUserId);
        
        // Setup Mode
        if (!user.totp_secret) {
            const secret = generateSecret();
            req.session.tempTotpSecret = secret; // temporarily hold it in session until verified
            const otpauth = generateURI({ accountName: user.username, issuer: 'NP Server Dashboard', secret });
            const qrImage = await qrcode.toDataURL(otpauth);
            
            return res.render('auth/totp-setup', { 
                title: 'Setup 2FA - NP Server Dashboard', 
                qrImage, 
                secret,
                error: req.query.error ? 'Invalid code. Please try again.' : null
            });
        }
        
        // Verify Mode
        res.render('auth/totp-verify', { 
            title: 'Verify 2FA - NP Server Dashboard',
            error: req.query.error ? 'Invalid code. Please try again.' : null
        });

    } catch (err) {
        console.error(err);
        res.redirect('/auth/login');
    }
};

// Step 3: Verify TOTP Code and Complete Login
exports.totpSubmit = async (req, res, next) => {
    if (!req.session.pendingUserId) {
        return res.redirect('/auth/login');
    }

    const token = req.body.token;
    
    try {
        const user = await UserModel.findById(req.session.pendingUserId);
        let isValid = false;

        if (!user.totp_secret) {
            // Setup Mode Verification
            const verifyRes = verifySync({ token, secret: req.session.tempTotpSecret });
            isValid = verifyRes.valid;
            if (isValid) {
                await UserModel.updateTotpSecret(user.id, req.session.tempTotpSecret);
            }
        } else {
            // Standard Verification
            const verifyRes = verifySync({ token, secret: user.totp_secret });
            isValid = verifyRes.valid;
        }

        if (isValid) {
            // Officially log the user in
            req.login(user, (err) => {
                if (err) return next(err);
                
                // Clear pending session vars
                delete req.session.pendingUserId;
                delete req.session.tempTotpSecret;
                
                return res.redirect('/dashboard');
            });
        } else {
            return res.redirect('/auth/totp?error=1');
        }

    } catch (err) {
        console.error(err);
        res.redirect('/auth/login');
    }
};

exports.logout = (req, res, next) => {
    req.logout((err) => {
        if (err) { return next(err); }
        res.redirect('/auth/login');
    });
};
