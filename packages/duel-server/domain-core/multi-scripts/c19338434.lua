if not aux.MPForEachController then return end
-- FFA rebinding gives an exact owner test. In Tag, P61 can identify only the owner team.
local function mp_can_draw(c)
	local ok=false
	if Duel.MPMode()==1 then
		aux.MPForEachDuelist(function(p)
			if c:GetOwner()==p then ok=Duel.IsPlayerCanDraw(p,2) return true end
		end)
	elseif c:GetOwner()==c:GetControler() then
		aux.MPForEachController(Group.FromCards(c),function(g,seat,p) ok=Duel.IsPlayerCanDraw(p,2) end)
	else
		ok=Duel.IsPlayerCanDraw(c:GetOwner(),2)
	end
	return ok
end
function s.tgfilter(c)
	return c:IsFacedown() and (c:IsCanChangePosition() or c:IsAbleToGrave() and mp_can_draw(c))
end
-- The picked opponent chooses the effect. After the send, the card controller is its owner.
function s.effop(e,tp,eg,ep,ev,re,r,rp)
	local tc=Duel.GetFirstTarget()
	if not tc:IsRelateToEffect(e) then return end
	local b1=tc:IsCanChangePosition()
	local b2=tc:IsAbleToGrave() and mp_can_draw(tc)
	if not (b1 or b2) then return end
	local op=Duel.SelectEffect(1-tp,
		{b1,aux.Stringid(id,2)},
		{b2,aux.Stringid(id,3)})
	if op==1 then
		local pos=(POS_FACEUP_ATTACK|POS_FACEUP_DEFENSE)&~tc:GetPosition()
		pos=Duel.SelectPosition(tp,tc,pos)
		Duel.ChangePosition(tc,pos)
	elseif op==2 and Duel.SendtoGrave(tc,REASON_EFFECT)>0 and tc:IsLocation(LOCATION_GRAVE) then
		Duel.BreakEffect()
		aux.MPForEachController(Group.FromCards(tc),function(g,seat,p)
			Duel.Draw(p,2,REASON_EFFECT)
		end)
	end
end
