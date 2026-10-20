# Basenplaner

Minecraft-Base in 3D planen: den Minecraft-Ordner freigeben, durch die eigene Welt fliegen, Häuser setzen, jedes Haus anklicken und Schicht für Schicht nachbauen, als `.litematic` ins Spiel holen.

Läuft komplett im Browser. Die Welt verlässt den Rechner nicht.

## Benutzen
1. In Chrome öffnen, **Minecraft-Ordner auswählen** (Mac: im Dialog ⇧⌘G, `~/Library/Application Support/minecraft`) oder den Ordner hineinziehen. Die App findet die Welten unter `saves` (zuletzt gespielte zuerst) und die Spiel-.jar unter `versions` für die Texturen. Liegt dort keine .jar, lädt ein Knopf die passende direkt von Mojang (einmal, bleibt im Browser).
2. Die Welt öffnet sofort in 3D, über der Stelle, an der ihr am meisten Zeit verbracht habt. **Ziehen** = umsehen, **rechts ziehen** = verschieben, **Rad** = näher/weiter, `WASD` = bewegen, **Doppelklick** = hinfliegen.
3. **F** schaltet in den Flugmodus mit Fadenkreuz (`WASD`, `Leertaste`/`Shift` hoch/runter, `Strg` schneller). **F** oder `Esc` zurück.
4. Links ein Bauwerk wählen, **In die Welt setzen**, ins Gelände klicken (`R` dreht die Vorschau).
5. Ein gesetztes Haus **anklicken**: unten die Anleitung Schicht für Schicht mit Materialliste, links Drehen, Verschieben und **.litematic** zum Speichern (in Litematica auf den angezeigten Ursprung setzen).
6. Rechts unten die Karte zum Hinspringen (`M` = groß). Lila: dort ist gebaut, zart: dort wart ihr.

Weitere Tasten: Pfeile verschieben das gewählte Bauwerk, Bild hoch/runter die Höhe, `[` und `]` wechseln die Ebene, `P` spielt ab.

## Entwickeln
```
npm install
npm run dev
npm test
```
Details zu Aufbau und Regeln in `CLAUDE.md`.

Minecraft-Texturen und -Modelle gehören Mojang und sind nicht Teil dieses Repos. Die App liest sie zur Laufzeit aus der eigenen Spieldatei oder lädt sie auf Knopfdruck direkt von Mojang in den Browser.
