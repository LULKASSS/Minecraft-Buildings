# Basenplaner (Minecraft-Buildings)

## Ziel
- Wofür: eine Bauidee an der echten Stelle der eigenen Welt prüfen und sie danach ohne Rätselraten im Spiel nachbauen.
- Wer, wann: Lukas, am Mac in Chrome, vor oder während einer Minecraft-Sitzung (Java 26.x).
- Gelungen, wenn: das Bauwerk steht in Litematica exakt dort, wo es in der App stand, und die Materialliste reicht genau.
- Abgenommen: noch nichts (Etappe 1 liegt zur Abnahme, Stand 20.10.2026).
- Nicht gewollt: frei generierte Farmen/Redstone, mitgelieferte Mojang-Texturen, Blau in der Oberfläche, Template-Look, Titelbalken oben links.

## Regeln, die immer gelten
- **Funktional und dekorativ trennen.** Farmen und Redstone (Eisenfarm, Trading Hall) entstehen nur aus geprüften Vorlagen, die parametrisiert werden (Ausrichtung, Anzahl Module, Fassade). Spawnfläche, Dorfbewohner-Plätze, Kill-Kammer, Wasserströme bleiben unverändert. Nur dekorative Bauten (Haus, Brücke, Dorf) werden prozedural erzeugt.
- **Ein Format für alle Bauwerke:** `src/blueprint/blueprint.ts`. Generator, Karte, 3D, Anleitung und Export lesen nur daraus. Gespeichert wird die Quelle (Generator, Version, Seed, Parameter), nicht der Blockhaufen.
- **Keine Texturen im Repo.** Die App liest sie zur Laufzeit aus der .jar, die der Nutzer wählt. Ohne .jar: einfarbig.
- **Keine Weltdaten im Repo.** Tests bauen ihre Welt selbst (`src/world/demo-world.ts`). Das Repo ist öffentlich.
- Blockstates gegen `data/blocks-26.1.json` (IDs, Properties, Standardwerte aus dem Datengenerator-Report, über misode/mcmeta). Generatoren verwenden nur Blöcke, die es dort gibt, dann laufen sie in allen 26.x.

## Aufbau
```
src/blueprint/   Bauwerk-Format, Blockstates, Drehen/Spiegeln, Platzierung, Schichten, Material
src/catalog/     Bauwerk-Typen (E1: Testhaus). E2 styles/, E3 functional/, E4 bridge/, village/
src/world/       Weltquelle (Ordner/Upload/ZIP), level.dat, Region-Leser, Chunk-Dekoder, Kacheln, Gelände-Ausschnitt, Worker
src/map/         2D-Karte
src/render/      Blockfarben, vereinfachte Formen, Mesher, Three.js-Szene, Texturen aus der .jar (deepslate)
src/export/      .litematic (Version 7, SubVersion 1) und .schem (Sponge v3)
src/app/         Zustand S, IndexedDB, Welt-Sitzung mit Worker-Pool
src/ui/          Styles (Tokens hell/dunkel), Seitenleiste, Bauanleitung
```

Weltformat: ab 26.1 liegen die Regionen in `dimensions/minecraft/overworld/region`, davor in `region/`. Beide werden gelesen. Chunks vor 1.18 (`Level`-Tag) werden übersprungen und gemeldet, LZ4-Kompression ebenfalls.

## Befehle
- `npm run dev` – lokal starten
- `npm test` – Typen + Kern-Tests (Blockstates, Drehtabelle gegen alle Blöcke, Material, Region/Chunk, Export mit Gegenlesen durch Lodestone)
- `npm run build && npm run test:e2e` – Rundgang im Browser, Bilder in `test/out/`. Mit `JAR=/pfad/26.1.jar` zusätzlich mit echten Texturen.
- Mit `?demo` startet die App direkt mit der Testwelt.

## Annahmen
- Annahme: Litematica 26.x liest Schematic-Version 7 / SubVersion 1 wie in 1.21.11 (Quelltext geprüft für 1.21.11). Beweis steht aus: Lukas' Test im Spiel.
- Annahme: Bauwerke werden mit dem Anker auf den obersten Block der Markierung gesetzt (Boden ersetzt den Geländeblock).
- Kartenfarben mit .jar: Mittelwert der Oberseiten-Textur mit Standard-Biomtönung, keine echte Biomtönung je Spalte.

## Stand
- 20.10.2026: Etappe 1 (Durchstich) gebaut: Welt laden (Ordner/ZIP), Karte mit Kacheln und Markierungen, Testhaus platzieren/drehen/spiegeln/verschieben, 3D mit Gelände (einfarbig oder mit .jar-Texturen), Schicht-Anleitung mit Timeline und Materialliste, Export .litematic/.schem. Offen: Test mit Lukas' echter Welt und in Litematica.

## Verlauf der Fassungen
- Fassung 1 (20.10.2026): erster Durchstich, wartet auf Rückmeldung.
