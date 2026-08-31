import { NextResponse } from "next/server";
import { listLoans } from "@/lib/db";
export async function GET(request: Request) { const url = new URL(request.url); const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500); return NextResponse.json(listLoans(limit)); }
