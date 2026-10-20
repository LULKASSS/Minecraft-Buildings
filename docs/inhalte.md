# Was in den Basenplaner hineingehört

Stand 20.10.2026, Entwurf zur Besprechung mit Lukas. Nichts davon ist gebaut.

## Worum es geht

Lukas will seine Base individuell bauen, und sie soll gut aussehen. Ob sie gut aussieht, hängt fast nur am Vorschlag, den die App macht. Also muss die App wissen, *warum* etwas gut aussieht, und nicht nur Blöcke stapeln.

Gut aussehen entsteht bei Minecraft-Bauten aus fünf Dingen, in dieser Reihenfolge:

1. **Form und Proportion.** Dachneigung, Überstand, Verhältnis Wand zu Dach, ungerade Breiten (damit es eine Mitte gibt), Höhenstaffelung statt Kisten.
2. **Tiefe.** Keine flachen Wände: Rahmen stehen vor, Fenster sitzen zurück, Sockel springt raus, Balken unter dem Dach. Mindestens ein Block Versatz.
3. **Palette.** Zwei bis drei Hauptmaterialien plus ein Akzent, mit Kontrast in Helligkeit *und* Textur. Flächen gemischt (z. B. Steinziegel mit rissigen und bemoosten), nach unten verwittert.
4. **Einbettung.** Fundament folgt dem Gelände, Wege führen hin, Pflanzen und Felsen um den Sockel, Licht versteckt statt Fackeln an der Wand.
5. **Zusammenhang.** Alle Bauten einer Base teilen Palette und Formensprache, variieren aber in Größe und Details.

Daraus folgen sechs Bausteine, die aufeinander aufbauen.

## 1. Blockkatalog (Grundlage für alles)

Jeder Block bekommt Eigenschaften, mit denen die App rechnen kann:

| Eigenschaft | Woher |
|---|---|
| Farbe (Mittelwert), Helligkeit | automatisch aus der .jar (Texturmittel, wie jetzt schon für die Karte) |
| Textur-Unruhe (wie „laut“ die Fläche wirkt) | automatisch aus der .jar (Streuung der Pixel) |
| Familie und Formen: gibt es Treppe, Stufe, Mauer, Zaun, Tür, Falltür? | automatisch aus `blocks-26.1.json` über die Namen (`stone_brick_stairs` …) |
| Material: Stein, Holz, Erde, Metall, Glas, Pflanze, Licht | Tabelle, einmal gepflegt |
| Beschaffbarkeit im Survival: billig, normal, aufwendig, selten | Tabelle, einmal gepflegt |

Damit kann die App Farbverläufe bauen, ähnliche Blöcke als Ersatz finden („zu teuer, nimm …“) und prüfen, ob eine Palette Kontrast hat.

## 2. Paletten nach Rollen

Eine Palette ist keine Blockliste, sondern eine Belegung von **Rollen**:

```
Sockel / Fundament     cobblestone 60 %, andesite 25 %, mossy_cobblestone 15 %
Wand                   …
Rahmen / Balken        …
Dach-Fläche            … (braucht Treppe + Stufe)
Dach-Kante             …
Fenster                …
Boden innen            …
Weg                    dirt_path 50 %, coarse_dirt 30 %, gravel 20 %
Licht                  lantern
Akzent                 …
```

Jede Rolle hat 1–3 Blöcke mit Gewicht. Die Formen (Treppe, Stufe, Mauer) holt der Generator aus der Familie, deshalb muss die Familie sie haben. Zusätzlich kennt eine Palette einen **Verlauf** (unten verwittert, oben sauber) und eine **Stimmung** (warm/kühl, hell/dunkel).

## 3. Stile = Palette + Regeln

Ein Stil legt fest, *wie* gebaut wird, und bringt 2–4 passende Paletten mit:

| Stil | Formensprache | Paletten-Beispiele |
|---|---|---|
| Mittelalterlich | Fachwerk, steiles Satteldach 45°, Sockel aus Bruchstein, Überstand 1, Gauben | Eiche/Bruchstein · Fichte/Andesit · Dunkeleiche/Tiefenschiefer |
| Japanisch | flaches, geschwungenes Dach mit großem Überstand, Pfosten sichtbar, Papierwände, Sockel erhöht | Kirsche/Fichte/Kalzit · Dunkeleiche/Schwarzstein |
| Modern | flache Dächer, große Glasflächen, Auskragungen, wenige Materialien | Quarz/Glas/Grauer Beton · Kalzit/Tuff/Eisen |
| Wüste | dicke Wände, Flachdach mit Brüstung, kleine Öffnungen, Innenhof, Markisen aus Wolle | Sandstein/Terrakotta · Rotsand/Akazie |
| Steampunk | Fachwerk aus Metall, Kupfer und Rohre, Schornsteine, unregelmäßige Aufbauten | Kupfer-Stufen/Dunkeleiche/Tiefenschiefer |

Dazu kommen **Detail-Module** je Stil: Fensterbank mit Blumen, Kamin, Laterne, Vordach, Balkon, Fensterläden. Ein Haus besteht aus Grundform + Dach + Modulen. So entsteht Abwechslung, ohne dass es beliebig aussieht.

## 4. Strukturen (dekorativ, prozedural)

Aus Stil-Modulen zusammengesetzt, alle mit Größe S/M/L und Varianten:

- Haus, Turm, Scheune/Lagerhaus, Werkstatt
- Mauer mit Tor, Brücke (Etappe 4), Steg/Hafen
- Brunnen, Marktstand, Schrein/kleiner Tempel, Laternenpfahl
- Wege (folgen dem Gelände, Rand aus gemischten Blöcken), Zäune, Gärten, Felder
- Dorf (Etappe 4): mehrere davon mit Wegenetz auf einer Fläche

## 5. Natur (eigener Bereich, eher Pinsel als Gebäude)

Natur ist das, was eine Base am stärksten „fertig“ wirken lässt. Vorschlag: Werkzeuge, die auf einer Fläche wirken.

- **Bäume** als eigene Generatoren je Art (Eiche groß/klein, Fichte, Birke, Kirsche, Mangrove, Weide aus Eiche mit Ranken). Größer und schöner als Vanilla, im Stil der Custom-Trees aus der Community.
- **Büsche, Blumenwiesen, Felsen/Findlinge** mit Verlauf (dichter am Rand von Wegen und Gebäuden).
- **Gelände formen:** glätten, terrassieren, Ufer, kleine Teiche. Wichtig: die .litematic enthält dann auch Luft, wo Blöcke weg müssen. Litematica zeigt das als „zu entfernen“ an.
- Die App liest das **Biom** aus der Welt (steht in den Chunks) und schlägt passende Natur und passenden Stil vor (Wüste → Akazie, Kaktus, Sandstein).

## 6. Funktionale Vorlagen (Farmen, Redstone)

Bleibt bei der Regel: nicht generiert, nur geprüfte Vorlagen. Vorschlag für den Weg dahin:

- **Vorlagen-Import:** Lukas lädt eine .litematic einer Farm, die nachweislich läuft (eigene oder von einem Ersteller, dem er traut). In der App markiert er einmal den **Funktionskern** (darf sich nie ändern) und die **Hülle** (darf Fassade bekommen).
- Die App setzt die Vorlage nur ein, dreht sie und legt eine Stil-Fassade außen herum. Den Kern fasst sie nicht an.
- Jede Vorlage trägt die Minecraft-Version, in der sie getestet wurde. Bei einer anderen Weltversion gibt es eine Warnung.
- **Diese Vorlagen kommen nicht ins öffentliche Repo** (Rechte der Ersteller), sie liegen nur bei Lukas im Browser.

Kandidaten nach Nutzen für eine Base: Eisenfarm, Trading Hall, Dorfbewohner-Zucht, automatische Felder (Weizen/Karotte/Kartoffel), Zuckerrohr, Kürbis/Melone, Lagersystem mit Sortierer, Mob-Farm, Rohstoff-Ofenanlage.

## 7. Der Vorschlag (davon hängt das Aussehen ab)

Die App soll nicht ein Ergebnis liefern, sondern **drei Varianten nebeneinander**, nach Regeln bewertet:

- Proportion und Tiefe (Regeln aus Abschnitt „Worum es geht“)
- Gelände: wie viel muss abgetragen/aufgeschüttet werden, sitzt das Fundament
- Palette: Kontrast, Zusammenhang mit den anderen Bauten im Bereich
- Aufwand: Materialmenge, Beschaffbarkeit

**Stil aus der eigenen Base lernen:** Lukas zieht einen Bereich um etwas, das er schon gebaut hat. Die App zählt die Blöcke und schlägt daraus eine Palette mit Rollen vor. Neue Bauten passen dann zu dem, was schon steht.

## Reihenfolge, die ich vorschlage

1. **Blockkatalog + Paletten nach Rollen + Paletten-Ansicht** (Paletten als Farbstreifen und als Musterwand in 3D ansehen, eigene Paletten anlegen, „aus Bereich lernen“).
2. **Drei Stile mit Haus-Generator aus Modulen** und drei Varianten zur Auswahl.
3. **Natur-Pinsel**: Bäume, Büsche, Wege. Macht optisch am meisten aus.
4. **Vorlagen-Import für Farmen** mit Kern/Hülle und Fassade.
5. Weitere Strukturen, Brücke, Dorf.

Das zieht Natur vor die Farmen (bisher Etappe 3), weil sie für „sieht gut aus“ mehr bringt. Die Entscheidung liegt bei Lukas.

## Offene Fragen an Lukas

- Welche drei Stile zuerst?
- Survival oder Kreativ auf dem Realm? (Entscheidet, wie stark Beschaffbarkeit zählt.)
- Gibt es Farm-Designs (.litematic), denen du vertraust?
- Gibt es Bauten oder Ersteller, deren Look dir gefällt? Daran richte ich Paletten und Regeln aus.
