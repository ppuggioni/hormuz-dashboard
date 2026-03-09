import { NextResponse } from "next/server";
import { publicBaseUrl, unsubscribeByToken } from "@/lib/alerts";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  if (!token) return new NextResponse("Missing token", { status: 400 });

  try {
    const sub = await unsubscribeByToken(token);
    if (!sub) return new NextResponse("Invalid token", { status: 404 });
    const home = publicBaseUrl() || "/";
    return NextResponse.redirect(`${home}?alerts=unsubscribed`);
  } catch (e: any) {
    return new NextResponse(`Error: ${e?.message || "unexpected"}`, { status: 500 });
  }
}
