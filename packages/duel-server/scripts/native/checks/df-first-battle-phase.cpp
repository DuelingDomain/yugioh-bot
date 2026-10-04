#include <cstring>
#include "ocgapi.h"
#include "ocgapi_constants.h"
#include "duel.h"
#include "field.h"
#include "common.h"

static void read_card(void*, uint32_t code, OCG_CardData* data) {
  std::memset(data, 0, sizeof(*data));
  data->code = code;
}
static int read_script(void*, OCG_Duel, const char*) { return 0; }
static void log_message(void*, const char*, int) {}

int main() {
  OCG_DuelOptions opts{};
  opts.seed[0] = 1;
  opts.flags = DUEL_MODE_MR5;
  opts.team1 = {8000, 5, 1}; opts.team2 = {8000, 5, 1};
  opts.cardReader = read_card; opts.scriptReader = read_script; opts.logHandler = log_message;
  OCG_Duel game = nullptr;
  EXPECT(OCG_CreateDuel(&game, &opts) == OCG_DUEL_CREATION_SUCCESS, "create duel");
  if(!game) return 1;
  field& f = *static_cast<duel*>(game)->game_field;
  for(uint8_t n : {3, 4}) {
    f.n_duelists = n; f.n_teams = n;
    for(bool early_loss : {false, true}) {
      for(uint8_t p = 0; p < n; ++p) f.player[p].eliminated = early_loss && p == 1;
      for(auto& count : f.infos.turn_id_by_player) count = 0;
      f.infos.turn_id = 0;
      EXPECT(!f.before_first_attack_turn(), "n=%u: no turn has started", n);
      uint32_t turn = 0;
      for(uint8_t p = 0; p < n; ++p) {
        if(early_loss && p == 1) continue;
        f.infos.turn_id = ++turn; f.infos.turn_player = p; f.infos.turn_id_by_player[p] = 1;
        EXPECT(f.before_first_attack_turn() == (p != n - 1), "n=%u early_loss=%d turn=%u seat=%u", n, early_loss, turn, p);
      }
      ++f.infos.turn_id; f.infos.turn_player = 0; f.infos.turn_id_by_player[0] = 2;
      EXPECT(!f.before_first_attack_turn(), "n=%u: next round has battle", n);
    }
  }
  for(uint8_t n : {2, 4}) {
    f.n_duelists = n; f.n_teams = 2; f.first_attack_turn = n;
    for(uint32_t turn = 0; turn <= static_cast<uint32_t>(n) + 1; ++turn) {
      f.infos.turn_id = turn;
      EXPECT(f.before_first_attack_turn() == (turn >= 1 && turn < n), "stock n=%u turn=%u", n, turn);
    }
  }
  OCG_DestroyDuel(game);
  std::printf("%s first Battle Phase helper: %d failure(s)\n", failures ? "FAIL" : "PASS", failures);
  return failures ? 1 : 0;
}
