# Hochzeitsplaner

Private Planungs-App für Johanna & Lukas und die Trauzeugen Peter und Eva.
Statische PWA auf GitHub Pages, Daten und Bilder in Supabase (kostenloser Plan).

**Funktionen:** Übersicht mit Countdown, Aufgaben (Kanban, Zuständigkeiten, Fälligkeiten, Start-Checkliste), Ideenboard (Pinterest-Link oder Bild-Upload, Likes, Kommentare), Ausgaben mit Belegfoto, Budget und Erstattungen an die Trauzeugen, Gästeliste mit Rückmeldungen und CSV-Export, Dienstleister, Tagesablauf zum Drucken.

**Login:** Name antippen, beim ersten Mal pro Gerät das gemeinsame Codewort eingeben. Kein Passwort, keine E-Mail.

**Sichtbarkeit:** Jeder Eintrag kann „Für alle“, „Nur Brautpaar“ oder „Nur Trauzeugen (geheim)“ sein. Geheime Einträge (z. B. JGA) sieht das Brautpaar nicht, das wird in der Datenbank erzwungen.

## Einrichtung (einmalig)

1. **Supabase → Authentication → Sign In / Providers:** „Allow anonymous sign-ins“ aktivieren.
2. **Supabase → SQL Editor:** Inhalt von `supabase/schema.sql` einfügen und ausführen.
3. **Codewort setzen:** im SQL Editor ausführen (Wort ersetzen, nicht ins Repo schreiben):
   ```sql
   update public.settings set access_code_hash = extensions.crypt('DEIN-CODEWORT', extensions.gen_salt('bf')) where id = 1;
   ```
   Später kann das Brautpaar das Codewort auch in der App unter Einstellungen ändern.
4. **Supabase → Edge Functions → Deploy a new function → Via Editor:** Name `link-preview`, Inhalt von `supabase/functions/link-preview/index.ts` einfügen, deployen. (Wird für Pinterest-Links gebraucht. Ohne die Funktion funktioniert alles andere, nur Links laden dann kein Vorschaubild.)
5. **GitHub → Settings → Pages:** Source „Deploy from a branch“, Branch `main`, Ordner `/ (root)`.
6. **Optional, gegen das Pausieren nach 7 Tagen Inaktivität:** GitHub → Settings → Secrets and variables → Actions → **Variables**: `SUPABASE_URL` und `SUPABASE_ANON_KEY` (der publishable Key) anlegen. Die Action `Supabase Keepalive` pingt dann zweimal pro Woche.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html`, `app.js`, `styles.css` | Die App (kein Build-Schritt) |
| `config.js` | Supabase-URL und publishable Key (darf öffentlich sein) |
| `icons.js`, `fonts/` | Phosphor Icons (MIT) und Schrift Geist (OFL), lokal eingebunden |
| `supabase/schema.sql` | Tabellen, Row Level Security, Login-Funktionen, Storage |
| `supabase/functions/link-preview` | Holt Vorschaubild zu Pinterest- und anderen Links |
| `sw.js`, `manifest.json` | Installierbar als App („Zum Startbildschirm hinzufügen“) |

## Sicherheit in Kürze

- Der publishable Key im Code ist öffentlich gedacht. Ohne gültige Anmeldung liefert die Datenbank nichts außer den vier Vornamen für die Login-Buttons.
- Das Codewort liegt nur als bcrypt-Hash in der Datenbank und ist nicht auslesbar. Nach 20 Fehlversuchen in 15 Minuten wird der Login kurz gesperrt.
- Bilder liegen in einem privaten Bucket und werden nur über zeitlich begrenzte Links angezeigt.
