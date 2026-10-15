// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`), one per key. They receive
// the RESOLVED fields (scene variables substituted, defaults applied) and
// return the declared outputs. A thrown error fails that action only.
//
// What they add to the standard "control a device" action of Gladys: one
// action for every thermostat at once (back to the schedule when everyone
// leaves), and a setpoint held permanently in one write, where the device
// feature only gives a temporary hold.
// -----------------------------------------------------------------------------

import { ACTION_TEXT } from './texts.js';
import { THERMOSTAT_MODE, currentMode, canHeat, isLcc, HOLD } from './resideo/model.js';

export const HOLD_CHOICES = Object.freeze({
  temporary: HOLD.TEMPORARY,
  permanent: HOLD.PERMANENT,
});

export const SCENE_ACTIONS = {
  /** Every thermostat (or one) follows its schedule again. */
  async resume_schedule(hub, { fields = {} }) {
    const thermostats = hub.targets(fields.device).filter((thermostat) => isLcc(thermostat.raw));
    for (const thermostat of thermostats) {
      await hub.setHold(thermostat, 'schedule');
    }
    return { count: thermostats.length };
  },

  /**
   * Hold a temperature: the heating setpoint, or the cooling one when the
   * thermostat is cooling (or cannot heat).
   */
  async hold_temperature(hub, { fields = {} }) {
    if (!fields.device) {
      throw hub.fail(ACTION_TEXT.chooseThermostat);
    }
    const [thermostat] = hub.targets(fields.device);
    const kind =
      currentMode(thermostat.raw) === THERMOSTAT_MODE.COOLING || !canHeat(thermostat.raw)
        ? 'cool'
        : 'heat';
    const hold = HOLD_CHOICES[fields.hold] ?? HOLD_CHOICES.temporary;
    const setpoint = await hub.setSetpoint(thermostat, kind, fields.temperature, hold);
    return { setpoint };
  },
};
