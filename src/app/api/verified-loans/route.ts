import { NextResponse } from "next/server";
import { listLoans } from "@/lib/db";
export async function GET() { return NextResponse.json(listLoans(500).filter(l=>l.status === "verified")); }
