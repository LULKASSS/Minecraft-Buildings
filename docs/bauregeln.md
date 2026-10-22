# Bauregeln für die Generatoren

Stand Fassung 15 (22.10.2026). Grundlage: Minecraft-Wiki, „Tutorial:Roof construction guidelines“, „Tutorial:Roof types“, „Tutorial:Walls and buttresses“, „Tutorial:Architectural terms“ (per API gelesen). Dazu die Regeln aus Flash, „55 Tricks in Minecraft um besser zu bauen“ (Fassung 7, nur Standbilder und Kapitel, das Video selbst ist vom Server nicht abrufbar). Videos kann die App-Entwicklung nicht ansehen. Wo eine Regel nicht aus einer Quelle stammt, steht „eigene Annahme“ daneben.

## Dach

| Regel | Quelle | Im Generator |
|---|---|---|
| Dach 1–2 Stockwerke hoch. Ist es höher, ein Stockwerk ins Dach legen oder das Dach teilen. | Wiki Roof construction | Satteldach-Höhe ergibt sich aus der halben Breite. Ab 9 Breite kommen Gauben oder Mansard in Frage. |
| Neigungen: 63° = zwei Blöcke je Schritt, 45° = Treppen, 22,5° = Stufen im Wechsel | Wiki Roof construction | steil (2), normal (1), Mansard unten 2 / oben 1 |
| Ungerade Breite, wenn der First über einer Mitte (Tür) liegen soll; gerade Breite bei Doppeltür | Wiki Roof construction | Hausgrößen ungerade, Woll-Grundriss darf gerade sein (First dann aus zwei Treppen) |
| Ab etwa 15 × 15 kein einfaches Dach mehr: mehrere Dachteile, T/L-Formen | Wiki Roof construction | Bauformen Winkel, Zwerchgiebel, Doppel; Woll-Grundriss wird in Rechtecke mit eigenem Dach zerlegt |
| Dächer verbinden: höchstes zuerst, niedrigere laufen in einer V-Kehle hinein, überzählige Blöcke weg | Wiki Roof construction | `put()`: höchstes Dach zuerst, niedrigere enden an der Hauptfläche (seit Fassung 7) |
| Seitenteil viel höher als der Hauptbau: zum Turm machen | Wiki Roof construction | Bauform „Mit Turm“ |
| Krüppelwalm: unten Satteldach, oben abgewalmt | Wiki Roof types (half-hipped) | `halfHipRoof`, etwa 55 % der Reihen Satteldach |
| Mansard/Gambrel: unten steil, oben flach, mehr Platz unterm Dach | Wiki Roof types | `gambrel`: untere ~45 % der Reihen zwei Blöcke je Schritt |
| Mansard wirkt erst bei großen Bauten | Wiki Roof types | nur ab 9 Blöcken Breite gewürfelt |
| Wandgaube: Wand unter der Gaube geht hoch, eigenes kleines Dach | Wiki Roof types (dormers) | 1–3 Gauben je Längsseite, 3 breit, Satteldach quer zum First, endet, wo es die Hauptfläche trifft |
| Flachdach nie im Wandmaterial abschließen: Rand aus Stufen, Treppen oder Brüstung | Wiki Roof types (flat) | Modern/Wüste: Kante oder Brüstung (seit Fassung 5) |
| Überstand 1–2 Blöcke, Untersicht mit umgedrehten Treppen | Fassung 7 (Flash) | `ov`, `soffit` |

## Wände

| Regel | Quelle | Im Generator |
|---|---|---|
| Keine glatte Wand, wenn sonst nichts Detail hat | Wiki Walls (Plain wall) | Fachwerk, Pfosten, Bänder je Stil |
| Zweifarbig: unten dunkler, oben heller | Wiki Walls (Two tone) | Erdgeschoss aus Stein (`stoneBase`), Verwitterung unten (`lowUntil`) |
| Trennband auf einer Höhe | Wiki Walls (Separator) | Steinband bei Vorkragung, Balkenlage je Stockwerk |
| 3D-Struktur: Treppen, Falltüren, Zäune, Töpfe an der Wand | Wiki Walls (3D texture) | Fensterläden, Blumenkästen, Balkenköpfe, Efeu, Laternen an Ketten |
| Höchstens 1–4 Gestaltungsmittel je Wand | Wiki Walls | je Stil fest gewählt, nicht alle auf einmal |

## Grundriss und Aufbau

| Regel | Quelle | Im Generator |
|---|---|---|
| Am Hang: jeden Bauteil einzeln ebnen oder Wände anpassen | Wiki Roof construction | Sockel folgt dem Gelände nach unten (seit Fassung 5) |
| Schräg gestellte Häuser lohnen selten; wenn, dann Dächer aus Stufen | Wiki Roof construction | Häuser bleiben achsparallel. Nur die Brücke folgt schrägen Wegen. |
| Balkon: Fläche draußen, darunter ist auch draußen | Wiki Roof types (terrace) | Balkon über der Tür, ersetzt das Vordach (eigene Annahme: nur bei 2+ Stockwerken ohne Vorkragung) |

## Woher die Vielfalt kommt (Version 3)

Würfeln wählt je Haus: Bauform, Größe, Stockwerke, Dachform (Sattel, Walm, Krüppelwalm, Mansard, mit Gauben), Vorkragung, Stein-Erdgeschoss und Balkon. Dazu kommen die Paletten. Häuser mit Version 2 (vor Fassung 15 gesetzt) behalten ihre Form. Die neuen Regeln würfeln mit einem eigenen Zufallsstrom.

## Noch nicht umgesetzt (Ideen aus den Quellen)

- Saltbox (eine Dachseite länger, hinten ein Stockwerk weniger)
- Dutch gable (unten Walm, oben kleiner Giebel)
- Helmdach für Türme (vier Giebel)
- Strebepfeiler an Steinbauten
- Innenwände (Sockelleiste, Täfelung) – bisher sind die Häuser innen leer
