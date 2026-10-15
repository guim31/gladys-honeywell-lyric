# Resideo payloads

Real payloads published with the tests of the two projects this integration
learns from, anonymised (invented MAC addresses, location ids and device UUIDs;
no address, name or e-mail of a real person):

| File                        | Source                                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `device-t6-celsius.json`    | aiolyric `tests/__init__.py`, `RESPONSE_JSON_DEVICE` (T5-T6, LCC, Celsius, heat only)                                      |
| `location-eu.json`          | aiolyric `RESPONSE_JSON_LOCATION`, without its device (user anonymised, geofence removed)                                  |
| `device-t9-fahrenheit.json` | Home Assistant `tests/components/lyric/fixtures/thermostat_lcc.json` and `locations.json`, in °F, in auto, with a deadband |
| `device-round-tcc.json`     | Home Assistant `tests/components/lyric/fixtures/thermostat_tcc.json` (Lyric Round, TCC)                                    |
| `priority.json`             | aiolyric `RESPONSE_JSON_PRIORITY` (current schema)                                                                         |
| `priority-classic.json`     | aiolyric `RESPONSE_JSON_PRIORITY_CLASSIC` (classic schema, aiolyric#165)                                                   |
| `priority-whole-house.json` | Home Assistant `fixtures/priority.json` (no room)                                                                          |
| `priority-unsupported.json` | Home Assistant `conftest.py`, `lyric_exception(400, "GetPriorityFailed")`                                                  |
| `token.json`                | Shape of the Resideo token answer (Apigee: `expires_in` as a string), fake values                                          |

aiolyric (timmo001/aiolyric) and Home Assistant (home-assistant/core) are both
under the Apache-2.0 license.
