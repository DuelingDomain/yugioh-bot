// Native smoke test for the patched ygopro-core, built by build-native-core.sh with ASan and UBSan.
// It needs no card database and no scripts. Two Decks of 40 vanilla monsters (code 1) play a few
// turns: create the duel, start it, answer every idle prompt with "end turn", then destroy it.
// Idle prompts get "end turn" and chain prompts get "no chain". Any other prompt ends the run.
// Exit code 0 means the core ran without a sanitizer report. Anything else is a failure.
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include "ocgapi.h"
#include "ocgapi_constants.h"

static void read_card(void*, uint32_t code, OCG_CardData* data) {
	std::memset(data, 0, sizeof(*data));
	data->code = code;
	data->type = TYPE_MONSTER | TYPE_NORMAL;
	data->level = 4;
	data->attribute = 1;
	data->race = 1;
	data->attack = 1000;
	data->defense = 1000;
}

static int read_script(void*, OCG_Duel, const char*) { return 0; }

static void on_log(void*, const char* text, int type) {
	std::fprintf(stderr, "core log [%d]: %s\n", type, text);
}

int main() {
	int major = 0, minor = 0;
	OCG_GetVersion(&major, &minor);
	OCG_DuelOptions options;
	std::memset(&options, 0, sizeof(options));
	options.seed[0] = 1;
	options.seed[1] = 2;
	options.seed[2] = 3;
	options.seed[3] = 4;
	options.flags = DUEL_MODE_MR5;
	options.team1 = {8000, 5, 1};
	options.team2 = {8000, 5, 1};
	options.cardReader = read_card;
	options.scriptReader = read_script;
	options.logHandler = on_log;
	OCG_Duel duel = nullptr;
	if(OCG_CreateDuel(&duel, &options) != OCG_DUEL_CREATION_SUCCESS) {
		std::fprintf(stderr, "smoke: OCG_CreateDuel failed\n");
		return 1;
	}
	for(uint8_t team = 0; team < 2; ++team) {
		for(int i = 0; i < 40; ++i) {
			OCG_NewCardInfo info;
			std::memset(&info, 0, sizeof(info));
			info.team = team;
			info.code = 1;
			info.con = team;
			info.loc = LOCATION_DECK;
			info.seq = 0;
			info.pos = POS_FACEDOWN_DEFENSE;
			OCG_DuelNewCard(duel, &info);
		}
	}
	OCG_StartDuel(duel);
	int idle_answers = 0;
	int status = OCG_DUEL_STATUS_CONTINUE;
	for(int guard = 0; guard < 2000; ++guard) {
		status = OCG_DuelProcess(duel);
		uint32_t length = 0;
		const uint8_t* buffer = static_cast<const uint8_t*>(OCG_DuelGetMessage(duel, &length));
		bool idle = false, chain = false;
		for(uint32_t offset = 0; offset + 4 <= length;) {
			uint32_t size = 0;
			std::memcpy(&size, buffer + offset, 4);
			if(std::getenv("SMOKE_TRACE"))
				std::fprintf(stderr, "msg %u size %u\n", (unsigned)buffer[offset + 4], size);
			if(size > 0 && buffer[offset + 4] == MSG_SELECT_IDLECMD)
				idle = true;
			if(size > 0 && buffer[offset + 4] == MSG_SELECT_CHAIN)
				chain = true;
			offset += 4 + size;
		}
		if(status == OCG_DUEL_STATUS_END)
			break;
		if(status == OCG_DUEL_STATUS_CONTINUE)
			continue;
		if(chain) {
			const int32_t no_chain = -1;
			OCG_DuelSetResponse(duel, &no_chain, sizeof(no_chain));
			continue;
		}
		if(!idle)
			break;
		const uint32_t to_end_phase = 7;
		OCG_DuelSetResponse(duel, &to_end_phase, sizeof(to_end_phase));
		++idle_answers;
	}
	uint32_t field_length = 0;
	OCG_DuelQueryField(duel, &field_length);
	const uint32_t hand0 = OCG_DuelQueryCount(duel, 0, LOCATION_HAND);
	const uint32_t hand1 = OCG_DuelQueryCount(duel, 1, LOCATION_HAND);
	OCG_DestroyDuel(duel);
	std::printf("smoke: core api %d.%d, status %d, %d idle answers, hands %u/%u\n", major, minor, status, idle_answers, hand0, hand1);
	return idle_answers >= 2 ? 0 : 1;
}
