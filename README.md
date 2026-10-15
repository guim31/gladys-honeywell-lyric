# Honeywell Home (Lyric) for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for the **Honeywell Home /
Resideo** Wi-Fi thermostats of the Lyric and T-series ranges (Lyric Round, T5, T6, T9, T10), and
the room sensors of the T9 and T10. It uses the official Resideo cloud API
([developer.honeywellhome.com](https://developer.honeywellhome.com/)), with a free developer app
the user creates, like the Home Assistant `lyric` integration.

It is distinct from the Total Connect Comfort thermostats (another API, another integration) and
from evohome.

**Developed without the hardware: feedback welcome.** The code was written and tested against
the payloads published by aiolyric and Home Assistant, never against a real thermostat or a
real Resideo account. Please report what works and what does not in the
[issues](https://github.com/guim31/gladys-honeywell-lyric/issues).

## Features

One Gladys device per thermostat, named as in the Resideo app:

- temperature, indoor humidity, outdoor temperature (when the thermostat gives them);
- heating and cooling setpoints, within the real bounds of the thermostat, in its own unit
  (°C or °F), rounded to its step (0.5 °C, 1 °F);
- mode (off, heating, cooling, auto) restricted to what the thermostat allows, including the
  two-step "auto" of the Lyric Round;
- equipment state (idle, heating, cooling);
- schedule (T5, T6, T9, T10): follow the schedule, temporary or permanent hold; "hold until"
  and "vacation" are shown;
- T9/T10 room sensors: temperature, humidity and presence of each room with a sensor;
- a cloud / unreachable badge per thermostat.

Scenes (Gladys 5.1+):

- triggers **Thermostat offline**, **Thermostat back online**, **Honeywell Home sign-in lost**;
- actions **Resume the thermostat schedule** (one or every thermostat) and **Hold a thermostat
  temperature** (until the next schedule period or permanently).

No dedicated widget: the **Devices** widget of Gladys already shows and drives the features.

## Requirements

- Gladys Assistant **5.1.0** or later.
- A thermostat working in the Resideo (Honeywell Home) app.
- A free Resideo developer account and app (consumer key and secret), with the callback URL
  `https://my.gladysassistant.com/redirect/oauth`. The [documentation](docs/en.md) walks
  through every step.

## Installation

In Gladys: **Integrations → Install from GitHub**, enter
`https://github.com/guim31/gladys-honeywell-lyric`, then open the **Configuration** tab:

1. paste the consumer key and secret of your Resideo app, save;
2. click **Connect**, sign in to Honeywell Home and tick your thermostats;
3. add the thermostats from the **Discover** tab.

If the redirect cannot come back to Gladys, a fallback lets you paste the code shown in the
browser address bar (see the documentation).

Documentation: [English](docs/en.md) · [Français](docs/fr.md) · [Deutsch](docs/de.md) ·
[Español](docs/es.md).

## How it works

- **Sign-in**: OAuth2 authorization code with the user's own consumer key and secret
  (`https://api.honeywellhome.com/oauth2/authorize`, then `/oauth2/token` with Basic auth). The
  "Connect" button of Gladys relays the flow through its HTTPS redirect page. The tokens are
  kept in `/data/resideo-tokens.json` (mode 0600), refreshed before they expire, and refreshed
  once more on a 401.
- **Reading**: every 5 minutes, by a timer of the container (Gladys does not poll external
  devices reliably, GladysAssistant/Gladys#3198): one `GET /v2/locations` for every thermostat
  of every location, plus one `GET /v2/devices/thermostats/{id}/priority` per thermostat with
  room data (a thermostat answering `GetPriorityFailed` is not asked again). A command adds its
  `POST /v2/devices/thermostats/{id}` and one reading 15 s later. A 429 doubles the interval,
  up to 30 minutes. Only changed values are published, plus a heartbeat every 6 hours.
- **Writing**: every changeable value is sent, the unchanged ones copied from the last reading,
  and a setpoint changed while following the schedule becomes a temporary hold (as aiolyric
  does).
- **Logs**: nothing at the info level for a normal reading; one line when a problem starts and
  one when it ends; never a token, the secret or a URL carrying the key.

## Not checked on real hardware

Everything rests on published payloads, so these points remain to confirm with a real account:

- the Resideo developer portal still lets anyone create an app, and accepts the Gladys redirect
  page as callback URL;
- the shape of the token answer (`expires_in` as a string, refresh token rotation);
- the exact quota of a developer app, and the answer when it is exceeded;
- the unit of the room sensors of a thermostat set to °C (taken as °F above 45);
- the two writes the Lyric Round needs to switch from off to auto.

`scripts/probe.mjs` runs the real sign-in until Resideo refuses a fake key, printing statuses
only, to check what the API answers from a machine that can reach it.

## Limitations

- Cloud only: nothing works without Internet access or when the Resideo cloud is down.
- Changes made on the thermostat or in the Resideo app reach Gladys within 5 minutes.
- Not covered: the fan mode, the vacation and "hold until" settings, the schedule itself, the
  Resideo water leak detectors and cameras, Total Connect Comfort and evohome systems.
- Feature names are frozen by Gladys when a device is added.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
node scripts/probe.mjs        # needs network access to api.honeywellhome.com
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`) and an
in-memory Resideo API (`test/helpers/fakeResideo.js`) fed with the payloads of aiolyric and Home
Assistant (`test/fixtures/resideo/`). See [`CLAUDE.md`](CLAUDE.md) for the project rules.

Releases are made by the Release workflow (Actions → Release), which bumps `package.json`, the
manifest `version` and the `docker_image` tag together. Hand-pushed tag path: bump the three by
hand in one commit, then push a `v<version>` tag.

## Credits

- [aiolyric](https://github.com/timmo001/aiolyric) by Aidan Timson (timmo001) and contributors
  (Apache-2.0): the API endpoints, the write rules and the test payloads (re-used, anonymised,
  in `test/fixtures/resideo/`).
- Home Assistant's
  [`lyric`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/lyric)
  integration (Apache-2.0): the OAuth2 details (Basic auth, `appSelect`), the LCC / TCC split,
  the Lyric Round auto quirk, the `GetPriorityFailed` handling and test payloads.
- The architecture and the conformity tests follow
  [gladys-pihole](https://github.com/guim31/gladys-pihole) and
  [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Resideo Technologies or
Honeywell. "Honeywell Home" is a trademark of Honeywell International, used under license by
Resideo; "Lyric" and "Resideo" are trademarks of their owners.

## License

[Apache-2.0](LICENSE)
