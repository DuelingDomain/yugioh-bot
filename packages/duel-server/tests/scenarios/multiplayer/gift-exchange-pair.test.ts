import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { GIFT_EXCHANGE_PAIR_SCENARIOS } from "./gift-exchange-pair.js";
describeWithCores("live Gift Exchange pair", liveNseat, () => { runScenarios("multiplayer/gift-exchange-pair", GIFT_EXCHANGE_PAIR_SCENARIOS); });
