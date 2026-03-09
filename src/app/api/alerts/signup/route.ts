import { NextResponse } from "next/server";
import { normalizeEmail, publicBaseUrl, sendEmail, upsertPendingSubscriber } from "@/lib/alerts";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const emailRaw = String(body?.email || "");
    const email = normalizeEmail(emailRaw);
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
    }

    const sub = await upsertPendingSubscriber(email);
    if (!sub) return NextResponse.json({ ok: false, error: "save_failed" }, { status: 500 });

    if (sub.status === "active") {
      return NextResponse.json({ ok: true, message: "already_active" });
    }

    const base = publicBaseUrl();
    const confirmUrl = `${base}/api/alerts/confirm?token=${sub.confirm_token}`;
    const unsubUrl = `${base}/api/alerts/unsubscribe?token=${sub.unsubscribe_token}`;

    await sendEmail(
      sub.email,
      "Confirm your tanker crossing alerts subscription",
      `<p>Click to confirm alerts subscription:</p><p><a href="${confirmUrl}">${confirmUrl}</a></p><p>If this wasn't you, ignore this email.</p><p>Unsubscribe: <a href="${unsubUrl}">${unsubUrl}</a></p>`,
    );

    return NextResponse.json({ ok: true, message: "confirmation_sent" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "unexpected_error" }, { status: 500 });
  }
}
