# Aampere EV-Pricing & Restwert — Methodik-Dokumentation

**Zweck:** Vollständige Spezifikation der Analyse-Logik (Datenaufbereitung, Preisindex, Restwert, Mix-Bereinigung, Validierung) als Ausgangsbasis für ein wiederholbares Repo in Claude Code.
**Stand:** September 2026 · Datenbasis: Metabase-Export „without_filters", 4.768 EV-Auktionen, Jan–Sep 2026 (September unvollständig, bis 18.).
**Plattform:** EV-only Auktionsplattform — alle Fahrzeuge sind Elektroautos. Kein „EV vs. Verbrenner"-Split.

---

## 1. Datenquelle & Grundgesamtheit

- Quelle: Metabase-Export „without_filters" (CSV), 53 Spalten, eine Zeile = eine Auktion.
- **Grundgesamtheit = Auktionen mit mindestens einem Gebot.** Auktionen ohne Gebot haben kein „Highest Bid" und sind gar nicht im Datensatz → jede Analyse ist bedingt auf „hat mindestens ein Gebot erhalten".
- Prozess-Kontext: Fahrzeug bekommt zuerst eine **Valuation (M1)**; akzeptiert der Verkäufer, geht es in die **Auktion**. Das **höchste Gebot** ist das Marktpreis-Signal.
- Zeitraum wächst mit jedem Export. September ist im aktuellen Export unvollständig (bis 18.) → immer als Teilmonat markieren.

## 2. Feld-Mapping (Spalte → interne Bedeutung)

| Intern | Quellspalte | Hinweis |
|---|---|---|
| brand | `Deal → Make` | kanonisieren, siehe unten |
| model | `Deal → Model` | |
| end_date | `End Time` | → Monat (`YYYY-MM`), Quartal |
| bids | `Number Of Bids` | |
| km | `Deal → Mileage` | |
| age_years | abgeleitet: `(End Time − Deal → First Registration)/365.25` | |
| battery_kwh | `Deal → Battery Capacity Brutto` | **Brutto** (gross) |
| power_kw | `Deal → Power Kw` | |
| list_price | `Deal → List Price` | **Basis-Neupreis, OHNE Sonderausstattung** |
| special_equipment | `Deal → Special Equipment Price` | separater Aufpreis; nur bei ~51 % befüllt |
| **new_price** | `list_price + max(0, special_equipment)` | **Neupreis-Basis für Restwert** (Entscheidung, siehe §6) |
| highest_bid | `Highest Bid corrected` | **steuer-bereinigt** — diesen nutzen, NICHT `Highest Bid Amount` (roh) |
| highest_bid_raw | `Highest Bid Amount` | nur zur Transparenz |
| accident_free | `Deal → Accident Free Seller` **AND** `Deal → Accident Free Cardentity` (beide true) | konservative UND-Definition |
| taxation | `Deal → Taxation` | `marginally_taxed` / `vat_deductible` (im corrected Bid bereits reconciliert) |
| datek_proxy | `(Valuation Range → Min + Max)/2` | DAT-EK-Näherung = Mitte der Range; Coverage ~82 % (Jan nur 31 %) |
| valuation_range | `Valuation Range → Min/Max` | Breite meist 3.800 € = DAT EK ± 1.900 |

### Marken-Kanonisierung (Dubletten zusammenführen)
`vw→Volkswagen`, `mercedes→Mercedes-Benz`, `mini→MINI`, `citroen→Citroën`, `xpeng/XPeng→Xpeng`, `MAXUS→Maxus`, `ds→DS Automobiles`, `gwm (great wall motor)→GWM`.

### Highest Bid corrected — warum
Reconciliert Grenz-/Regelbesteuerung (Differenzbesteuerung margin-taxed vs. Regelbesteuerung vat_deductible). **Kein Fee selbst nachrechnen.** Immer die corrected-Spalte als Preisbasis.

## 3. Cleaning & Filter

- Behalte Zeilen mit: gültiges `End Time`, `Make` vorhanden, `Highest Bid corrected > 0`, `List Price > 0`.
- Restwert clippen auf **5 %–120 %** (entfernt implausible Ausreißer; betrifft nur ~4 Zeilen).
- Alter für Restwert: **0–10 Jahre**.
- Bekannte Ausreißer: eine `First Registration` ergibt 56 Jahre Alter (Datenfehler); ein Auto mit 760 kW. → In Slidern die Regel **„Griff am Maximum = keine Obergrenze"** verwenden (Bounds auf ~p98 runden, Ausreißer bei offenem Filter trotzdem enthalten).

## 4. Preisindex

- Basis: `Highest Bid corrected`. **Median ist die Leitgröße** (Preise sind rechtsschief), Mittelwert nachrangig mitzeigen.
- **Rebasing: Januar 2026 = 100** (monatlich) bzw. Q1 2026 (quartalsweise). Default monatlich, weil „seit Januar" die PR-Aussage ist.
- Perioden mit **n < 5** visuell markieren (gestrichelt/grau).
- Alle Aggregationen aus den Rohzeilen rechnen, bei jedem Filterwechsel neu — nichts hardcoden.

### Ergebnis-Snapshot (aktueller Export)
- Monatlicher Median-Index (alle Daten, Jan=100): 100 → 85 (Feb) → 90 → 104 → 109 → 111 → 105 → 108/109 → **113 (Sep\*)**.
- **Roh +13,2 % seit Januar; mix-bereinigt nur ~+7,5 %** (siehe §5).

## 5. Mix-Effekt & Bereinigung (zentral!)

Der Roh-Index vermischt echte Marktbewegung mit **Veränderung der Fahrzeug-Zusammensetzung**. Zwei Methoden:

### a) Hedonische Regression (Effekt je Merkmal auf Highest Bid, €)
`age_months −143 · km/1000 −79 · list/1000 +207 · battery_kwh +182 · accident_free +657`
- **Treiben Index HOCH (Composition/Auswahl):** Listenpreis, Unfallfrei-Anteil.
- **Drücken Index RUNTER (natürliche Flottenreifung):** Alter, Laufleistung — der deutsche EV-Bestand reift, Autos werden älter/mehr-gefahren. → der Preis steigt *trotz* schlechterer Autos = echtes Signal wird eher **unterschätzt**.
- Alters-/km-Drag Jan→Sep ≈ **−5,7 Indexpunkte**.
- Mix-bereinigter Index (Monats-Dummies, alle Merkmale konstant): Sep ≈ **107,5** vs. roh 113,2.

### b) Post-Stratifizierung / Gewichtung (bevorzugt, kein Datenverlust)
- Referenz-„Warenkorb" = **Median der Anteile April–September** je Band (bewusst OHNE das verzerrte Feb/Mär).
- `Gewicht(Band, Monat) = Referenz_Anteil / Monats_Anteil`. Übervertretene günstige Autos → Gewicht < 1.
- **Gewichte kappen auf [0,2 … 5,0]** (dünne Zellen erzeugen sonst extreme Gewichte).
- Gewichteten Median rechnen (jedes Auto zählt „Gewicht"-mal).
- **Nur nach kWh gewichten**, NICHT nach DAT EK — DAT EK ist ein Preis-Proxy, Gewichtung damit wäre halb-zirkulär und drückt das Signal künstlich auf ~0.
- Ergebnis kWh-gewichtet: Feb 85→93, Sep 113→~111.

### Löschen vs. Gewichten
Löschen (z. B. „alle < 60 kWh raus") ist **zu extrem** und verzerrt (Selektions-Bias, Nenner schrumpft → man müsste ~20–25 % der Feb/Mär-Autos entfernen). **Gewichtung ist die richtige Methode.** Falls doch Trimmen: nur den Überhang des `<15k`-Bands auf die Apr–Sep-Obergrenze kappen (Jan 3, Feb 27, Mär 25 Autos), dieselbe Regel auf alle Monate anwenden.

## 6. Restwert (Residual Value)

- **Definition: `residual_% = Highest Bid corrected / new_price × 100`**, mit `new_price = list_price + special_equipment`.
- **Sonderausstattung-Entscheidung:** `List Price` enthält KEINE Sonderausstattung; `Special Equipment Price` ist separat (Median ~3.740 €, ~7 % vom Listenpreis, nur 51 % befüllt). Aufsummieren = ehrlicher Neupreis. Senkt Median-Restwert von 46,5 % → 44,1 %; trifft ausstattungsstarke Premium-Marken (BMW, Audi) stärker.
- **Wholesale-Charakter:** Es ist ein Auktions-/Großhandelswert → absolut konservativ (niedriger als Endkunden-Restwert). Vergleich & Verlauf sind valide, absolute Höhe konservativ kommunizieren.

### Restwertkurve (Markt)
- Exponential-Fit (freier Intercept): **`RV = 74,0 · e^(−0,156·t)`** (t in Jahren), R² ≈ 0,38, Halbwertszeit ~4,4 J.
- Linear: **`RV = 67,8 − 6,48·t`**, R² ≈ 0,40.
- **Fit auf Einzelfahrzeugen** (granular), nicht auf Jahres-Medianen (gewichtet automatisch nach Datenmenge, stabiler an dünnen Rändern).
- Robuster Bereich: **0,5–8 Jahre** (n ≥ 15 je Band). Verlässlichste Zone Jahr 2–6.
- Monatsauflösung nur auf **Markt-Ebene** robust (nicht pro Marke).
- Anker 100 % bei t=0 ist **definitorisch** (Neupreis), kein gemessener Wert → erstes Segment ist Verbindungslinie.

### Restwert je Marke
- **Alters-standardisiert bei 3–4 Jahren** vergleichen (sonst verzerrt unterschiedliches Flottenalter — z. B. Volvo wirkte nur wegen jüngerer Flotte gut).
- Lineare Funktionen je Marke vorhanden (Slope = pp Verlust/Jahr). Bekannte Reihenfolge: Tesla/Škoda/Kia/Cupra oben; Audi, Franzosen (Renault/Peugeot/Citroën), Opel, Aiways unten.
- Ranking bei 3–4 J (Neupreis inkl. SA), nur n ≥ 60: Tesla 52 % … Opel 33 %.

### Alter vs. Laufleistung
- **Alter erklärt Restwert stark** (R² ~0,38), **km schwach** (R² ~0,06; ~1,4 pp/10.000 km im Markt).
- Alter und km sind **stark korreliert** → einzelne Kurven doppeln sich. Für eine echte Bewertungsformel: **gemeinsames Modell `RV = a − b·Alter − c·km`** (offener nächster Schritt).

## 7. Band-Definitionen (für Mix-Charts)

- **Batterie (kWh):** `<20, 20–40, 40–60, 60–80, 80–100, 100+`. Kern 60–80 kWh ist ~55 % und stabilster Teil.
- **DAT EK (€):** `<15k, 15–20k, 20–30k, 30–40k, 40–50k, 50–60k, 60k+`.
- **km:** 10k-Schritte bis `70k+`.

## 8. KPI-Stabilität (welche Merkmale sind über die Zeit stabil?)

| KPI | Stabil? | Muster |
|---|---|---|
| Batterie | **stabil** | Median 75 kWh, nur Feb/Mär-Delle |
| Alter | driftet | +15 % (Flottenreifung, natürlich) |
| Laufleistung | driftet | +18 % (natürlich) |
| Listenpreis | driftet | Sprung Feb→Apr, dann Plateau (Auswahl) |
| Unfallfrei-Anteil | driftet | 64 % → 57 % |

→ Für einen sauberen Index **festes Segment fixieren** (60–80 kWh, unfallfrei, Alters-/km-Fenster) oder gewichten. Batterie ist das beste (preis-unabhängige) Anker-Merkmal; DAT EK ist am stärksten manipuliert und preis-nah.

## 9. Die Valuation-Änderung (erklärt Feb/Mär + Teil des Anstiegs)

Notion „Increase Valuation for cheaper cars" (Ziel real: Bewertung **senken**):
- Delta zur DAT-EK-Bewertung auf **−2.200 €** für günstige Autos; zuerst **DAT EK < 15.000**, später **bis 20.000**.
- Termine: **26.02.** vorgeschlagen/festgelegt · **30.03.** verifiziert · **08.04.** auf 20k ausgeweitet.
- Wirkung in Auktionsdaten **ab April** (M1→Auktion-Verzug).
- Effekt: Anteil **DAT EK < 20k von ~44 % (Feb/Mär) → ~28 % (ab April)**; Median-Batterie/-Listenpreis/-Gebot steigen.
- → Feb/Mär-Tief war großteils Mix; ein spürbarer Teil des „+13 %" ist dieser bewusste Mix-Shift, kein reiner Markt.

## 10. Herkunftsland-Mapping (Marke → Land)

Nach Marken-Heimat (nicht heutiger Eigentümer). Strittige, dokumentierte Fälle: **MG→China**, **Polestar→Schweden**, **Volvo→Schweden**, **MINI→UK**, **Opel→Deutschland**, **Smart→Deutschland**, **Dacia→Rumänien**.
- DE: VW, BMW, Mercedes-Benz, Audi, Opel, Smart, Porsche
- KR: Hyundai, Kia, Genesis, Ssangyong · FR: Renault, Peugeot, Citroën, DS · IT: Fiat, Abarth, Alfa Romeo, Maserati
- CN: MG, Aiways, BYD, Xpeng, Nio, DFSK, Maxus, GWM, Leapmotor · SE: Volvo, Polestar
- USA: Tesla, Ford, Jeep, Cadillac · JP: Nissan, Mazda, Toyota, Honda, Subaru, Lexus
- UK: MINI, Jaguar, Lotus · ES: Cupra, Seat · CZ: Skoda · RO: Dacia

## 11. Validierungs-KPIs (entscheidet, ob Ergebnisse teilbar sind)

1. **Bootstrap-Konfidenzintervall des Medians** (95 %). Nicht überlappende KIs zweier Gruppen → Unterschied teilbar.
2. **Mann-Whitney-U-Test** (nichtparametrisch; NICHT t-Test wegen Schiefe). p < 0,05 = signifikant.
3. **Effektstärke** (rank-biserial): Signifikanz ≠ Relevanz. Bei großem n wird fast alles signifikant.
4. **R²** bei Funktionen/Regressionen.
5. **n-Schwellen:** < 5 nicht zeigen · 5–30 nur mit Vorbehalt · > 30 ok · > 100 solide.
6. **Standardfehler des Medians**, **CV / IQR** (Streuung), **Coverage** (Feld-Befüllung).
7. Nicht-rechenbare Risiken als Vorbehalt: **Selektions-Bias** (nur Auktions-Autos), **Confounding/Mix**, **Teilmonate**.

### Ampel zum Teilen
| Grün | Gelb | Rot |
|---|---|---|
| n > 100 | 30–100 | < 30 |
| KIs getrennt | KIs berühren sich | KIs überlappen |
| p<0,05 + relevanter Effekt | signifikant, winziger Effekt | n.s. |
| Kontrollvariablen konstant | leichter Mix-Shift | starker Mix-Shift |

### Beispiel Tesla Q1 (Jan–Mär) vs. Q3 (Jul–Sep) → alles grün
- n=501 / 614; Median 27.100 € (KI 26.418–27.965) vs. 28.799 € (KI 28.200–29.500) — **KIs getrennt**; Mann-Whitney p ≈ 6·10⁻⁶.
- **Fahrzeugprofil konstant** (Batterie/Listenpreis/Leistung/Unfallfrei unverändert) → Mix-Effekt entfällt → **echtes Preissignal +6,3 %** (real eher mehr, da Q3-Autos älter/mehr km). Gebote/Auktion 3→5 (Nachfrage steigt).
- Kontrast: Gesamtmarkt-Index = **gelb** (Mix-Shift) → nur bereinigt teilen.

## 12. Präsentation: intern vs. Presse

- **Intern (Dashboard, interaktiv):** Filter, R², DAT EK, Gewichts-Tabellen, alle Sektionen. Werkzeug zum Analysieren.
- **Presse (statisch):** eine Aussage / eine Grafik / eine zitierbare Zahl. n als Glaubwürdigkeits-Anker featuren („4.768 echte Auktionen"). Eine Akzentfarbe, direkte Beschriftung statt Legende, eine Methodik-Zeile. **Weglassen:** R², DAT EK, Filter, Gewichts-Tabellen, km-Chart (schwaches R²), unbereinigter Preisindex.
- Presse-Ranking nur **n ≥ 60** Marken (robust & bekannt).
- Presse-Storys priorisieren: (1) Marken-Restwert-Ranking, (2) Restwertkurve „so verlieren EVs an Wert". Preisindex nur bereinigt und klar gelabelt.

## 13. Master-Vorbehalte (immer mitkommunizieren)

1. **Selektions-Bias** — nur Autos, die in die Auktion kamen; nicht der Gesamtmarkt.
2. **Wholesale** — Auktionspreise, konservativ vs. Endkunde.
3. **Mix-Effekt** — Gesamtindex nur bereinigt teilen.
4. **Sonderausstattung** nur 51 % Coverage — leeres Feld = „0 €" *oder* „unbekannt"? **Mit Marco/Lukas klären.**
5. **DAT EK** nur Proxy (Range-Mitte), Januar-Coverage nur 31 %.
6. **September Teilmonat** (bis 18.).
7. **km schwacher Prädiktor** (R² ~0,06); Alter/km korreliert.

## 14. Repo-Struktur (dieses Projekt)

Angepasst an den Aampere-Standard-Stack (TypeScript statt Python):

```
ev-resale-index/
├── data/                 # CSV-Exporte (Metabase), manuell abgelegt
├── src/
│   ├── build.ts          # Einstiegspunkt: liest CSV, ruft die Pipeline auf
│   ├── load.ts            # Feld-Mapping (§2), Cleaning (§3), Kanonisierung
│   ├── pricing.ts          # Preisindex (§4) + Mix-Gewichtung (§5)
│   ├── residual.ts        # Restwert-Funktionen (§6): Kurve, Marken, alters-standardisiert
│   ├── mix.ts              # Batterie-/DAT-EK-/Länder-Mix (§7, §10)
│   ├── validate.ts         # Validierungs-KPIs + Ampel (§11)
│   └── viz.ts               # HTML-Dashboards (intern + Presse, §12)
├── outputs/               # generiertes HTML, von GitHub Pages ausgeliefert
├── reference/              # Original-Mockup (Design-/Interaktions-Referenz)
└── docs/
    ├── methodology.md      # dieses Dokument
    ├── roadmap.md
    └── architecture.md
```

Monatliches Update: neuen Export in `data/`, `npm run build` laufen lassen → aktualisierte Dashboards, commit + push → GitHub Pages aktualisiert sich automatisch.

## 15. Offene nächste Schritte

- [ ] Sonderausstattung: leer = 0 oder unbekannt? (Marco/Lukas)
- [ ] 2D-Restwertfunktion `RV = f(Alter, km)` je Marke → echte Bewertungsformel.
- [ ] Mix-adjustierten Index als feste zweite Linie im Dashboard.
- [ ] Konfidenzbänder + n-Ampel automatisch in alle Grafiken.
- [ ] Automatischer Metabase-Pull statt manuellem Export.
