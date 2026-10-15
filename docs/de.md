# Honeywell Home (Lyric)

Diese Integration bringt deine WLAN-Thermostate von **Honeywell Home / Resideo** in Gladys:
Lyric Round, T5, T6, T9 und T10 sowie die Raumsensoren der T9/T10. Die Integration nutzt die offizielle
Cloud-API von Resideo mit einer kostenlosen Entwickler-App, die du selbst anlegst, wie die
Home-Assistant-Integration `lyric`. Du bekommst Temperatur, Luftfeuchtigkeit, Solltemperaturen,
Modus, Betriebszustand und Zeitplan jedes Thermostats und steuerst sie über das Dashboard und
über Szenen.

Die Integration ist nicht für die älteren Honeywell-Thermostate **Total Connect Comfort** (eine andere API)
und nicht für evohome-Systeme gedacht.

Diese Integration ist nicht mit Resideo oder Honeywell verbunden. Ohne die Hardware entwickelt:
Rückmeldungen sind auf [GitHub](https://github.com/guim31/gladys-honeywell-lyric/issues)
willkommen.

## Was du brauchst

- Gladys 5.1 oder neuer, mit Internetzugang.
- Ein Thermostat, das in der **Resideo**-App (Honeywell Home) bereits funktioniert.
- Ein kostenloses Konto auf der [Resideo-Entwicklerseite](https://developer.honeywellhome.com/),
  um deine eigene App anzulegen: Resideo gibt Drittsoftware keinen gemeinsamen Schlüssel.

## Einrichtung

### 1. Leg deine Resideo-Entwickler-App an

1. Registriere dich auf [developer.honeywellhome.com](https://developer.honeywellhome.com/)
   (beliebige E-Mail-Adresse) und melde dich an.
2. Öffne **My Apps** und dann **Create New App**.
3. **App Name**: beliebig, zum Beispiel `Gladys`.
4. **Callback URL**: `https://my.gladysassistant.com/redirect/oauth` (die HTTPS-Seite, über die
   Gladys dich nach der Anmeldung zu deinem eigenen Gladys zurückbringt).
5. Speichere. Öffne deine App in **My Apps**: Die App zeigt einen **Consumer Key** und ein
   **Consumer Secret**. Eine neue App kann eine Weile „ausstehend“ sein, bevor Resideo sie
   annimmt.

### 2. Gib Schlüssel und Secret ein

Öffne in Gladys **Integrationen → Honeywell Home (Lyric) → Konfiguration**, füge den
**Consumer Key (Schlüssel)** und das **Consumer Secret (Geheimnis)** ein, wähle die **Sprache
der Funktionsnamen** und klicke auf **Speichern**.

### 3. Verbinde dein Konto

Klicke neben **Honeywell-Home-Konto** auf **Verbinden**. Resideo öffnet seine Anmeldeseite:
Melde dich mit dem Konto der Resideo-App an, wähle die Thermostate aus, die Gladys verwenden
darf, und bestätige. Du kommst zu Gladys zurück, und wenige Sekunden später zeigt der Status,
dass die Integration verbunden ist. Die Thermostate stehen dann im Tab **Entdecken**: Füge sie
hinzu.

Unter **Verbinden** zeigt der Konfigurationsbildschirm die **Weiterleitungsadresse, die in der
Entwickler-Anwendung einzutragen ist**: `https://my.gladysassistant.com/redirect/oauth`. Wenn
du Gladys über HTTPS erreichst und **Stattdessen die Adresse meiner Instanz verwenden**
aktivierst, zeigt er stattdessen die Adresse deiner Instanz: Trag dann diese als Callback URL
deiner Resideo-App ein.

### Falls Verbinden nicht zu Gladys zurückkehrt

Nutze stattdessen den eingefügten Code:

1. Setze in deiner Resideo-App die **Callback URL** auf `https://localhost/`.
2. Trag in Gladys dieselbe Adresse unter **Callback-URL (eingefügter Code)** ein, speichere
   und klicke auf **Verbinden**.
3. Nach der Anmeldung zeigt der Browser eine Fehlerseite auf `localhost`: Das ist normal.
   Kopiere die ganze Adresse aus der Adressleiste (sie enthält `?code=…`).
4. Füge sie innerhalb weniger Minuten (ein Code gilt nur einmal und nur kurz) in die Aktion
   **Autorisierungscode einfügen** des Konfigurationsbildschirms ein und führe sie aus. Die
   Antwort lautet zum Beispiel „Mit Resideo verbunden: 2 Thermostat(e).“.

Die Tokens werden unter `/data` gespeichert: Du verbindest dich nur neu, wenn Resideo sie
ablehnt.

## Das Gerät jedes Thermostats

Ein Gerät pro Thermostat, benannt wie in der Resideo-App. Seine Funktionen hängen vom Modell ab:

| Funktion                                                             | Bedeutung                                                                   |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `Temperatur`                                                         | Vom Thermostat gemessene Temperatur.                                        |
| `Luftfeuchtigkeit`                                                   | Luftfeuchtigkeit innen, wenn das Thermostat sie misst.                      |
| `Außentemperatur`                                                    | Außentemperatur laut Resideo (Wetter), falls vorhanden.                     |
| `Solltemperatur Heizen`                                              | Zu erreichende Temperatur beim Heizen. Änderbar.                            |
| `Solltemperatur Kühlen`                                              | Nicht zu überschreitende Temperatur beim Kühlen (Klimaanlage). Änderbar.    |
| `Modus`                                                              | `Aus`, `Heizen`, `Kühlen` oder `Auto`, je nach Thermostat. Änderbar.        |
| `Betriebszustand`                                                    | Was Heizung oder Kühlung gerade tut: inaktiv, heizt, kühlt.                 |
| `Zeitplan`                                                           | T5, T6, T9, T10: dem Zeitplan folgen oder eine Temperatur halten. Änderbar. |
| `Temperatur <Raum>`, `Luftfeuchtigkeit <Raum>`, `Anwesenheit <Raum>` | Raumsensoren der T9/T10: Mittelwert des Raums, jemand erkannt.              |

- Temperaturen und Solltemperaturen sind in der Einheit des Thermostats (°C oder °F), innerhalb
  der Grenzen, die das Thermostat angibt. Eine Solltemperatur wird auf 0,5 °C oder 1 °F
  gerundet.
- Eine Solltemperatur zu ändern, während das Thermostat dem Zeitplan folgt, hält sie
  **vorübergehend**, wie am Thermostat selbst: Der Zeitplan übernimmt wieder ab seiner nächsten
  Periode.
- Die Optionen von `Zeitplan` sind `Zeitplan folgen`, `Vorübergehend halten`,
  `Dauerhaft halten`, `Halten bis Uhrzeit` und `Urlaub`. Die letzten beiden werden angezeigt,
  aber in der Resideo-App eingestellt (sie brauchen eine Uhrzeit oder Daten).
- Im Modus `Auto` müssen die Solltemperaturen Heizen und Kühlen den Abstand einhalten, den das
  Thermostat verlangt (seine Totzone).
- Ein Lyric Round kennt über die API kein Halten des Zeitplans: Er hat keine Funktion
  `Zeitplan`. Ihn von aus auf `Auto` zu schalten, braucht zwei Schreibvorgänge im Abstand von
  drei Sekunden (eine Eigenheit der Resideo-API).
- Ein Thermostat offline zeigt das Abzeichen „nicht erreichbar“, die anderen „Cloud“.

## Dashboard

Kein eigenes Widget: Die Widgets von Gladys zeigen ein Thermostat bereits an. Füge das Widget
**Geräte** mit den Funktionen deiner Wahl hinzu: Es zeigt die Temperatur, die Solltemperaturen
mit ihren Schaltflächen, den Modus, den Zeitplan und die Raumsensoren. Die
Temperatur- und Feuchtigkeitsfunktionen passen auch in die Raumtemperatur- und
Raumfeuchtigkeits-Widgets und in die Diagramme.

## Szenen

Die Integration fügt dem Szeneneditor unter **Integrationen** eigene Karten hinzu. Die
Funktionen des Geräts funktionieren auch mit den üblichen Karten (eine Temperatur über einem
Schwellwert, Modus oder Solltemperatur setzen).

### Auslöser

- **Thermostat offline**: Resideo erreicht ein Thermostat nicht mehr (WLAN- oder
  Stromausfall). Filter: das Thermostat. Variable: der Name des Thermostats.
- **Thermostat wieder online**: Ein als offline gemeldetes Thermostat ist wieder erreichbar.
  Filter und Variable: dieselben.
- **Honeywell-Home-Anmeldung verloren**: Resideo hat die Anmeldung abgelehnt; die Thermostate
  werden erst nach erneutem Klick auf **Verbinden** wieder gelesen. Wird einmal ausgelöst.

### Aktionen

- **Zeitplan des Thermostats fortsetzen**: hebt das Halten auf, das Thermostat folgt wieder
  seinem Zeitplan. Alle Thermostate, wenn keines gewählt ist. Ergebnis: die Anzahl der
  fortgesetzten Thermostate (ein Lyric Round wird übersprungen).
- **Temperatur am Thermostat halten**: setzt die Solltemperatur Heizen (Kühlen, wenn das
  Thermostat kühlt) bis zur nächsten Zeitplanperiode oder dauerhaft. Die Temperatur wird in der
  Einheit des Thermostats eingegeben, `19.5` oder `19,5`, und kann aus einer Variablen kommen.
  Ergebnis: die angewendete Solltemperatur, gerundet und begrenzt.

### Szenenideen

- Wenn die letzte Person das Haus verlässt: **Temperatur am Thermostat halten** auf 16 °C,
  dauerhaft; wenn die erste zurückkommt: **Zeitplan des Thermostats fortsetzen**.
- **Thermostat offline**: eine Nachricht senden „{{triggerEvent.data.name}} ist offline, prüf
  Strom und WLAN“.
- **Honeywell-Home-Anmeldung verloren**: eine Nachricht senden, um die Integration neu zu
  verbinden.
- Ein Fenster länger als 10 Minuten offen: `Modus` auf `Aus` setzen; wieder geschlossen:
  zurück auf `Heizen`.

## API-Kontingent und Aktualisierung

Die Integration liest Resideo **alle 5 Minuten**: eine Anfrage für alle deine Thermostate, plus
eine pro T9/T10 für die Raumsensoren. Ein Befehl fügt seinen Schreibvorgang und eine Abfrage
15 Sekunden später hinzu. Resideo bemisst das kostenlose Kontingent einer Entwickler-App für
eine Abfrage alle 5 Minuten von bis zu 20 Geräten, mit etwas Spielraum für Änderungen. Antwortet
Resideo trotzdem „Kontingent erreicht“, wartet die Integration doppelt so lange (bis zu
30 Minuten) und kehrt dann zu 5 Minuten zurück. Ein unveränderter Wert wird trotzdem alle
6 Stunden an Gladys gesendet. Verwende eine Entwickler-App nur für Gladys.

## Fehlerbehebung

- **„Gib den Schlüssel und das Secret ein“**: Füll beide Felder aus und speichere.
- **„Klicke auf Verbinden“**: Das Konto ist noch nicht verbunden, oder der Schlüssel hat sich
  geändert: Klicke auf **Verbinden**.
- **Die Resideo-Seite meldet eine ungültige Weiterleitungs-URI**: Die Callback URL deiner
  Resideo-App muss genau `https://my.gladysassistant.com/redirect/oauth` lauten (oder die
  Adresse, die du gewählt hast, siehe oben).
- **„Resideo hat die Anmeldung abgelehnt“**: Der Zugang wurde bei Resideo widerrufen oder ist
  abgelaufen. Klicke erneut auf **Verbinden**. Prüf, ob die App in **My Apps** noch aktiv ist.
- **„Resideo hat den Code abgelehnt“**: Ein Code gilt nur einmal und nur wenige Minuten:
  Klicke erneut auf **Verbinden** und füge die neue Adresse schnell ein.
- **„Kontingent der Resideo-API erreicht“**: Eine andere Software nutzt dieselbe
  Entwickler-App, oder es sind viele Thermostate. Warte: Die Abfragen werden von selbst
  seltener.
- **Kein Raumsensor**: Nur T9 und T10 haben welche, und nur Räume mit einem Sensor erscheinen
  (der Raum des Thermostats ist das Thermostat selbst). Ein später hinzugefügter Raum erscheint
  nach **Aktualisieren** im Tab **Entdecken**.
- **Verbindung testen** (Konfigurationsbildschirm) liest Resideo sofort und listet jedes
  Thermostat mit Temperatur und Modus.
- Mehr Details in den Protokollen mit `LOG_LEVEL=debug`; dort steht nie ein Token oder Secret.

## Grenzen

- Nur Cloud: keine lokale Steuerung, und nichts funktioniert, wenn die Resideo-Cloud oder dein
  Internetzugang ausfällt.
- Änderungen von anderswo (Thermostat, Resideo-App) kommen innerhalb von 5 Minuten in Gladys
  an.
- Nicht abgedeckt: der Lüftermodus, die Urlaubseinstellungen, der Zeitplan selbst, die
  Wassermelder und Kameras von Resideo, die Systeme Total Connect Comfort und evohome.
- Die Raumsensoren liefern den Mittelwert ihres Raums. Resideo dokumentiert ihre Temperatur in
  °F: Bei einem Thermostat in °C wird ein Raumwert über 45 als °F gewertet und umgerechnet.
- Funktionsnamen werden beim Hinzufügen des Geräts festgelegt: Ein umbenannter Raum behält in
  Gladys seinen alten Namen.
