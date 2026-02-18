import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { badRequest, internalError } from "@/lib/api-errors";
import { checkRateLimit } from "@/lib/rate-limit";

const registerSchema = z.object({
  name: z.string().trim().max(100).optional(),
  email: z.string().trim().email("Invalid email address").max(255),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password is too long")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
});

export async function POST(req: Request) {
  try {
    // Rate limit: 5 registration attempts per IP per 15 minutes
    const ip = req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
    const rl = await checkRateLimit(`register:${ip}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) {
      return badRequest("Too many registration attempts. Please try again later.");
    }

    const body = await req.json();
    const { name, email: rawEmail, password } = registerSchema.parse(body);
    const email = rawEmail.toLowerCase();

    // Rate limit: 5 registration attempts per email per 15 minutes
    const emailRl = await checkRateLimit(`register-email:${email}`, 5, 15 * 60 * 1000);
    if (!emailRl.allowed) {
      return badRequest("Too many registration attempts. Please try again later.");
    }

    const [existingUser, hashedPassword] = await Promise.all([
      db.user.findUnique({ where: { email }, select: { id: true } }),
      bcrypt.hash(password, 12),
    ]);

    if (existingUser) {
      // Generic message to prevent email enumeration
      return badRequest("Unable to create account. Please try a different email or log in.");
    }

    // Create user
    await db.user.create({
      data: {
        name: name || null,
        email,
        password: hashedPassword,
        role: "USER",
        creditBalance: 0,
      },
    });

    // Don't return the userId — unnecessary exposure
    return NextResponse.json(
      { message: "Account created successfully" },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return badRequest(error.issues[0].message);
    }

    return internalError("Registration error", error);
  }
}
