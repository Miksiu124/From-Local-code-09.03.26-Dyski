import { fetch } from 'undici';

async function validateDeployment() {
    console.log("🚀 Starting Deployment Validation...");

    const API_URL = "http://localhost:8080/api";
    const NEXT_URL = "http://localhost:3000";

    let status = {
        api: false,
        frontend: false,
        db: false,
        redis: false
    };

    try {
        const health = await fetch(`${API_URL}/health`);
        if (health.ok) {
            console.log("✅ API Health Check: OK");
            status.api = true;
        } else {
            console.error("❌ API Health Check: FAILED", await health.text());
        }
    } catch (e) {
        console.error("❌ API Health Check: CONNECTION ERROR", e.message);
    }

    try {
        const fe = await fetch(NEXT_URL);
        if (fe.ok) {
            console.log("✅ Frontend Health Check: OK");
            status.frontend = true;
        } else {
            console.error("❌ Frontend Health Check: FAILED");
        }
    } catch (e) {
        console.error("❌ Frontend Health Check: CONNECTION ERROR", e.message);
    }

    // Summary
    if (status.api && status.frontend) {
        console.log("✅ DEPLOYMENT STATUS: HEALTHY");
        process.exit(0);
    } else {
        console.error("❌ DEPLOYMENT STATUS: UNHEALTHY");
        process.exit(1);
    }
}

validateDeployment();
