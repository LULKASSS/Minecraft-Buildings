# Basenplaner (Minecraft-Buildings)

## Ziel
- Wofür: eine Bauidee an der echten Stelle der eigenen Welt prüfen und sie danach ohne Rätselraten im Spiel nachbauen.
- Wer, wann: Lukas, am Mac in Chrome, vor oder während einer Minecraft-Sitzung (Java 26.x). Seine Welt ist ein Realm, sie kommt als heruntergeladener Ordner, nicht als ZIP.
- Gelungen, wenn: das Bauwerk steht in Litematica exakt dort, wo es in der App stand, und die Materialliste reicht genau.
- Ablauf (Lukas, 20.10.2026): auf der Karte eine Form zeichnen → die App rendert genau diesen Bereich in 3D → Bereich anklicken, in die 3D-Ansicht → frei durchfliegen wie in Minecraft und sehen, was da steht → erst dort Gebäude platzieren.
- Abgenommen: noch nichts (Etappe 1 liegt zur Abnahme, Stand 20.10.2026).
- Nicht gewollt: frei generierte Farmen/Redstone, mitgelieferte Mojang-Texturen, Blau in der Oberfläche, Template-Look, Titelbalken oben links. Gebäude direkt auf der Karte platzieren (Fassung 1/2). Eine 3D-Ansicht, die nur das Gebäude mit etwas Rand zeigt statt des ganzen Bereichs.

## Regeln, die immer gelten
- **Funktional und dekorativ trennen.** Farmen und Redstone (Eisenfarm, Trading Hall) entstehen nur aus geprüften Vorlagen, die parametrisiert werden (Ausrichtung, Anzahl Module, Fassade). Spawnfläche, Dorfbewohner-Plätze, Kill-Kammer, Wasserströme bleiben unverändert. Nur dekorative Bauten (Haus, Brücke, Dorf) werden prozedural erzeugt.
- **Ein Format für alle Bauwerke:** `src/blueprint/blueprint.ts`. Generator, Karte, 3D, Anleitung und Export lesen nur daraus. Gespeichert wird die Quelle (Generator, Version, Seed, Parameter), nicht der Blockhaufen.
- **Keine Texturen im Repo.** Die App liest sie zur Laufzeit aus der .jar, die der Nutzer wählt. Ohne .jar: einfarbig.
- **Keine Weltdaten im Repo.** Tests bauen ihre Welt selbst (`src/world/demo-world.ts`). Das Repo ist öffentlich.
- Blockstates gegen `data/blocks-26.1.json` (IDs, Properties, Standardwerte aus dem Datengenerator-Report, über misode/mcmeta). Generatoren verwenden nur Blöcke, die es dort gibt, dann laufen sie in allen 26.x.

## Aufbau
```
src/blueprint/   Bauwerk-Format, Blockstates, Drehen/Spiegeln, Platzierung, Schichten, Material
src/catalog/     Bauwerk-Typen: styles (5 Stile), house, small (Turm, Brunnen, Laterne, Marktstand), nature (Bäume, Busch, Fels, Natur-Pinsel), template (Vorlagen-Import mit Fassade)
src/style/       Blockkatalog (Familien, Material, Survival-Aufwand, Treppenformen und Verbindungen wie im Spiel), Paletten nach Rollen, Baukasten, Paletten-Lernen
src/world/       Weltquelle (Ordner/Upload/ZIP), level.dat, Region-Leser, Chunk-Dekoder, Kacheln, Gelände-Ausschnitt, Worker
src/map/         2D-Karte
src/render/      Blockfarben, vereinfachte Formen, Mesher, Three.js-Szene, Flugsteuerung, Texturen aus der .jar (deepslate)
src/export/      .litematic (Version 7, SubVersion 1) und .schem (Sponge v3)
src/app/         Zustand S (Bereiche, Bauwerke), IndexedDB, Welt-Sitzung mit Worker-Pool, area-view (3D eines Bereichs)
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
- Annahme: Verbindungen von Zäunen/Scheiben/Mauern sind vereinfacht nachgerechnet (gleichartige Blöcke, Zauntore, volle Blöcke). Seltene Sonderfälle können in Litematica als „falscher Zustand“ erscheinen.
- Annahme: Luft innerhalb eines Bauwerks zeigt Litematica als „zu entfernen“ an, wo Gelände steht. Gewollt im Haus, am Rand (Dachüberstand) noch im Spiel zu prüfen.
- Survival-Aufwand ist eine grobe Einstufung (1 liegt herum … 4 selten), keine Rechnung.

## Stand
- 20.10.2026 (Fassung 5): Inhalte nach `docs/inhalte.md` gebaut. Blockkatalog, 12 Paletten nach Rollen (Sockel, Wand, Balken, Dach, Kante, Boden, Fenster, Tür, Holz, Licht, Stoff, Weg), Paletten aus einem Bereich lernen. 5 Stile (Mittelalter, Japan, Modern, Wüste, Steampunk) mit Haus-Generator (Fachwerk/Pfosten, Fensterläden, Blumenkästen, Markisen, Sattel-/Pagoden-/Flachdach/Brüstung, Vordach mit Laternen, Schornstein mit Rauch, Leiter, Fundament folgt dem Gelände bis zum Seegrund), Turm, Brunnen, Laterne, Marktstand. Natur: 6 Holzarten in 3 Größen, Busch, Fels, Natur-Pinsel mit 6 Mischungen (nichts auf Wasser, Pflanzen nur auf Erde). Vorlagen-Import (.litematic, mehrere Regionen) mit Fassade im Abstand 1, Kern geschützt, Versionswarnung, Vorlagen nur lokal. Bauen-Leiste mit 3 Varianten (Vorschaubild, Stacks/Shulker, Aufwand), andere Variante würfeln, Palette am gesetzten Bauwerk wechseln, Gelände-Abtrag. 48 Tests.
- 20.10.2026 (Fassung 4): Ablauf umgebaut. Karte: Bereich als Rechteck aufziehen (max. 512 × 512). 3D: ganzer Bereich in 32er-Stücken geladen (Höhe aus den Heightmaps, 6 Blöcke Untergrund), frei durchfliegen (WASD, Leertaste/Shift, Strg, Maus; Doppelklick fängt die Maus), dort Bauwerk wählen, Vorschau am Mauszeiger, Klick setzt, R dreht. Lasttest 501 × 501: 11 s mit Software-Grafik.
- 20.10.2026: Etappe 1 (Durchstich) gebaut: Welt laden (Ordner/ZIP), Karte mit Kacheln und Markierungen, Testhaus platzieren/drehen/spiegeln/verschieben, 3D mit Gelände (einfarbig oder mit .jar-Texturen), Schicht-Anleitung mit Timeline und Materialliste, Export .litematic/.schem. Offen: Test mit Lukas' echter Welt und in Litematica.

## Verlauf der Fassungen
- Fassung 1 (20.10.2026): erster Durchstich. Rückmeldung: in der Artifact-Vorschau ließ sich der Weltordner nicht verbinden (Fehler).
- Fassung 2 (20.10.2026): eingebettet (Artifact) Ordner über Dateiauswahl oder Hineinziehen, Export dort als .zip über den Speichern-Dialog der Plattform. Direkt geöffnet (Pages, lokal) bleibt die dauerhafte Ordner-Verbindung.
- Fassung 3 (20.10.2026): .jar auch per Hineinziehen, Pfad-Hinweis. Rückmeldung: „warum noch ohne Farbe, wo ist die .jar?“ und Ablauf grundsätzlich ändern (siehe Zielkarte „Ablauf“). Form: Rechteck aufziehen, Bereiche bis ca. 500 × 500.
- Fassung 4 (20.10.2026): neuer Ablauf Bereich → 3D-Flug → platzieren. Rückmeldung: „mach alles aus docs/inhalte.md“, meist Survival, keine Vorbilder.
- Fassung 5 (20.10.2026): Paletten, Stile, Strukturen, Natur, Vorlagen, Varianten. Wartet auf Rückmeldung.
