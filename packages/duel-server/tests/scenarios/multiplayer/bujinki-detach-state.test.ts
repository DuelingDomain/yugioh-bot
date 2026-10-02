import { runScenarios } from "../../support/runner.js";
import { BUJINKI_DETACH_STATE_SCENARIOS } from "./bujinki-detach-state.js";

describeWithCores("live Bujinki detach state", liveNseat, () => { runScenarios("multiplayer/bujinki-detach-state", BUJINKI_DETACH_STATE_SCENARIOS); });
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
