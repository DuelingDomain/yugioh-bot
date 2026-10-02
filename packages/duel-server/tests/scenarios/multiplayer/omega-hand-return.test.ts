import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { OMEGA_HAND_RETURN_SCENARIOS } from "./omega-hand-return.js";
describeWithCores("live Omega hand return", liveNseat, () => { runScenarios("multiplayer/omega-hand-return", OMEGA_HAND_RETURN_SCENARIOS); });
