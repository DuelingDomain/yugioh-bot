// Check hint recipients and unchanged scopes on a real native core. No installed core is changed.
#include <cstdio>
#include "scripted-duel.h"
#include "interpreter.h"

static void check(int n,bool tag,int actor,int htype,int value,std::vector<int> want,int dead=-1,int bound=-1) {
  std::string setup;
  if(n>2) {
    setup="Debug.SetupDuelists("+std::to_string(n);
    for(int seat=0;seat<n;++seat) setup+=","+std::to_string(tag ? seat%2 : seat);
    setup+=")";
  }
  sd::stray_logs=0;
  auto d=sd::create(setup);
  auto& f=sd::F(d);
  auto* lua=static_cast<duel*>(d)->lua;
  if(dead>=0) { f.player[dead].eliminated=true; f.player[dead].lp=0; }
  std::vector<int> lp;
  for(int seat=0;seat<n;++seat) lp.push_back(f.lp_ref(seat));
  if(n>2) {
    lua->push_scope(actor);
    if(bound>=0) lua->current_scope()->own_bound=bound;
  }
  uint32_t start=0;
  OCG_DuelGetMessage(d,&start);
  const auto selections=f.core.select_options.size();
  sd::lua(d,"Duel.Hint("+std::to_string(htype)+","+std::to_string(value)+",777)");
  uint32_t length=0;
  const auto* bytes=static_cast<const uint8_t*>(OCG_DuelGetMessage(d,&length));
  std::vector<int> got;
  for(uint32_t pos=start;pos+4<=length;) {
    uint32_t size=0; std::memcpy(&size,bytes+pos,4);
    if(size>=11 && bytes[pos+4]==MSG_HINT && bytes[pos+5]!=0xf1) got.push_back(bytes[pos+6]);
    pos+=4+size;
  }
  EXPECT(got==want,"n=%d tag=%d actor=%d type=%d: wrong recipients",n,tag,actor,htype);
  EXPECT(f.core.select_options.size()==selections,"hint queued a pick");
  if(n>2) {
    EXPECT(!lua->current_scope()->touched,"hint marked the activation probe");
    EXPECT(lua->current_scope()->own_bound==(bound>=0 ? bound : DUELIST_NONE),"hint changed the bind");
    lua->pop_scope();
  }
  for(int seat=0;seat<n;++seat) EXPECT(f.lp_ref(seat)==lp[seat],"hint changed LP of seat %d",seat);
  EXPECT(sd::stray_logs==0,"hint gave a Lua error");
  OCG_DestroyDuel(d);
}

static void log_calls(int n,bool tag,int actor,int dead=-1) {
  std::string setup;
  if(n>2) {
    setup="Debug.SetupDuelists("+std::to_string(n);
    for(int seat=0;seat<n;++seat) setup+=","+std::to_string(tag ? seat%2 : seat);
    setup+=")";
  }
  auto d=sd::create(setup);
  auto& f=sd::F(d);
  auto* lua=static_cast<duel*>(d)->lua;
  if(dead>=0) { f.player[dead].eliminated=true; f.player[dead].lp=0; }
  if(n>2) lua->push_scope(actor);
  uint32_t start=0;
  OCG_DuelGetMessage(d,&start);
  // Every call is separate, including equal text sent to different recipient sets.
  sd::lua(d,"Duel.Hint(2,1,502); Duel.Hint(2,1,502); Duel.Hint(1,1,502); Duel.Hint(1,1,502); Duel.Hint(2,0,503); Duel.Hint(2,1,503)");
  uint32_t length=0;
  const auto* bytes=static_cast<const uint8_t*>(OCG_DuelGetMessage(d,&length));
  int boundaries=0,real=0;
  std::vector<uint64_t> counts;
  int left=0;
  for(uint32_t pos=start;pos+4<=length;) {
    uint32_t size=0; std::memcpy(&size,bytes+pos,4);
    if(size>=11 && bytes[pos+4]==MSG_HINT) {
      const auto htype=bytes[pos+5];
      uint64_t data=0; std::memcpy(&data,bytes+pos+7,8);
      if(htype==0xf1) {
        EXPECT(left==0,"next Lua-call boundary arrived before prior recipient group ended");
        EXPECT(bytes[pos+6]==DUELIST_NONE,"boundary is not internal metadata");
        ++boundaries; counts.push_back(data); left=static_cast<int>(data);
      } else {
        ++real;
        if(n>2) { EXPECT(left>0,"log hint has no call boundary"); --left; }
      }
    }
    pos+=4+size;
  }
  int opposing=0;
  for(int seat=0;seat<n;++seat) if(seat!=dead && !f.same_team(actor,seat)) ++opposing;
  if(n>2) {
    EXPECT(boundaries==6,"n=%d tag=%d: expected six distinct Lua-call boundaries, got %d",n,tag,boundaries);
    EXPECT(counts==std::vector<uint64_t>({static_cast<uint64_t>(opposing),static_cast<uint64_t>(opposing),static_cast<uint64_t>(opposing),static_cast<uint64_t>(opposing),1,static_cast<uint64_t>(opposing)}),"wrong recipient count per call");
    EXPECT(real==5*opposing+1,"real recipients lost or duplicated");
    EXPECT(left==0,"recipient count did not reach zero");
    EXPECT(!lua->current_scope()->touched,"boundary marked an activation probe");
    EXPECT(lua->current_scope()->own_bound==DUELIST_NONE,"boundary bound an opponent");
    lua->pop_scope();
  } else { EXPECT(boundaries==0 && real==6,"two-duelist stock wire path changed"); }
  OCG_DestroyDuel(d);
}
static void global_hint(int n,bool tag,int actor,int dead=-1) {
  std::string setup="Debug.SetupDuelists("+std::to_string(n);
  for(int seat=0;seat<n;++seat) setup+=","+std::to_string(tag ? seat%2 : seat);
  setup+=")";
  auto d=sd::create(setup);
  auto& f=sd::F(d);
  if(dead>=0) { f.player[dead].eliminated=true; f.player[dead].lp=0; }
  uint32_t start=0; OCG_DuelGetMessage(d,&start);
  sd::lua(d,"Duel.Hint(4,"+std::to_string(actor)+",777)");
  uint32_t length=0;
  const auto* bytes=static_cast<const uint8_t*>(OCG_DuelGetMessage(d,&length));
  std::vector<int> got,want;
  for(int seat=0;seat<n;++seat) if(seat!=dead && !f.same_team(actor,seat)) want.push_back(seat);
  for(uint32_t pos=start;pos+4<=length;) {
    uint32_t size=0; std::memcpy(&size,bytes+pos,4);
    if(size>=11 && bytes[pos+4]==MSG_HINT && bytes[pos+5]==4) got.push_back(bytes[pos+6]);
    pos+=4+size;
  }
  EXPECT(got==want,"global real caller=%d wrong fanout (n=%d tag=%d)",actor,n,tag);
  OCG_DestroyDuel(d);
}
int main() {
  check(3,false,1,HINT_OPSELECTED,1,{0,2});
  check(3,false,2,HINT_OPSELECTED,1,{0,1});
  check(4,false,3,HINT_OPSELECTED,1,{0,1,2});
  check(4,false,1,HINT_MESSAGE,1,{0,2,3});
  check(4,false,1,HINT_MESSAGE,1,{0,2,3},-1,3);
  check(4,false,1,HINT_MESSAGE,1,{2,3},0);
  check(4,true,1,HINT_OPSELECTED,0,{0,2});
  check(4,true,2,HINT_MESSAGE,1,{1,3});
  check(4,true,1,HINT_SELECTMSG,1,{1});
  check(2,false,0,HINT_OPSELECTED,0,{1});
  check(2,false,1,HINT_OPSELECTED,1,{0});
  check(2,false,0,HINT_MESSAGE,1,{1});
  log_calls(3,false,0);
  log_calls(4,false,0);
  log_calls(4,true,0);
  log_calls(4,false,0,2);
  log_calls(2,false,0);
  global_hint(3,false,2);
  global_hint(4,false,3);
  global_hint(4,true,3);
  global_hint(4,false,3,1);
  std::printf("Hint checks: %d failures\n",failures);
  return failures ? 1 : 0;
}
