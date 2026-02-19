
import { db } from "@/lib/db";

async function main() {
    const users = await db.user.findMany({
        select: {
            email: true,
            role: true,
            name: true,
        },
    });

    console.log("Users in database:");
    users.forEach((user) => {
        console.log(`- ${user.email} (${user.name}): ${user.role}`);
    });
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        // await db.$disconnect();
    });
