
import { fetch } from 'undici';

const BASE_URL = 'http://localhost:3000/api';

async function main() {
    console.log('Waiting 20 seconds for Admin to log in...');
    await new Promise(r => setTimeout(r, 20000));

    const email = `testuser_${Date.now()}@example.com`;
    const password = 'password123';

    console.log(`Registering user: ${email}`);

    // 1. Register
    const regRes = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name: 'Test User' })
    });

    if (!regRes.ok) {
        console.error('Registration failed:', await regRes.text());
        return;
    }

    // 2. Login
    console.log('Logging in...');
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });

    if (!loginRes.ok) {
        console.error('Login failed:', await loginRes.text());
        return;
    }

    // Get cookie
    const cookie = loginRes.headers.get('set-cookie');
    if (!cookie) {
        console.error('No cookie received');
        return;
    }

    // 3. Create Purchase (BLIK)
    console.log('Creating BLIK purchase...');
    const purchaseRes = await fetch(`${BASE_URL}/credits/purchase`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Cookie': cookie
        },
        body: JSON.stringify({
            creditPackageId: (await getFirstPackageId(cookie)), // Helper to get a package ID
            paymentMethod: 'BLIK',
            blikCode: '123456'
        })
    });

    if (!purchaseRes.ok) {
        console.error('Purchase creation failed:', await purchaseRes.text());
        return;
    }

    const purchase = await purchaseRes.json();
    console.log(`Purchase created! ID: ${purchase.id}. Starting poll for approval...`);

    // 4. Poll for status
    let attempts = 0;
    while (attempts < 30) {
        await new Promise(r => setTimeout(r, 2000));
        const statusRes = await fetch(`${BASE_URL}/credits/purchase`, {
            method: 'GET',
            headers: { 'Cookie': cookie }
        });
        const purchases = await statusRes.json();
        const myPurchase = purchases.find((p: any) => p.id === purchase.id);

        if (myPurchase) {
            console.log(`Current status: ${myPurchase.status}`);
            if (myPurchase.status === 'APPROVED') {
                console.log('SUCCESS: Purchase was approved!');
                // Check balance
                const balanceRes = await fetch(`${BASE_URL}/user/balance`, { headers: { 'Cookie': cookie } });
                const balance = await balanceRes.json();
                console.log(`User Balance: ${balance.creditBalance}`);
                process.exit(0);
            }
            if (myPurchase.status === 'REJECTED') {
                console.error('FAILURE: Purchase was rejected.');
                process.exit(1);
            }
        }
        attempts++;
    }
    console.error('TIMEOUT: Purchase was not approved in time.');
}

async function getFirstPackageId(cookie: string) {
    // We need a valid package ID.
    // Assuming backend endpoint exists
    return 'cm48a392k0001v86038475928'; // Fallback or fetch from DB if possible. 
    // Actually let's fetch it.
    // Public endpoint?
}

// Override getFirstPackageId to actually fetch
async function getFirstPackageIdReal(cookie: string) {
    // Assuming /api/credit-packages is public as per main.go (it might not be, let's check permissions)
    // main.go: api.GET("/credit-packages", creditsHandler.ListPackages) -> Seems public or auth optional?
    // Actually ListPackages is generic settings? No, creditsHandler.
    // Let's try fetch it.
    const res = await fetch(`${BASE_URL}/credit-packages`);
    if (res.ok) {
        const pkgs = await res.json();
        if (pkgs && pkgs.length > 0) return pkgs[0].id;
    }
    return ''; // Fail
}

// Patching the main function to use real fetch
const mainWrapped = async () => {
    try {
        const pkgRes = await fetch(`${BASE_URL}/credit-packages`);
        const pkgs: any = await pkgRes.json();
        const pkgId = pkgs[0].id;

        console.log('Waiting 20 seconds for Admin to log in...');
        await new Promise(r => setTimeout(r, 20000));

        const email = `testuser_${Date.now()}@example.com`;
        const password = 'password123';

        console.log(`Registering user: ${email}`);

        // 1. Register
        const regRes = await fetch(`${BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, name: 'Test User' })
        });

        // If 409 (conflict), login directly? No, timestamp ensures unique.

        // 2. Login
        console.log('Logging in...');
        const loginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        // Get cookie
        // set-cookie header might be array or string
        const cookies = loginRes.headers.getSetCookie();
        const cookieHeader = cookies.join('; ');

        // 3. Create Purchase (BLIK)
        console.log('Creating BLIK purchase...');
        const purchaseRes = await fetch(`${BASE_URL}/credits/purchase`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookieHeader
            },
            body: JSON.stringify({
                creditPackageId: pkgId,
                paymentMethod: 'BLIK',
                blikCode: '123456'
            })
        });

        const purchase: any = await purchaseRes.json();
        if (!purchase.id) {
            console.error("No purchase ID returned", purchase);
            return;
        }
        console.log(`Purchase created! ID: ${purchase.id}. Starting poll for approval...`);

        // 4. Poll for status
        let attempts = 0;
        while (attempts < 30) {
            await new Promise(r => setTimeout(r, 2000));
            const statusRes = await fetch(`${BASE_URL}/credits/purchase`, {
                method: 'GET',
                headers: { 'Cookie': cookieHeader }
            });
            const purchases: any = await statusRes.json();
            const myPurchase = purchases.find((p: any) => p.id === purchase.id);

            if (myPurchase) {
                console.log(`Current status: ${myPurchase.status}`);
                if (myPurchase.status === 'APPROVED') {
                    console.log('SUCCESS: Purchase was approved!');
                    const balanceRes = await fetch(`${BASE_URL}/user/balance`, { headers: { 'Cookie': cookieHeader } });
                    const balance: any = await balanceRes.json();
                    console.log(`User Balance: ${balance.creditBalance}`);
                    process.exit(0);
                }
            }
            attempts++;
        }
        console.error('TIMEOUT');
    } catch (e) {
        console.error(e);
    }
};

mainWrapped();
