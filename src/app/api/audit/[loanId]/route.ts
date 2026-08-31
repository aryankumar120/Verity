import { NextResponse } from "next/server";
import { listAudit } from "@/lib/db";
export async function GET(_: Request,{params}:{params:Promise<{loanId:string}>}) { const {loanId}=await params; return NextResponse.json(listAudit(loanId)); }
