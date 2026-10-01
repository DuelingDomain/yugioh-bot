#!/usr/bin/env node
// Bug fixes to the pinned ygopro-core that BOTH the Standard and the Domain builds apply.
// Keep this file free of Domain logic: the Standard core must stay rule-identical to stock.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
if (!root) {
  console.error("usage: apply-core-fixes.mjs <ygopro-core-dir>");
  process.exit(1);
}

const replacements = [];

function patch(file, pairs) {
  const path = join(root, file);
  let text = readFileSync(path, "utf8");
  for (const [from, to] of pairs) {
    if (!text.includes(from)) {
      throw new Error(`Patch failed in ${file}: pattern not found:\n${from.slice(0, 180)}`);
    }
    const next = text.replace(from, to);
    if (next === text) {
      throw new Error(`Patch failed in ${file}: replacement produced no change`);
    }
    text = next;
  }
  writeFileSync(path, text);
  replacements.push(file);
}

// Stale reason_effect use-after-free.
// field::destroy (and other moves) keep the old current.reason_effect when the new reason passes
// nullptr, for example the lost-target rule destroy of an Equip Spell. When the effect that was
// stored there is deleted (reset at the End Phase, card reset), the card still points at freed
// memory. Card.GetReasonEffect then pushes a random Lua registry ref (a Group, a Card), and the core
// itself reads it in is_self_destroy_related. Clear every card pointer to an effect before it is freed.
patch("duel.cpp", [
  [
    `void duel::delete_effect(effect* peffect) {
	lua->unregister_effect(peffect);`,
    `void duel::delete_effect(effect* peffect) {
	for(auto& pcard : cards) {
		if(pcard->current.reason_effect == peffect)
			pcard->current.reason_effect = nullptr;
		if(pcard->previous.reason_effect == peffect)
			pcard->previous.reason_effect = nullptr;
		if(pcard->temp.reason_effect == peffect)
			pcard->temp.reason_effect = nullptr;
	}
	if(game_field->core.reason_effect == peffect)
		game_field->core.reason_effect = nullptr;
	lua->unregister_effect(peffect);`,
  ],
]);

console.log(`core fixes: patched ${replacements.join(", ")}`);
