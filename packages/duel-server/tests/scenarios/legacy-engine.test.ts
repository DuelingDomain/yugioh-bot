import { runScenarios } from "../support/runner.js";
import { runLegacyScenario } from "../support/session.js";
import { scenarios } from "./cases/legacy-engine.js";

// 1v1 tables host on the legacy engine by default (DUEL_1V1_ENGINE), so its own core messages need a real run too.
runScenarios("legacy-engine", scenarios, runLegacyScenario);
