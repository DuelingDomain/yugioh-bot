if not (Duel.MPMode and Duel.MPMode()==1) then return end
-- The field's automatic GY tracking remembers one opponent for this field stay.
-- In the GY, "your opponent takes effect damage" and the LP amount refer to the
-- same event opponent. "1 monster from the field" still includes every field.
local mp_initial=s.initial_effect
function s.initial_effect(c)
	mp_initial(c)
	aux.MPRegisterLPOpponent(c)
end
function s.regop(e,tp,eg,ep,ev,re,r,rp)
	local seat=aux.MPCardLPOpponent(e:GetHandler())
	local tg=eg:Filter(function(tc)
		return Duel.MPSeatOf(tc)==seat and tc:IsPreviousLocation(LOCATION_MZONE) and tc:GetAttack()>0 and tc:IsMonster()
	end,nil)
	if #tg==0 then return end
	for tc in tg:Iter() do tc:RegisterFlagEffect(id,RESET_CHAIN,0,1) end
	local g=e:GetLabelObject():GetLabelObject()
	if Duel.GetCurrentChain()==0 then g:Clear() end
	g:Merge(tg)
	g:Remove(function(tc) return tc:GetFlagEffect(id)==0 end,nil)
	e:GetLabelObject():SetLabelObject(g)
	if Duel.GetFlagEffect(tp,id)==0 then
		Duel.RegisterFlagEffect(tp,id,RESET_CHAIN,0,1)
		Duel.RaiseSingleEvent(e:GetHandler(),EVENT_CUSTOM+id,e,0,tp,tp,0)
	end
end
function s.mpeffectlp(tp)
	local seat=Duel.MPBound() and Duel.MPSeat(1-tp)
	local lp=seat and Duel.MPGetLP(seat)
	if lp then return seat,lp end
	return aux.MPHighestLPOpponent(aux.MPKey(tp))
end
function s.tgtg(e,tp,eg,ep,ev,re,r,rp,chk)
	local seat,other=s.mpeffectlp(tp)
	if chk==0 then
		return Duel.IsExistingMatchingCard(s.tgfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil,math.abs(Duel.GetLP(tp)-other))
	end
	aux.MPLPOpponentHint(e:GetHandler(),seat)
	Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,PLAYER_EITHER,LOCATION_MZONE)
end
function s.tgop(e,tp,eg,ep,ev,re,r,rp)
	local seat,other=s.mpeffectlp(tp)
	aux.MPLPOpponentHint(e:GetHandler(),seat)
	local lp=math.abs(Duel.GetLP(tp)-other)
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TOGRAVE)
	local g=Duel.SelectMatchingCard(tp,s.tgfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil,lp)
	if #g>0 then Duel.HintSelection(g) Duel.SendtoGrave(g,REASON_EFFECT) end
end
