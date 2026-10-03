// Additive seat-query controls; live card scenarios prove the resulting duel rules.
#include "scripted-duel.h"

static void check(const char* setup, int n) {
  const auto d = sd::create(setup);
  auto& f = sd::F(d);
  sd::lua(d, "local c=Debug.AddCard(5000,1,0,LOCATION_MZONE,0,POS_FACEUP_ATTACK); _LEFTOVER_CARD=c");
  for(int seat=0; seat<n; ++seat) {
    f.infos.turn_player=static_cast<uint8_t>(seat);
    const auto turn_before=f.infos.turn_player;
    const std::string code="assert(Duel.MPTurnSeat()=="+std::to_string(seat)+")\n"
      "assert(Duel.MPTurnControls(_LEFTOVER_CARD)=="+(seat==0?std::string("true"):std::string("false"))+")\n"
      "assert(Duel.MPTurnOwns(_LEFTOVER_CARD)=="+(seat==1?std::string("true"):std::string("false"))+")\n"
      "assert(not Duel.MPIsAlive(-1)); assert(not Duel.MPIsAlive("+std::to_string(n)+"))\n";
    EXPECT(sd::lua(d,code), "%d seats, turn seat %d: queries", n,seat);
    EXPECT(f.infos.turn_player==turn_before, "%d seats: queries keep turn seat",n);
  }
  for(int seat=0;seat<n;++seat)
    EXPECT(sd::lua(d,"assert(Duel.MPIsAlive("+std::to_string(seat)+"))"), "%d seats: living seat %d",n,seat);
  if(n>2) {
    f.eliminate(2,1);
    for(int seat=0;seat<n;++seat)
      EXPECT(sd::lua(d,"assert(Duel.MPIsAlive("+std::to_string(seat)+")=="+(f.is_alive(static_cast<uint8_t>(seat))?std::string("true"):std::string("false"))+")"), "%d seats: loss seat %d",n,seat);
  }
  EXPECT(sd::stray_logs==0,"%d seats: no Lua errors",n);
  OCG_DestroyDuel(d);
  std::printf("ok additive queries: %d seats %s\n",n,setup);
}
int main() {
  check("",2);
  check("Debug.SetupDuelists(3,0,1,2)",3);
  check("Debug.SetupDuelists(4,0,1,2,3)",4);
  check("Debug.SetupDuelists(4,0,1,0,1)",4);
  std::printf("%s: %d failure(s)\n",failures?"FAIL":"PASS",failures);
  return failures?1:0;
}
