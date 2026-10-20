# Basenplaner

Minecraft-Base am Rechner planen: Welt laden, Bauplatz auf der Karte markieren, Bauwerk einsetzen, in 3D mit dem echten Gelände prüfen, Schicht für Schicht nachbauen und als `.litematic` ins Spiel holen.

Läuft komplett im Browser. Die Welt verlässt den Rechner nicht.

## Benutzen
1. In Chrome öffnen, links **Welt-Ordner verbinden** und den Weltordner wählen (`~/Library/Application Support/minecraft/saves/<Welt>`, der Ordner mit `level.dat`). Alternativ ein ZIP der Welt.
2. Optional **.jar wählen** für echte Texturen: `~/Library/Application Support/minecraft/versions/<Version>/<Version>.jar` (im Dateidialog ⌘⇧G, dann den Pfad einfügen).
3. Auf der Karte **Bereich aufziehen** (oder `B`, oder Umschalttaste + Ziehen), bis 512 × 512 Blöcke.
4. **In 3D öffnen**: der ganze Bereich wird geladen. Fliegen wie im Kreativmodus: `WASD`, `Leertaste` hoch, `Shift` runter, `Strg` schneller, Maus ziehen zum Umsehen, Doppelklick fängt die Maus (`Esc` gibt frei).
5. Links ein Bauwerk wählen, im Gelände an die Stelle klicken (`R` dreht die Vorschau).
6. Unten Schicht für Schicht durchgehen, **.litematic** speichern und in Litematica auf den angezeigten Ursprung setzen.

Weitere Tasten: Pfeile verschieben das gewählte Bauwerk, Bild hoch/runter die Höhe, `[` und `]` wechseln die Ebene, `P` spielt ab.

## Entwickeln
```
npm install
npm run dev
npm test
```
Details zu Aufbau und Regeln in `CLAUDE.md`.

Minecraft-Texturen und -Modelle gehören Mojang und sind nicht Teil dieses Repos. Die App liest sie aus der eigenen Spieldatei.
