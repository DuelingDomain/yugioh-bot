if not Duel.MPOwnerSeat then return end
local function mp_owner(c,tp,fn)
	local owner=Duel.MPOwnerSeat(c)
	if owner<0 then return end
	local p=tp
	if aux.MPKeyOfSeat(owner)~=aux.MPKey(tp) then
		if not Duel.MPBindSeat(owner) then return end
		p=1-tp
	elseif Duel.MPMode()==2 then
		local i=1
		while true do
			local ok,seat=Duel.MPNthDuelist(i)
			if not ok then Duel.MPNthDuelist(0) return end
			if seat==owner then break end
			i=i+1
		end
	end
	fn(p)
	Duel.MPBindSeat()
	Duel.MPNthDuelist(0)
end
local function mp_can_draw(c,tp)
	local ok=false
	mp_owner(c,tp,function(p) ok=Duel.IsPlayerCanDraw(p,2) end)
	return ok
end
function s.tgfilter(c,e,tp)
	return c:IsFacedown() and (c:IsCanChangePosition() or c:IsAbleToGrave() and mp_can_draw(c,tp))
end
function s.efftg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if chkc then return chkc:IsLocation(LOCATION_MZONE) and chkc:IsControler(1-tp) and s.tgfilter(chkc,e,tp) end
	if chk==0 then return Duel.IsExistingTarget(s.tgfilter,tp,0,LOCATION_MZONE,1,nil,e,tp) end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TARGET)
	local tc=Duel.SelectTarget(tp,s.tgfilter,tp,0,LOCATION_MZONE,1,1,nil,e,tp):GetFirst()
	Duel.SetPossibleOperationInfo(0,CATEGORY_POSITION,tc,1,tp,POS_FACEUP)
	Duel.SetPossibleOperationInfo(0,CATEGORY_TOGRAVE,tc,1,tp,0)
	Duel.SetPossibleOperationInfo(0,CATEGORY_DRAW,nil,0,tc:GetOwner(),2)
end
if not aux.MPForEachController then return end
-- Declare the opponent before selecting its card. The target controller chooses the effect.
s.efftg=aux.MPTarget(s.efftg)
function s.effop(e,tp,eg,ep,ev,re,r,rp)
	local tc=Duel.GetFirstTarget()
	if not tc:IsRelateToEffect(e) then return end
	local b1=tc:IsCanChangePosition()
	local b2=tc:IsAbleToGrave() and mp_can_draw(tc,tp)
	if not (b1 or b2) then return end
	local op
	aux.MPForEachController(Group.FromCards(tc),function(g,seat,p)
		op=Duel.SelectEffect(p,
			{b1,aux.Stringid(id,2)},
			{b2,aux.Stringid(id,3)})
	end)
	if not op then return end
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
