// Supabase Edge Function: link-preview
// Holt zu einem Link (z. B. Pinterest-Pin) Titel und Vorschaubild,
// lädt das Bild in den privaten Bucket "bilder" und gibt den Pfad zurück.
// Deploy: supabase functions deploy link-preview

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UA =
  "Mozilla/5.0 (compatible; Hochzeitsplaner/1.0; +https://github.com) facebookexternalhit/1.1";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function meta(html: string, keys: string[]): string | null {
  for (const k of keys) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']+)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${k}["']`, "i");
    const m = html.match(re1) || html.match(re2);
    if (m) return decode(m[1]);
  }
  return null;
}

function decode(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? req.headers.get("apikey") ?? "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";

    // Nur Mitglieder dürfen die Funktion nutzen
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: isMember } = await userClient.rpc("is_member");
    if (!isMember) return json({ error: "Kein Zugriff" }, 403);

    const { url: link } = await req.json();
    if (!link || !/^https?:\/\//i.test(link)) return json({ error: "Ungültiger Link" }, 400);

    let title: string | null = null;
    let image: string | null = null;
    let finalUrl = link;

    // 1) Pinterest oEmbed versuchen (liefert zuverlässig ein Bild)
    if (/pinterest\.|pin\.it/i.test(link)) {
      try {
        // Kurzlinks (pin.it) auflösen
        const r = await fetch(link, { redirect: "follow", headers: { "User-Agent": UA } });
        finalUrl = r.url || link;
        const html = await r.text();
        image = meta(html, ["og:image", "twitter:image", "twitter:image:src"]);
        title = meta(html, ["og:title", "twitter:title", "og:description"]);
        if (!image) {
          const o = await fetch(
            `https://www.pinterest.com/oembed.json?url=${encodeURIComponent(finalUrl)}`,
            { headers: { "User-Agent": UA } },
          );
          if (o.ok) {
            const oj = await o.json();
            image = oj.thumbnail_url ?? null;
            title = title ?? oj.title ?? null;
          }
        }
      } catch (_) { /* weiter mit Fallback */ }
    }

    // 2) Allgemeiner Fallback: Open-Graph-Tags der Seite
    if (!image) {
      const r = await fetch(link, { redirect: "follow", headers: { "User-Agent": UA } });
      finalUrl = r.url || link;
      const ct = r.headers.get("content-type") ?? "";
      if (ct.startsWith("image/")) {
        image = finalUrl;
      } else {
        const html = await r.text();
        image = meta(html, ["og:image", "og:image:url", "twitter:image", "twitter:image:src"]);
        title = title ?? meta(html, ["og:title", "twitter:title"]) ??
          (html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? null);
      }
    }

    if (!image) return json({ title, image_path: null, source_url: finalUrl });

    // Pinterest: größere Variante nehmen, falls verfügbar
    image = new URL(image, finalUrl).toString().replace(/\/(236x|474x|564x)\//, "/736x/");

    // 3) Bild herunterladen und in den Bucket legen (damit es nicht verschwindet)
    const imgRes = await fetch(image, { headers: { "User-Agent": UA, Referer: finalUrl } });
    if (!imgRes.ok) return json({ title, image_path: null, source_url: finalUrl });
    const type = imgRes.headers.get("content-type") ?? "image/jpeg";
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : type.includes("gif") ? "gif" : "jpg";
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    if (bytes.byteLength > 8 * 1024 * 1024) return json({ error: "Bild zu groß" }, 413);

    const admin = createClient(url, service);
    const path = `ideen/${crypto.randomUUID()}.${ext}`;
    const { error } = await admin.storage.from("bilder").upload(path, bytes, { contentType: type });
    if (error) return json({ error: error.message }, 500);

    return json({ title: title ? title.slice(0, 200) : null, image_path: path, source_url: finalUrl });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
