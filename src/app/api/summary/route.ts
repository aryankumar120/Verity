import { NextResponse } from "next/server";
import { summary } from "@/lib/db";
export async function GET() { return NextResponse.json(summary()); }
