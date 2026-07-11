const app = require('./app');
const port = process.env.PORT || 3000;
const securityEngine = require('./engine/securityEngine');

app.listen(port, () => {
    console.log(`NP Server Dashboard listening at http://localhost:${port}`);
    console.log(`Environment: ${process.env.NODE_ENV}`);
});

securityEngine.start();
