const fs = require('fs');

// Configuration
const BASE_URL = 'http://localhost:3000';
const TIMESTAMP = Date.now();
const USER_EMAIL = `admin_test_${TIMESTAMP}@example.com`;
const PASSWORD = 'Password123!';

async function testAdminfeatures() {
    console.log(`🚀 Starting Admin Features Test with ${USER_EMAIL}...`);

    const cookieJar = new Map();

    async function request(method, url, body = null) {
        const headers = { 'Content-Type': 'application/json' };
        if (cookieJar.size > 0) {
            headers['Cookie'] = Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
        }

        const opts = { method, headers };
        if (body) opts.body = JSON.stringify(body);

        const res = await fetch(`${BASE_URL}${url}`, opts);

        // Update cookies
        const setCookie = res.headers.get('set-cookie');
        if (setCookie) {
            setCookie.split(',').forEach(c => {
                const [pair] = c.split(';');
                const [k, v] = pair.split('=');
                if (k && v) cookieJar.set(k.trim(), v.trim());
            });
        }
        return res;
    }

    // 1. Register
    console.log('\n1. Registering...');
    const regRes = await request('POST', '/api/auth/register', { email: USER_EMAIL, password: PASSWORD, name: 'Admin Tester' });
    if (!regRes.ok) {
        console.error('❌ Registration failed:', await regRes.text());
        return;
    }
    console.log('✅ Registration successful');

    // 2. Login
    console.log('\n2. Logging in...');
    const loginRes = await request('POST', '/api/auth/login', { email: USER_EMAIL, password: PASSWORD });
    if (!loginRes.ok) {
        console.error('❌ Login failed:', await loginRes.text());
        return;
    }
    console.log('✅ Login successful');

    // 3. Fetch Settings (Admin only)
    console.log('\n3. Fetching Admin Settings...');
    const settingsRes = await request('GET', '/api/admin/settings');

    if (settingsRes.status === 403 || settingsRes.status === 401) {
        console.log('✅ Admin endpoint protected (403/401) - Expected for non-admin user');
    } else if (settingsRes.ok) {
        const settings = await settingsRes.json();
        console.log(`⚠️ User accessed settings! Items: ${settings.length}`);
    } else {
        console.error('❌ Unexpected error fetching settings:', settingsRes.status, await settingsRes.text());
    }

    // 4. Test Video URL generation (Indirectly check content endpoints)
    // We can't check without content ID.

    console.log('\n✅ Test script finished.');
}

testAdminfeatures();
