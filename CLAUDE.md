# Basenplaner (Minecraft-Buildings)

## Ziel
- Wofür: eine Bauidee an der echten Stelle der eigenen Welt prüfen und sie danach ohne Rätselraten im Spiel nachbauen.
- Wer, wann: Lukas, am Mac in Chrome, vor oder während einer Minecraft-Sitzung (Java 26.x). Seine Welt ist ein Realm, sie kommt als heruntergeladener Ordner, nicht als ZIP.
- Gelungen, wenn: das Bauwerk steht in Litematica exakt dort, wo es in der App stand, und die Materialliste reicht genau.
- Ablauf (Lukas, 20.10.2026, Fassung 6, Vorbild: Papaplattes Marineford-Seite aus CraftAttack 14): Minecraft-Ordner freigeben → Welt und .jar kommen automatisch → **sofort 3D über den ganzen Bildschirm**, mit Texturen, Start über eurer Base, Umgebung bis zum Horizont → Maus ziehen = umsehen, Rad = näher/weiter, **F = Flugmodus mit Fadenkreuz** → Haus wählen und in 3D setzen → **Haus anklicken = Schritt-für-Schritt-Anleitung nur für dieses Haus**. Karte nur noch klein zum Hinspringen (kein Messen, kein Rechteck-Aufziehen). Man soll sofort sehen, wo man schon gebaut hat und wo man viel Zeit verbracht hat.
- Abgenommen: noch nichts (Fassung 6 liegt zur Abnahme, Stand 20.10.2026).
- Nicht gewollt: frei generierte Farmen/Redstone, mitgelieferte Mojang-Texturen, Blau in der Oberfläche, Template-Look, Titelbalken oben links. Gebäude direkt auf der Karte platzieren (Fassung 1/2). Eine 3D-Ansicht, die nur das Gebäude mit etwas Rand zeigt statt des ganzen Bereichs. Karte als Startbildschirm und Bereiche aufziehen (Fassung 4/5). Graue Karte, die irgendwann nicht weiterlädt.

## Regeln, die immer gelten
- **Funktional und dekorativ trennen.** Farmen und Redstone (Eisenfarm, Trading Hall) entstehen nur aus geprüften Vorlagen, die parametrisiert werden (Ausrichtung, Anzahl Module, Fassade). Spawnfläche, Dorfbewohner-Plätze, Kill-Kammer, Wasserströme bleiben unverändert. Nur dekorative Bauten (Haus, Brücke, Dorf) werden prozedural erzeugt.
- **Ein Format für alle Bauwerke:** `src/blueprint/blueprint.ts`. Generator, Karte, 3D, Anleitung und Export lesen nur daraus. Gespeichert wird die Quelle (Generator, Version, Seed, Parameter), nicht der Blockhaufen.
- **Keine Texturen im Repo.** Die App liest sie zur Laufzeit aus der .jar im Minecraft-Ordner (versions/, Version der Welt, sonst neueste Vanilla, nie Fabric/Forge) oder lädt sie auf Knopfdruck direkt von Mojang (piston-data, erlaubt Abruf aus dem Browser) und behält sie in IndexedDB. Ohne .jar: einfarbig.
- **Keine Weltdaten im Repo.** Tests bauen ihre Welt selbst (`src/world/demo-world.ts`). Das Repo ist öffentlich.
- Blockstates gegen `data/blocks-26.1.json` (IDs, Properties, Standardwerte aus dem Datengenerator-Report, über misode/mcmeta). Generatoren verwenden nur Blöcke, die es dort gibt, dann laufen sie in allen 26.x.

## Aufbau
```
src/blueprint/   Bauwerk-Format, Blockstates, Drehen/Spiegeln, Platzierung, Schichten, Material
src/catalog/     Bauwerk-Typen: styles (5 Stile), house, small (Turm, Brunnen, Laterne, Marktstand), nature (Bäume, Busch, Fels, Natur-Pinsel), template (Vorlagen-Import mit Fassade)
src/style/       Blockkatalog (Familien, Material, Survival-Aufwand, Treppenformen und Verbindungen wie im Spiel), Paletten nach Rollen, Baukasten, Paletten-Lernen
src/world/       Weltquelle (Ordner/Upload/ZIP), minecraft (Minecraft-Ordner: Welten aus saves, .jar aus versions), level.dat, Region-Leser, Chunk-Dekoder, Kacheln (Farbe, Spuren, grobes Höhenfeld), traces (Orte mit viel Spielzeit), Gelände-Ausschnitt, Worker
src/map/         Karte zum Hinspringen (klein folgt der Kamera, groß verschiebbar)
src/render/      Blockfarben, vereinfachte Formen, Mesher, Three.js-Szene (Umsehen per OrbitControls, F = Flugmodus), Ferne (lod), Texturen aus der .jar (deepslate), mojang (.jar laden)
src/export/      .litematic (Version 7, SubVersion 1) und .schem (Sponge v3)
src/app/         Zustand S (Bauwerke, Kamera), IndexedDB, Welt-Sitzung mit Worker-Pool (Warteschlange nach Nähe, Absturz-Ersatz), world-view (3D: Nachladen um den Kamerapunkt)
src/ui/          Styles (Tokens hell/dunkel), Bau-Panel, Bauanleitung
```

Weltformat: ab 26.1 liegen die Regionen in `dimensions/minecraft/overworld/region`, davor in `region/`. Beide werden gelesen. Chunks vor 1.18 (`Level`-Tag) werden übersprungen und gemeldet, LZ4-Kompression ebenfalls. Unterkante aus `yPos` (Licht-Abschnitte Y −5/20 zählen nicht), Heightmap-Bitbreite aus der Zahl der Longs (384 hoch → 9 Bit).

3D: nahes Gelände in 32er-Stücken um den Kamerapunkt (Radius 96–288 nach Abstand, wird wieder freigegeben), Ferne bis 2600 Blöcke aus dem groben Höhenfeld der Kartenkacheln (4 × 4 je Säule). Eine Maske je 32er-Stück blendet die Ferne aus, wo echte Blöcke liegen. Über 1700 Blöcke vom Szenenmittelpunkt wird neu aufgebaut.

## Befehle
- `npm run dev` – lokal starten
- `npm test` – Typen + Kern-Tests (Blockstates, Drehtabelle gegen alle Blöcke, Material, Region/Chunk, Export mit Gegenlesen durch Lodestone)
- `npm run build && npm run test:e2e` – Rundgang im Browser mit einem erzeugten Minecraft-Ordner (zwei Welten, versions/26.1), Bilder in `test/out/`. Mit `JAR=/pfad/26.1.jar` liegt die echte .jar in versions/ und wird automatisch geladen. `OHNE_GALERIE=1`, `NUR_GALERIE=1`.
- Mit `?demo` startet die App direkt mit der Testwelt.

## Annahmen
- Chrome gibt auf dem Mac nichts unter `~/Library` für die dauerhafte Ordner-Freigabe frei (Sperrliste `kBlockPaths`, `DIR_APP_DATA` mit `kBlockAllChildren`, Chromium-Quelltext gelesen, nicht in Lukas' Chrome ausprobiert). Deshalb auf dem Mac nur „auswählen“ (webkitdirectory) und Hineinziehen; damit hat Lukas seinen Weltordner aus `saves` schon geöffnet. Folge: nach jedem Neuladen den Ordner neu wählen.
- Annahme: Lukas' Ordner `versions/26.3` enthält nur die .json (Bildschirmfoto), die .jar fehlt. Dann hilft der Mojang-Knopf.
- „Gebaut“ auf der Karte heißt: oberster Block ist kein natürlicher. Dörfer, Ruinen und Wege zählen mit. Orte mit viel Spielzeit kommen aus `InhabitedTime` (zählt in allen Chunks um den Spieler gleichzeitig).
- Annahme: Litematica 26.x liest Schematic-Version 7 / SubVersion 1 wie in 1.21.11 (Quelltext geprüft für 1.21.11). Beweis steht aus: Lukas' Test im Spiel.
- Annahme: Bauwerke werden mit dem Anker auf den obersten Block der Markierung gesetzt (Boden ersetzt den Geländeblock).
- Kartenfarben mit .jar: Mittelwert der Oberseiten-Textur mit Standard-Biomtönung, keine echte Biomtönung je Spalte.
- Annahme: Verbindungen von Zäunen/Scheiben/Mauern sind vereinfacht nachgerechnet (gleichartige Blöcke, Zauntore, volle Blöcke). Seltene Sonderfälle können in Litematica als „falscher Zustand“ erscheinen.
- Annahme: Luft innerhalb eines Bauwerks zeigt Litematica als „zu entfernen“ an, wo Gelände steht. Gewollt im Haus, am Rand (Dachüberstand) noch im Spiel zu prüfen.
- Survival-Aufwand ist eine grobe Einstufung (1 liegt herum … 4 selten), keine Rechnung.

## Stand
- 20.10.2026 (Fassung 6): Ablauf wie Papaplattes Marineford-Seite. Minecraft-Ordner auswählen oder hineinziehen → Welten aus saves (zuletzt gespielte oben, letzte Wahl wird gemerkt), .jar aus versions automatisch, sonst Knopf „von Mojang laden“. Sofort 3D über den ganzen Bildschirm, Start an der gemerkten Kamera, sonst Spawn, und einmal automatisch zur Base (meiste Spielzeit), wenn man sich noch nicht bewegt hat. Ziehen = umsehen, Rad = Zoom zum Mauszeiger, WASD, Doppelklick = hinfliegen, F = Flugmodus mit Fadenkreuz. Ferne bis zum Horizont. Haus setzen, anklicken = Anleitung. Karte klein rechts unten (M = groß), mit Spuren (gebaut / Spielzeit) und nummerierten Orten. Karte: Region ganz lesen, Abschnitte erst bei Bedarf, Warteschlange nach Nähe, Worker-Ersatz bei Absturz/Hänger, .jar laden ersetzt Bilder nach und nach. Fehler behoben: Heightmap-Bitbreite und Licht-Abschnitte (verschoben Höhen und Farben in echten Welten). 54 Tests. Große Testwelt (4 Regionen) mit .jar in ~37 s fertig geladen (Software-Grafik).
- 20.10.2026 (Fassung 5): Inhalte nach `docs/inhalte.md` gebaut. Blockkatalog, 12 Paletten nach Rollen (Sockel, Wand, Balken, Dach, Kante, Boden, Fenster, Tür, Holz, Licht, Stoff, Weg), Paletten aus einem Bereich lernen. 5 Stile (Mittelalter, Japan, Modern, Wüste, Steampunk) mit Haus-Generator (Fachwerk/Pfosten, Fensterläden, Blumenkästen, Markisen, Sattel-/Pagoden-/Flachdach/Brüstung, Vordach mit Laternen, Schornstein mit Rauch, Leiter, Fundament folgt dem Gelände bis zum Seegrund), Turm, Brunnen, Laterne, Marktstand. Natur: 6 Holzarten in 3 Größen, Busch, Fels, Natur-Pinsel mit 6 Mischungen (nichts auf Wasser, Pflanzen nur auf Erde). Vorlagen-Import (.litematic, mehrere Regionen) mit Fassade im Abstand 1, Kern geschützt, Versionswarnung, Vorlagen nur lokal. Bauen-Leiste mit 3 Varianten (Vorschaubild, Stacks/Shulker, Aufwand), andere Variante würfeln, Palette am gesetzten Bauwerk wechseln, Gelände-Abtrag. 48 Tests.
- 20.10.2026 (Fassung 4): Ablauf umgebaut. Karte: Bereich als Rechteck aufziehen (max. 512 × 512). 3D: ganzer Bereich in 32er-Stücken geladen (Höhe aus den Heightmaps, 6 Blöcke Untergrund), frei durchfliegen (WASD, Leertaste/Shift, Strg, Maus; Doppelklick fängt die Maus), dort Bauwerk wählen, Vorschau am Mauszeiger, Klick setzt, R dreht. Lasttest 501 × 501: 11 s mit Software-Grafik.
- 20.10.2026: Etappe 1 (Durchstich) gebaut: Welt laden (Ordner/ZIP), Karte mit Kacheln und Markierungen, Testhaus platzieren/drehen/spiegeln/verschieben, 3D mit Gelände (einfarbig oder mit .jar-Texturen), Schicht-Anleitung mit Timeline und Materialliste, Export .litematic/.schem. Offen: Test mit Lukas' echter Welt und in Litematica.

## Verlauf der Fassungen
- Fassung 1 (20.10.2026): erster Durchstich. Rückmeldung: in der Artifact-Vorschau ließ sich der Weltordner nicht verbinden (Fehler).
- Fassung 2 (20.10.2026): eingebettet (Artifact) Ordner über Dateiauswahl oder Hineinziehen, Export dort als .zip über den Speichern-Dialog der Plattform. Direkt geöffnet (Pages, lokal) bleibt die dauerhafte Ordner-Verbindung.
- Fassung 3 (20.10.2026): .jar auch per Hineinziehen, Pfad-Hinweis. Rückmeldung: „warum noch ohne Farbe, wo ist die .jar?“ und Ablauf grundsätzlich ändern (siehe Zielkarte „Ablauf“). Form: Rechteck aufziehen, Bereiche bis ca. 500 × 500.
- Fassung 4 (20.10.2026): neuer Ablauf Bereich → 3D-Flug → platzieren. Rückmeldung: „mach alles aus docs/inhalte.md“, meist Survival, keine Vorbilder.
- Fassung 5 (20.10.2026): Paletten, Stile, Strukturen, Natur, Vorlagen, Varianten. Rückmeldung: „warum nicht einfach den Minecraft-Ordner freigeben, dann zieht er sich .jar und Welten“, Karte grau und lädt ab einem Punkt nicht mehr, Farben fehlen trotz .jar, „ich will erkennen, wo ich schon gebaut habe“. Dann: „das ist gar nicht, wie's gehen soll“ mit Video (Marineford-Bau-Website): direkt 3D, umsehen + F-Flugmodus, in 3D setzen, anklicken = Anleitung, Karte nur zum Hinspringen.
- Fassung 6 (20.10.2026): direkt 3D wie im Video, Minecraft-Ordner, Spuren, schnelle Karte. Wartet auf Rückmeldung.
