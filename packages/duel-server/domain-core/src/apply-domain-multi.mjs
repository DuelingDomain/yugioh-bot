#!/usr/bin/env node
// Domain layer for 3 and 4 duelists. Runs on the multi-duelist core tree only (opt in: DOMAIN_MULTI=1).
//
//   node apply-domain-multi.mjs pre  <tree>   run BEFORE apply-domain-patch.mjs
//   node apply-domain-multi.mjs post <tree>   run AFTER apply-domain-patch.mjs
//
// pre:  the series commit "core: pay and check LP costs from team LP" (D1a) changed two stock lines. The Domain
//       patch anchors on the stock text, so pre puts the stock text back. It is idempotent: a no-op when the stock
//       text is there, and exit 1 when a site has neither the stock text nor the D1a text.
// post: makes the Domain code work with n_duelists > 2 (LP cost array, team LP, Deck Master of every seat, recall
//       prompts, elimination). With 2 duelists every change gives the same result as the Domain text.
//
// Exit 1 when the tree has no `constexpr uint8_t MAX_DUELISTS` in common.h (a stock two-player tree).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const mode = process.argv[2];
const root = process.argv[3];
if ((mode !== "pre" && mode !== "post") || !root) {
  console.error("usage: apply-domain-multi.mjs pre|post <multi-core-tree>");
  process.exit(1);
}

function fail(message) {
  console.error(`apply-domain-multi ${mode}: ${message}`);
  process.exit(1);
}

let commonH = "";
try {
  commonH = readFileSync(join(root, "common.h"), "utf8");
} catch {
  fail(`cannot read common.h in ${root}`);
}
if (!commonH.includes("constexpr uint8_t MAX_DUELISTS")) {
  fail("this is not a multi-duelist core tree (common.h has no MAX_DUELISTS)");
}

const count = (text, needle) => text.split(needle).length - 1;

// Exact replace, each `from` must occur exactly once.
function patch(file, pairs) {
  const path = join(root, file);
  let text = readFileSync(path, "utf8");
  for (const [from, to] of pairs) {
    const n = count(text, from);
    if (n !== 1) fail(`${file}: expected exactly 1 match, found ${n}:\n${from.slice(0, 200)}`);
    text = text.replace(from, () => to);
  }
  writeFileSync(path, text);
}

if (mode === "pre") {
  // Each site: [file, stock text, D1a text]. Stock present: nothing to do. D1a present: put stock back.
  const sites = [
    [
      "field.cpp",
      `	//cost[playerid].amount += val;
	if(val <= player[playerid].lp)
		return TRUE;`,
      `	//cost[playerid].amount += val;
	if(val <= lp_ref(playerid))
		return TRUE;`,
    ],
    [
      "operations.cpp",
      `			player[playerid].lp -= cost;
			auto message = pduel->new_message(MSG_PAY_LPCOST);`,
      `			lp_ref(playerid) -= cost;
			auto message = pduel->new_message(MSG_PAY_LPCOST);`,
    ],
  ];
  for (const [file, stock, d1a] of sites) {
    const path = join(root, file);
    let text = readFileSync(path, "utf8");
    const nStock = count(text, stock);
    const nD1a = count(text, d1a);
    if (nStock === 1 && nD1a === 0) continue;
    if (nStock === 0 && nD1a === 1) {
      writeFileSync(path, text.replace(d1a, () => stock));
      continue;
    }
    fail(`${file}: neither the stock text nor the D1a text was found exactly once (stock ${nStock}, D1a ${nD1a})`);
  }
  console.log("pre: stock LP cost text in place");
  process.exit(0);
}

// ---- post ----

patch("field.h", [
  [
    `	lpcost cost[2];
	field_effect effects;`,
    `	lpcost cost[MAX_DUELISTS];
	field_effect effects;`,
  ],
  // reset_sentinels (the series): the recall prompt owner starts as none_id() too. A stray value of PLAYER_NONE (2) is
  // a real seat at 3 and 4 duelists.
  [
    `		core.conti_player = none_id();
		nil_event.event_player = none_id();`,
    `		core.conti_player = none_id();
		core.domain_recall_player = none_id();
		nil_event.event_player = none_id();`,
  ],
]);

patch("field.cpp", [
  // build_range_list (the series): the Deck Master zone is an individual location like the hand, the Deck and the Extra
  // Deck. Without it a Tag partner's Deck Master counted as a field card of the team, and in a free for all the bound
  // opponent scope (F5) skipped it.
  [
    `	constexpr uint32_t individual = LOCATION_HAND | LOCATION_DECK | LOCATION_EXTRA;`,
    `	constexpr uint32_t individual = LOCATION_HAND | LOCATION_DECK | LOCATION_EXTRA | LOCATION_DECKMASTER;`,
  ],
  // Domain text of check_lp_cost (the Domain patch put it there).
  [
    `	cost[playerid].amount += val;
	if(cost[playerid].amount <= player[playerid].lp)
		return TRUE;
	return FALSE;
}`,
    `	if(n_duelists == 2) {
		cost[playerid].amount += val;
		if(cost[playerid].amount <= player[playerid].lp)
			return TRUE;
	} else {
		cost[team_of(playerid)].amount += val;
		if(cost[team_of(playerid)].amount <= lp_ref(playerid))
			return TRUE;
	}
	return FALSE;
}`,
  ],
  // field::eliminate (T5B): the Deck Master zone holds a nullptr when empty, and take() dereferences its argument.
  [
    `		for(auto* lst : { &player[q].list_main, &player[q].list_hand, &player[q].list_grave, &player[q].list_remove, &player[q].list_extra }) {
			for(auto& pcard : *lst)
				take(pcard);
		}
`,
    `		for(auto* lst : { &player[q].list_main, &player[q].list_hand, &player[q].list_grave, &player[q].list_remove, &player[q].list_extra }) {
			for(auto& pcard : *lst)
				take(pcard);
		}
		for(auto& pcard : player[q].list_deckmaster) {
			if(pcard)
				take(pcard);
		}
`,
  ],
]);

patch("operations.cpp", [
  [
    `			player[playerid].lp -= cost;
			auto message = pduel->new_message(MSG_PAY_LPCOST);`,
    `			lp_ref(playerid) -= cost;
			auto message = pduel->new_message(MSG_PAY_LPCOST);`,
  ],
]);

patch("domain_master.cpp", [
  // domain_owner_of
  [
    `	if(!pcard)
		return PLAYER_NONE;
	if(pcard->owner <= 1 && player[pcard->owner].deck_master_card == pcard)
		return pcard->owner;
	for(uint8_t p = 0; p < 2; ++p) {
		if(player[p].deck_master_card == pcard)
			return p;
	}
	return PLAYER_NONE;
}`,
    `	if(!pcard)
		return none_id();
	if(is_duelist(pcard->owner) && player[pcard->owner].deck_master_card == pcard)
		return pcard->owner;
	for(uint8_t p = 0; p < n_duelists; ++p) {
		if(player[p].deck_master_card == pcard)
			return p;
	}
	return none_id();
}`,
  ],
  [`	return domain_owner_of(pcard) != PLAYER_NONE;`, `	return is_duelist(domain_owner_of(pcard));`],
  [
    `	if(playerid > 1)
		return 0;
	return domain_leave_tax(`,
    `	if(!is_duelist(playerid))
		return 0;
	return domain_leave_tax(`,
  ],
  [
    `	if(playerid > 1)
		return false;
	uint32_t tax = domain_leave_tax_for(playerid);`,
    `	if(!is_duelist(playerid))
		return false;
	uint32_t tax = domain_leave_tax_for(playerid);`,
  ],
  [
    `	if(playerid > 1)
		return;
	uint32_t tax = domain_leave_tax_for(playerid);
	if(tax == 0)
		return;
	if(lock_reason)`,
    `	if(!is_duelist(playerid))
		return;
	uint32_t tax = domain_leave_tax_for(playerid);
	if(tax == 0)
		return;
	if(lock_reason)`,
  ],
  [`	if(owner == PLAYER_NONE)
		return;
	auto& info = player[owner];
	const uint32_t kind`, `	if(!is_duelist(owner))
		return;
	auto& info = player[owner];
	const uint32_t kind`],
  [
    `	if(owner > 1)
		owner = pcard->current.controler;
	if(owner > 1)
		return;`,
    `	if(!is_duelist(owner))
		owner = pcard->current.controler;
	if(!is_duelist(owner))
		return;`,
  ],
  [
    `	if(tp > 1)
		return;
	if(player[tp].list_deckmaster.empty())`,
    `	if(!is_duelist(tp))
		return;
	if(player[tp].list_deckmaster.empty())`,
  ],
  [
    `	if(playerid > 1)
		return false;
	const auto& info = player[playerid];`,
    `	if(!is_duelist(playerid))
		return false;
	const auto& info = player[playerid];`,
  ],
  [
    `	for(uint8_t p = 0; p < 2; ++p) {
		card* dm = player[p].deck_master_card;`,
    `	for(uint8_t p = 0; p < n_duelists; ++p) {
		card* dm = player[p].deck_master_card;`,
  ],
  // Recall is a rule move, with no reason player (PLAYER_NONE is a real seat at n > 2).
  ...[
    "raise_single_event(dm, nullptr, EVENT_LEAVE_GRAVE",
    "raise_single_event(dm, nullptr, EVENT_MOVE",
    "raise_event(dm, EVENT_LEAVE_GRAVE",
    "raise_event(dm, EVENT_MOVE",
  ].map(call => [
    `${call}, nullptr, REASON_RULE, PLAYER_NONE, owner, 0);`,
    `${call}, nullptr, REASON_RULE, none_id(), owner, 0);`,
  ]),
  [
    `dm->current.reason_player = PLAYER_NONE;`,
    `dm->current.reason_player = none_id();`,
  ],
  [
    `	core.domain_recall_player = PLAYER_NONE;
	if(playerid > 1)
		return;`,
    `	if(n_duelists == 2)
		core.domain_recall_player = PLAYER_NONE;
	else
		core.domain_recall_player = DUELIST_NONE;
	if(!is_duelist(playerid))
		return;`,
  ],
  [
    `	if(tp > 1)
		return false;
	const uint8_t order[2] = { tp, static_cast<uint8_t>(1 - tp) };
	for(uint8_t p : order) {
		if(!domain_has_pending_recall(p))
			continue;
		core.domain_recall_player = p;
		emplace_process<Processors::SelectYesNo>(p, static_cast<uint64_t>(DOMAIN_RECALL_DESC));
		return true;
	}`,
    `	if(!is_duelist(tp))
		return false;
	if(n_duelists == 2) {
		const uint8_t order[2] = { tp, static_cast<uint8_t>(1 - tp) };
		for(uint8_t p : order) {
			if(!domain_has_pending_recall(p))
				continue;
			core.domain_recall_player = p;
			emplace_process<Processors::SelectYesNo>(p, static_cast<uint64_t>(DOMAIN_RECALL_DESC));
			return true;
		}
	} else {
		// Only the owner of a Deck Master gets the prompt: each living seat in turn, starting with the turn player.
		for(uint8_t k = 0; k < n_duelists; ++k) {
			const uint8_t p = static_cast<uint8_t>((tp + k) % n_duelists);
			if(!is_alive(p) || !domain_has_pending_recall(p))
				continue;
			core.domain_recall_player = p;
			emplace_process<Processors::SelectYesNo>(p, static_cast<uint64_t>(DOMAIN_RECALL_DESC));
			return true;
		}
	}`,
  ],
  [
    `void field::save_lp_cost() {
	for(uint8_t playerid = 0; playerid < 2; ++playerid) {`,
    `void field::save_lp_cost() {
	for(uint8_t playerid = 0; playerid < n_duelists; ++playerid) {`,
  ],
  [
    `void field::restore_lp_cost() {
	for(uint8_t playerid = 0; playerid < 2; ++playerid) {`,
    `void field::restore_lp_cost() {
	for(uint8_t playerid = 0; playerid < n_duelists; ++playerid) {`,
  ],
]);

console.log("post: Domain code made ready for 3 and 4 duelists");
