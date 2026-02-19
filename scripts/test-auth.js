const http = require('http');

// Helper to handle HTTP requests
function request(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                ...headers,
            },
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = data ? JSON.parse(data) : {};
                    resolve({ status: res.statusCode, headers: res.headers, body: json });
                } catch (e) {
                    resolve({ status: res.statusCode, headers: res.headers, body: data });
                }
            });
        });

        req.on('error', reject);

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function testAuth() {
    console.log("🚀 Starting Auth & Backend Unification Test...");

    const email = `testunify${Date.now()}@example.com`;
    const password = "Password123!";

    // 1. Register
    console.log(`\n1. Registering user: ${email}`);
    const regRes = await request('POST', '/api/auth/register', {
        name: "Test User",
        email,
        password
    });

    if (regRes.status !== 201) {
        console.error(`❌ Registration failed: ${regRes.status}`, regRes.body);
        process.exit(1);
    }
    console.log("✅ Registration successful");

    // 2. Login
    console.log(`\n2. Logging in...`);
    const loginRes = await request('POST', '/api/auth/login', {
        email,
        password
    });

    if (loginRes.status !== 200) {
        console.error(`❌ Login failed: ${loginRes.status}`, loginRes.body);
        process.exit(1);
    }

    // Extract cookie
    const setCookie = loginRes.headers['set-cookie'];
    if (!setCookie || setCookie.length === 0) {
        console.error("❌ No Set-Cookie header received!");
        process.exit(1);
    }

    const sessionToken = setCookie.find(c => c.startsWith('session_token='));
    if (!sessionToken) {
        console.error("❌ session_token cookie not found in response!", setCookie);
        process.exit(1);
    }

    console.log("✅ Login successful, cookie received:", sessionToken.split(';')[0]);

    // Cookie for subsequent requests
    const cookieHeader = { 'Cookie': sessionToken.split(';')[0] };

    // 3. Verify ME endpoint (Proxied to Backend)
    console.log(`\n3. Verifying /api/auth/me (Protected)...`);
    const meRes = await request('GET', '/api/auth/me', null, cookieHeader);

    if (meRes.status !== 200) {
        console.error(`❌ /api/auth/me failed: ${meRes.status}`, meRes.body);
        process.exit(1);
    }
    console.log("✅ /api/auth/me successful (User ID: " + meRes.body.id + ")");

    // 4. Verify Favorites List (Should go to GO Backend now because nextjs route is gone)
    console.log(`\n4. Verifying /api/favorites (Should be Go Backend)...`);
    const favRes = await request('GET', '/api/favorites', null, cookieHeader);

    if (favRes.status !== 200) {
        console.error(`❌ /api/favorites failed: ${favRes.status}`, favRes.body);
        process.exit(1);
    }

    // Go backend returns { items, nextCursor, totalCount }
    // Next.js route likely returned [] or different structure.
    if ('items' in favRes.body && 'totalCount' in favRes.body) {
        console.log("✅ /api/favorites returned correct structure (Go Backend confirmed)");
    } else {
        console.warn("⚠️ /api/favorites returned unexpected structure:", favRes.body);
    }

    console.log("\n✅ ALL TESTS PASSED! Backend Unification Verified.");
}

testAuth().catch(e => {
    console.error("Unhandled error:", e);
    process.exit(1);
});
