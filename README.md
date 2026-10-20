# Basenplaner

Minecraft-Base am Rechner planen: Welt laden, Bauplatz auf der Karte markieren, Bauwerk einsetzen, in 3D mit dem echten Gelände prüfen, Schicht für Schicht nachbauen und als `.litematic` ins Spiel holen.

Läuft komplett im Browser. Die Welt verlässt den Rechner nicht.

## Benutzen
1. In Chrome öffnen, links **Welt-Ordner verbinden** und den Weltordner wählen (`~/Library/Application Support/minecraft/saves/<Welt>`, der Ordner mit `level.dat`). Alternativ ein ZIP der Welt.
2. Optional **.jar wählen** für echte Texturen: `~/Library/Application Support/minecraft/versions/<Version>/<Version>.jar` (im Dateidialog ⌘⇧G, dann den Pfad einfügen).
3. Auf der Karte einen Punkt setzen, Bauwerk wählen, **Hier bauen**.
4. **In 3D ansehen**, unten Schicht für Schicht durchgehen.
5. **.litematic** speichern, in den `schematics`-Ordner legen und in Litematica auf den angezeigten Ursprung setzen.

Tasten: `R` drehen, Pfeile verschieben (in 3D), Bild hoch/runter für die Höhe, `[` und `]` für die Ebenen, Leertaste spielt ab.

## Entwickeln
```
npm install
npm run dev
npm test
```
Details zu Aufbau und Regeln in `CLAUDE.md`.

Minecraft-Texturen und -Modelle gehören Mojang und sind nicht Teil dieses Repos. Die App liest sie aus der eigenen Spieldatei.
