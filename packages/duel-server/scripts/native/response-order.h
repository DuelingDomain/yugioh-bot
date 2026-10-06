#pragma once

#include <algorithm>
#include <string>
#include <vector>

// Shared by the nightly driver and its focused native regression.
struct ResponseOrder {
	int n;
	bool tag;
	int chain_L = -1;
	std::vector<int> owners;
	std::vector<int> seen;
	std::vector<bool> eliminated;
	bool collecting = false;
	bool emptied_by_elimination = false;

	ResponseOrder(int count, bool is_tag) : n(count), tag(is_tag), eliminated(count, false) {}

	std::string flush_response(int turn_player) {
		if(n <= 2 || !collecting) return {};
		if(emptied_by_elimination && owners.empty() && !seen.empty()) {
			std::string error = "responses before cleanup CHAIN_END after final-link elimination:";
			for(int p : seen) error += " " + std::to_string(p);
			seen.clear();
			return error;
		}
		std::vector<int> expected;
		if(tag) {
			for(int k : {1, 3, 2, 0}) expected.push_back((chain_L + k) % 4);
		} else {
			// Removing the last unresolved link opens turn-player-first priority.
			const int start = chain_L < 0 ? turn_player : (chain_L + 1) % n;
			// Keep slots for seats eliminated during this round: an earlier prompt
			// to such a seat still fixes our position. The driver's eliminated-prompt
			// check rejects any new prompt to a dead seat.
			for(int k = 0; k < n; ++k) expected.push_back((start + k) % n);
		}
		size_t at = 0;
		std::string error;
		for(int got : seen) {
			while(at < expected.size() && expected[at] != got) ++at;
			if(at >= expected.size()) {
				error = "link by " + std::to_string(chain_L) + " turn player " + std::to_string(turn_player) + " prompts:";
				for(int p : seen) error += " " + std::to_string(p);
				error += " expected order:";
				for(int p : expected) if(!eliminated[p]) error += " " + std::to_string(p);
				break;
			}
			++at;
		}
		seen.clear();
		return error;
	}

	std::string chaining(int owner, int turn_player) {
		auto error = flush_response(turn_player);
		owners.push_back(owner);
		chain_L = owner;
		collecting = true;
		emptied_by_elimination = false;
		return error;
	}

	std::string solving(int turn_player) {
		auto error = flush_response(turn_player);
		reset();
		return error;
	}

	std::string eliminate(int owner, int turn_player) {
		const bool removed_links = n > 2 && !tag && collecting &&
			std::find(owners.begin(), owners.end(), owner) != owners.end();
		if(!removed_links) {
			// No link disappeared, so priority has not restarted. Preserve the
			// complete prompt prefix, including prompts to this formerly live seat.
			eliminated[owner] = true;
			return {};
		}
		// Prompts before elimination belong to the previous anchor/living set.
		auto error = flush_response(turn_player);
		eliminated[owner] = true;
		owners.erase(std::remove(owners.begin(), owners.end(), owner), owners.end());
		chain_L = owners.empty() ? -1 : owners.back();
		if(owners.empty()) emptied_by_elimination = true;
		return error;
	}

	void prompt(int player, int spe_count = 0) {
		if(collecting && spe_count != 0x7f) seen.push_back(player);
	}

	std::string end(int turn_player) {
		// CHAIN_END can arrive without CHAIN_SOLVING after elimination. Never
		// discard collected prompts: they still have to obey the living anchor.
		auto error = flush_response(turn_player);
		reset();
		return error;
	}

	void reset() {
		chain_L = -1;
		owners.clear();
		seen.clear();
		collecting = false;
		emptied_by_elimination = false;
	}
};
