import { NextResponse } from "next/server";
import { getLoan } from "@/lib/db";
export async function GET(_: Request,{params}:{params:Promise<{id:string}>}) { const {id}=await params; const loan=getLoan(id); if(!loan || loan.status!=="verified") return NextResponse.json({error:"Verified loan not found"},{status:404}); return NextResponse.json(loan); }
