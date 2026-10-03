import {describeWithCores,needs} from "../../support/cores.js";
import {liveNseat} from "../../support/live-nseat.js";
import {runScenarios} from "../../support/runner.js";
import {TAG_PARTNER_SOURCE_SCENARIOS} from "./tag-partner-source.js";
describeWithCores("live Tag partner source cards",[liveNseat,...needs.domainMulti()],()=>{runScenarios("multiplayer/tag-partner-source",TAG_PARTNER_SOURCE_SCENARIOS);});
