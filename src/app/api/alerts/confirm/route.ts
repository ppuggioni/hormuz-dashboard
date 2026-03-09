import { NextResponse } from "next/server";
import { activateByConfirmToken, publicBaseUrl } from "@/lib/alerts";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  if (!token) return new NextResponse("Missing token", { status: 400 });

  try {
    const sub = await activateByConfirmToken(token);
    if (!sub) return new NextResponse("Invalid or expired token", { status: 404 });
    const home = publicBaseUrl() || "/";
    return NextResponse.redirect(`${home}?alerts=confirmed`);
  } catch (e: any) {
    return new NextResponse(`Error: ${e?.message || "unexpected"}`, { status: 500 });
  }
}
