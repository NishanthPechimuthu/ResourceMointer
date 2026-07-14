require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const passport = require('passport');

const { pool } = require('./config/db');

const app = express();

// Security Middleware
app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc:    ["'self'"],
            scriptSrc:     [
                "'self'",
                "'unsafe-inline'",           // for EJS inline scripts if any
                "https://cdn.jsdelivr.net",
                "https://static.cloudflareinsights.com"  // Cloudflare Web Analytics
            ],
            // FIX: explicitly allow 'unsafe-inline' on attributes (onclick handlers)
            // Best practice is 'none' + event delegation, but this unblocks immediately
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc:      ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc:       ["'self'", "https://fonts.gstatic.com"],
            imgSrc:        ["'self'", "data:", "https://static.cloudflareinsights.com"],
            connectSrc:    [
                "'self'",
                "https://cloudflareinsights.com"         // Cloudflare beacon POST target
            ],
        },
    },
}));

// Body parsing Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Setup
app.use(session({
    store: new pgSession({
        pool: pool,
        tableName: 'session'
    }),
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'strict'
    }
}));

// Passport Setup
require('./config/passport')(passport);
app.use(passport.initialize());
app.use(passport.session());

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// View Engine Setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Routes
const authRoutes = require('./routes/auth');
app.use('/auth', authRoutes);

const dashboardRoutes = require('./routes/dashboard');
app.use('/dashboard', dashboardRoutes);

const securityApiRoutes = require('./routes/securityApi');
app.use('/api/security', securityApiRoutes);

// Root Route Redirects to Dashboard or Login
app.get('/', (req, res) => {
    if (req.isAuthenticated()) {
        res.redirect('/dashboard');
    } else {
        res.redirect('/auth/login');
    }
});

// Error Handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

module.exports = app;
