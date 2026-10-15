// -----------------------------------------------------------------------------
// Every text the integration sends to Gladys: feature names, option labels,
// connection status, action and scene messages. Four languages, the four of
// the Gladys interface; German says "du", Spanish "usted". Vocabulary from
// the Gladys front (front/src/config/i18n). test/i18n.test.js checks every
// table. `{name}` placeholders are filled by format().
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './resideo/client.js';

export const LANGS = ['en', 'fr', 'de', 'es'];

/** The text of `table` in `language`, English when missing. */
export const pick = (table, language) => table?.[language] ?? table?.en ?? '';

/** Fill the `{name}` placeholders of a text. */
export const format = (text, values = {}) =>
  text.replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));

/** A multi-language object from a table and placeholder values. */
export const localized = (table, values) =>
  Object.fromEntries(LANGS.map((language) => [language, format(pick(table, language), values)]));

// Feature names: frozen by Gladys when the device is created.
export const NAMES = {
  en: {
    temperature: 'Temperature',
    humidity: 'Humidity',
    outdoor_temperature: 'Outdoor temperature',
    heat_setpoint: 'Heating setpoint',
    cool_setpoint: 'Cooling setpoint',
    mode: 'Mode',
    operating_state: 'Equipment state',
    hold: 'Schedule',
    room_temperature: '{room} temperature',
    room_humidity: '{room} humidity',
    room_presence: '{room} presence',
  },
  fr: {
    temperature: 'Température',
    humidity: 'Humidité',
    outdoor_temperature: 'Température extérieure',
    heat_setpoint: 'Consigne chauffage',
    cool_setpoint: 'Consigne climatisation',
    mode: 'Mode',
    operating_state: "État de l'équipement",
    hold: 'Programme',
    room_temperature: 'Température {room}',
    room_humidity: 'Humidité {room}',
    room_presence: 'Présence {room}',
  },
  de: {
    temperature: 'Temperatur',
    humidity: 'Luftfeuchtigkeit',
    outdoor_temperature: 'Außentemperatur',
    heat_setpoint: 'Solltemperatur Heizen',
    cool_setpoint: 'Solltemperatur Kühlen',
    mode: 'Modus',
    operating_state: 'Betriebszustand',
    hold: 'Zeitplan',
    room_temperature: 'Temperatur {room}',
    room_humidity: 'Luftfeuchtigkeit {room}',
    room_presence: 'Anwesenheit {room}',
  },
  es: {
    temperature: 'Temperatura',
    humidity: 'Humedad',
    outdoor_temperature: 'Temperatura exterior',
    heat_setpoint: 'Consigna de calefacción',
    cool_setpoint: 'Consigna de refrigeración',
    mode: 'Modo',
    operating_state: 'Estado del equipo',
    hold: 'Programación',
    room_temperature: 'Temperatura {room}',
    room_humidity: 'Humedad {room}',
    room_presence: 'Presencia {room}',
  },
};

// Labels of the mode options (thermostat/mode, Gladys THERMOSTAT_MODE values).
export const MODE_LABELS = {
  en: { 0: 'Off', 1: 'Heating', 2: 'Cooling', 3: 'Auto' },
  fr: { 0: 'Arrêt', 1: 'Chauffage', 2: 'Climatisation', 3: 'Auto' },
  de: { 0: 'Aus', 1: 'Heizen', 2: 'Kühlen', 3: 'Auto' },
  es: { 0: 'Apagado', 1: 'Calefacción', 2: 'Refrigeración', 3: 'Automático' },
};

// Labels of the schedule options (text/select, keys of HOLD_OPTIONS).
export const HOLD_LABELS = {
  en: {
    schedule: 'Follow the schedule',
    temporary: 'Temporary hold',
    permanent: 'Permanent hold',
    hold_until: 'Hold until a time',
    vacation: 'Vacation hold',
  },
  fr: {
    schedule: 'Suivre le programme',
    temporary: 'Dérogation temporaire',
    permanent: 'Dérogation permanente',
    hold_until: "Dérogation jusqu'à une heure",
    vacation: 'Vacances',
  },
  de: {
    schedule: 'Zeitplan folgen',
    temporary: 'Vorübergehend halten',
    permanent: 'Dauerhaft halten',
    hold_until: 'Halten bis Uhrzeit',
    vacation: 'Urlaub',
  },
  es: {
    schedule: 'Seguir la programación',
    temporary: 'Retención temporal',
    permanent: 'Retención permanente',
    hold_until: 'Retención hasta una hora',
    vacation: 'Vacaciones',
  },
};

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// Connection status under the integration name, and the error part of reports.
export const STATUS_TEXT = {
  [ERROR_KINDS.NOT_CONFIGURED]: {
    en: 'Enter the consumer key and secret of your Resideo developer app.',
    fr: 'Saisissez la clé et le secret de votre application développeur Resideo.',
    de: 'Gib den Schlüssel und das Secret deiner Resideo-Entwickler-App ein.',
    es: 'Introduzca la clave y el secreto de su aplicación de desarrollador de Resideo.',
  },
  [ERROR_KINDS.NOT_CONNECTED]: {
    en: 'Click "Connect" to sign in to your Honeywell Home account.',
    fr: 'Cliquez sur « Connecter » pour vous connecter à votre compte Honeywell Home.',
    de: 'Klicke auf „Verbinden“, um dich bei deinem Honeywell-Home-Konto anzumelden.',
    es: 'Haga clic en «Conectar» para iniciar sesión en su cuenta Honeywell Home.',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'Resideo refused the sign-in: click "Connect" again.',
    fr: 'Resideo a refusé la connexion : cliquez de nouveau sur « Connecter ».',
    de: 'Resideo hat die Anmeldung abgelehnt: Klicke erneut auf „Verbinden“.',
    es: 'Resideo ha rechazado el inicio de sesión: haga clic de nuevo en «Conectar».',
  },
  [ERROR_KINDS.RATE_LIMIT]: {
    en: 'Resideo API quota reached: readings are slowed down.',
    fr: "Quota de l'API Resideo atteint : les relevés sont espacés.",
    de: 'Kontingent der Resideo-API erreicht: Abfragen werden verlangsamt.',
    es: 'Cuota de la API de Resideo alcanzada: las lecturas se espacian.',
  },
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'The Resideo cloud does not answer.',
    fr: 'Le cloud Resideo ne répond pas.',
    de: 'Die Resideo-Cloud antwortet nicht.',
    es: 'La nube de Resideo no responde.',
  },
  [ERROR_KINDS.REFUSED]: {
    en: 'Resideo refused the request.',
    fr: 'Resideo a refusé la requête.',
    de: 'Resideo hat die Anfrage abgelehnt.',
    es: 'Resideo ha rechazado la solicitud.',
  },
};

export const CONNECTION_TEXT = {
  noThermostat: {
    en: 'Connected, but this account has no thermostat.',
    fr: "Connecté, mais ce compte n'a aucun thermostat.",
    de: 'Verbunden, aber dieses Konto hat kein Thermostat.',
    es: 'Conectado, pero esta cuenta no tiene ningún termostato.',
  },
  invalidCallback: {
    en: 'Callback URL not understood: it must start with https://',
    fr: 'URL de rappel incomprise : elle doit commencer par https://',
    de: 'Callback-URL nicht verstanden, erwartet wird https://…',
    es: 'URL de retorno no válida: debe empezar por https://',
  },
};

// Messages of the configuration actions, of the commands and of the scene actions.
export const ACTION_TEXT = {
  connected: {
    en: 'Connected to Resideo: {count} thermostat(s).',
    fr: 'Connecté à Resideo : {count} thermostat(s).',
    de: 'Mit Resideo verbunden: {count} Thermostat(e).',
    es: 'Conectado a Resideo: {count} termostato(s).',
  },
  noCode: {
    en: 'No authorization code found in the pasted text.',
    fr: "Aucun code d'autorisation trouvé dans le texte collé.",
    de: 'Kein Autorisierungscode im eingefügten Text gefunden.',
    es: 'No se ha encontrado ningún código de autorización en el texto pegado.',
  },
  noCallback: {
    en: 'Fill in the callback URL in the configuration first, then click "Connect".',
    fr: "Renseignez d'abord l'URL de rappel dans la configuration, puis cliquez sur « Connecter ».",
    de: 'Trag zuerst die Callback-URL in der Konfiguration ein und klicke dann auf „Verbinden“.',
    es: 'Indique primero la URL de retorno en la configuración y luego haga clic en «Conectar».',
  },
  stateMismatch: {
    en: 'This sign-in link is outdated: click "Connect" again.',
    fr: 'Ce lien de connexion est périmé : cliquez de nouveau sur « Connecter ».',
    de: 'Dieser Anmeldelink ist veraltet: Klicke erneut auf „Verbinden“.',
    es: 'Este enlace de inicio de sesión ha caducado: haga clic de nuevo en «Conectar».',
  },
  codeRefused: {
    en: 'Resideo refused the code: it is valid only once and for a few minutes.',
    fr: "Resideo a refusé le code : il n'est valable qu'une fois et quelques minutes.",
    de: 'Resideo hat den Code abgelehnt: Er gilt nur einmal und nur wenige Minuten.',
    es: 'Resideo ha rechazado el código: solo es válido una vez y durante unos minutos.',
  },
  unknownThermostat: {
    en: 'Unknown thermostat: search for devices again.',
    fr: 'Thermostat inconnu : relancez la recherche des appareils.',
    de: 'Unbekanntes Thermostat: Suche erneut nach Geräten.',
    es: 'Termostato desconocido: vuelva a buscar los dispositivos.',
  },
  chooseThermostat: {
    en: 'Choose a thermostat.',
    fr: 'Choisissez un thermostat.',
    de: 'Wähle ein Thermostat.',
    es: 'Elija un termostato.',
  },
  noThermostat: {
    en: 'No thermostat to act on.',
    fr: 'Aucun thermostat sur lequel agir.',
    de: 'Kein Thermostat, auf das reagiert werden kann.',
    es: 'No hay ningún termostato sobre el que actuar.',
  },
  thermostatOff: {
    en: 'The thermostat is off: choose a mode first.',
    fr: "Le thermostat est à l'arrêt : choisissez d'abord un mode.",
    de: 'Das Thermostat ist aus: Wähle zuerst einen Modus.',
    es: 'El termostato está apagado: elija primero un modo.',
  },
  modeUnsupported: {
    en: 'This thermostat does not offer this mode.',
    fr: 'Ce thermostat ne propose pas ce mode.',
    de: 'Dieses Thermostat bietet diesen Modus nicht an.',
    es: 'Este termostato no ofrece este modo.',
  },
  holdUnsupported: {
    en: 'This thermostat has no schedule hold (Lyric Round).',
    fr: "Ce thermostat n'a pas de dérogation au programme (Lyric Round).",
    de: 'Dieses Thermostat kennt kein Halten des Zeitplans (Lyric Round).',
    es: 'Este termostato no admite retención de la programación (Lyric Round).',
  },
  holdInApp: {
    en: 'This schedule mode is set in the Resideo app.',
    fr: "Ce mode de programme se règle dans l'application Resideo.",
    de: 'Dieser Zeitplanmodus wird in der Resideo-App eingestellt.',
    es: 'Este modo de programación se ajusta en la aplicación de Resideo.',
  },
  deadband: {
    en: 'In auto mode, keep {gap}° between the heating and cooling setpoints.',
    fr: 'En mode auto, gardez {gap}° entre les consignes de chauffage et de climatisation.',
    de: 'Im Auto-Modus müssen {gap}° zwischen den Solltemperaturen Heizen und Kühlen liegen.',
    es: 'En modo automático, mantenga {gap}° entre las consignas de calefacción y de refrigeración.',
  },
  invalidTemperature: {
    en: 'Temperature not understood, e.g. 19.5',
    fr: 'Température incomprise, ex. 19,5',
    de: 'Temperatur nicht verstanden, z. B. 19,5',
    es: 'Temperatura no válida, p. ej. 19,5',
  },
  failed: {
    en: 'Resideo refused the command.',
    fr: 'Resideo a refusé la commande.',
    de: 'Resideo hat den Befehl abgelehnt.',
    es: 'Resideo ha rechazado la orden.',
  },
};

// The "Test the connection" report, one line per thermostat.
export const REPORT_TEXT = {
  line: {
    en: '{name}: {temperature}, {mode}',
    fr: '{name} : {temperature}, {mode}',
    de: '{name}: {temperature}, {mode}',
    es: '{name}: {temperature}, {mode}',
  },
  offline: {
    en: '{name}: offline',
    fr: '{name} : hors ligne',
    de: '{name}: offline',
    es: '{name}: sin conexión',
  },
  rooms: {
    en: '{count} room sensor(s)',
    fr: '{count} capteur(s) de pièce',
    de: '{count} Raumsensor(en)',
    es: '{count} sensor(es) de habitación',
  },
};
