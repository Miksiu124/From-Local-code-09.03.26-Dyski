const http = require('http');

function checkUrl(url, name, expectedCodes = [200]) {
    return new Promise((resolve) => {
        const req = http.get(url, (res) => {
            const isOk = expectedCodes.some(code =>
                (code === 200 && res.statusCode >= 200 && res.statusCode < 300) ||
                (Array.isArray(code) ? false : res.statusCode === code)
            );

            const status = isOk ? 'OK' : 'WARNING';
            const icon = isOk ? '✅' : '❌';

            console.log(`${icon} ${name}: ${res.statusCode} ${status}`);
            resolve(isOk);
        });

        req.on('error', (e) => {
            console.error(`❌ ${name}: CONNECTION ERROR - ${e.message}`);
            resolve(false);
        });

        req.end();
    });
}

async function validate() {
    console.log("🚀 Starting Health Check...");

    // Check API via Frontend Proxy (simulates real user access)
    const apiOk = await checkUrl("http://localhost:3000/api/settings/public", "API (via Frontend)");

    // Frontend Root
    const frontendOk = await checkUrl("http://localhost:3000", "Frontend Root", [200, 307, 308, 302]);

    if (apiOk && frontendOk) {
        console.log("✅ SYSTEM HEALTHY");
        process.exit(0);
    } else {
        console.error("❌ SYSTEM UNHEALTHY");
        process.exit(1);
    }
}

validate();
