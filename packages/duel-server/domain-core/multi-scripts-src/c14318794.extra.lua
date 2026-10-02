-- stock: s[p] is the list of LP costs that player p paid this turn and s[p+2] the list of the last turn of p: that is s[2] and s[3] for
-- the players 2 and 3 too. The lists are kept per key (seat in FFA, team in Tag) in s.mpnow and s.mpprev, and the turn player moves its
-- list at the turn end. (The stock reset still runs on the raw table s: it writes only s[2..5] and nothing reads them.)
s.mpnow={}
s.mpprev={}
function s.checkop(e,tp,eg,ep,ev,re,r,rp)
	if ep==Duel.GetTurnPlayer() then
		local val=math.ceil(ev/2)
		table.insert(s.mpnow[ep],val)
	end
end
function s.mp_rotate()
	local p=Duel.GetTurnPlayer()
	s.mpprev[p]={table.unpack(s.mpnow[p])}
	s.mpnow[p]={}
end
function s.rectg(e,tp,eg,ep,ev,re,r,rp,chk)
	local c=e:GetHandler()
	local last=s.mpprev[tp]
	if chk==0 then return #last>0 and (c:GetFlagEffect(id)==0 or last[c:GetFlagEffectLabel(id)+1]) end
	local rec
	if c:GetFlagEffect(id)==0 then
		rec=last[1]
		c:RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_STANDBY,0,1,1)
	else
		rec=last[c:GetFlagEffectLabel(id)+1]
		c:SetFlagEffectLabel(id,c:GetFlagEffectLabel(id)+1)
	end
	Duel.SetTargetPlayer(tp)
	Duel.SetTargetParam(rec)
	Duel.SetOperationInfo(0,CATEGORY_RECOVER,nil,0,tp,rec)
end
local mp_ie_rotate=s.initial_effect
function s.initial_effect(c)
	mp_ie_rotate(c)
	if not s.mp_rotate_ready then
		s.mp_rotate_ready=true
		aux.AddValuesReset(s.mp_rotate)
	end
end
