# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Honeywell Home / Resideo thermostats (Lyric Round, T5, T6, T9, T10) through the
  official Resideo API, with your own free developer app: sign in with the
  **Connect** button, or paste the code from the browser address bar.
- One device per thermostat: temperature, humidity, outdoor temperature,
  heating and cooling setpoints (real bounds, °C or °F), mode (off, heating,
  cooling, auto), equipment state, and the schedule (follow it, temporary or
  permanent hold).
- The room sensors of the T9 and T10: temperature, humidity and presence of
  each room.
- Scene triggers **Thermostat offline**, **Thermostat back online** and
  **Honeywell Home sign-in lost**; scene actions **Resume the thermostat
  schedule** and **Hold a thermostat temperature** (Gladys 5.1.0 or later).
- The thermostats are read every 5 minutes, within the quota of the Resideo
  API, and slow down on their own when Resideo reports the quota reached.
- Feature names, messages and documentation in English, French, German and
  Spanish.

[Unreleased]: https://github.com/guim31/gladys-honeywell-lyric/commits/main
