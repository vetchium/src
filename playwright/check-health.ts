async function checkUrl(url: string, name: string): Promise<boolean> {
    try {
        const response = await fetch(url);
        if (response.ok || response.status === 405 || response.status === 404) {
            console.log(`✅ ${name} is UP (${url})`);
            return true;
        } else {
            console.log(`❌ ${name} returned status ${response.status} (${url})`);
            return false;
        }
    } catch (error) {
        console.log(`❌ ${name} is DOWN (${url})`);
        return false;
    }
}

async function main() {
    console.log("Checking Vetchium Environment Health...");
    
    const services = [
        { url: "http://localhost:8080/global/get-regions", name: "API Load Balancer", method: "POST" },
        { url: "http://localhost:3000", name: "Hub UI" },
        { url: "http://localhost:3001", name: "Admin UI" },
        { url: "http://localhost:3002", name: "Org UI" },
        { url: "http://localhost:8025", name: "Mailpit" },
    ];

    let allUp = true;
    for (const service of services) {
        // Simple GET check for UIs, POST for API endpoint might need body but we just check reachability
        const up = await checkUrl(service.url, service.name);
        if (!up) allUp = false;
    }

    if (!allUp) {
        console.log("\n⚠️ Some services are not reachable. Please ensure 'docker compose -f docker-compose-full.json up' is running.");
        process.exit(1);
    } else {
        console.log("\n🚀 All services are UP and ready for testing.");
    }
}

main();
