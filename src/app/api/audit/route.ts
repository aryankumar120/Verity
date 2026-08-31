import { NextResponse } from "next/server";
import { listAudit } from "@/lib/db";
export async function GET() { return NextResponse.json(listAudit()); }
