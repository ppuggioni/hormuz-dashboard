import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildProcessedData } from "@/lib/buildProcessed";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  try {
    const cronHeader = req.headers.get("x-vercel-cron");
    const auth = req.headers.get("authorization");
    const secret = process.env.CRON_SECRET;

    if (!cronHeader && secret && auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const indexUrl =
      process.env.HORMUZ_INDEX_URL ||
      "https://hzxiwdylvefcsuaafnhj.supabase.co/storage/v1/object/public/x-scrapes-public/hormuz/index.json";

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
    }

    const data = await buildProcessedData(indexUrl);

    const supabase = createClient(supabaseUrl, serviceKey);
    const payload = JSON.stringify(data);

    const { error } = await supabase.storage
      .from("x-scrapes-public")
      .upload("hormuz/processed.json", payload, {
        upsert: true,
        contentType: "application/json",
      });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      generatedAt: data.metadata.generatedAt,
      fileCount: data.metadata.fileCount,
      crossingShipCount: data.metadata.crossingShipCount,
      processedUrl:
        "https://hzxiwdylvefcsuaafnhj.supabase.co/storage/v1/object/public/x-scrapes-public/hormuz/processed.json",
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Unknown error" }, { status: 500 });
  }
}
