if not Duel.MPOwnerSeat then return end
-- This suffix needs the exported real-owner API. It is not installed in the P61 overlay.
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
function s.target(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	local actor=(Duel.MPActionSeat and Duel.MPActionSeat() or tp)
	if chkc then
		if not (chkc:IsLocation(LOCATION_STZONE) and chkc:IsOriginalType(TYPE_MONSTER) and chkc:IsFaceup()) then return false end
		if e:GetLabel()==1 then
			local ok=false
			mp_owner(chkc,tp,function(p)
				ok=Duel.GetLocationCount(p,LOCATION_MZONE)>0 and chkc:IsCanBeSpecialSummoned(e,0,actor,false,false,POS_FACEUP,p)
			end)
			return ok
		elseif e:GetLabel()==2 then return chkc:IsAbleToHand()
		else return true end
	end
	if chk==0 then return Duel.IsExistingTarget(aux.FaceupFilter(Card.IsOriginalType,TYPE_MONSTER),tp,LOCATION_STZONE,LOCATION_STZONE,1,nil) end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TARGET)
	local tc=Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsOriginalType,TYPE_MONSTER),tp,LOCATION_STZONE,LOCATION_STZONE,1,1,nil):GetFirst()
	local b1=false
	mp_owner(tc,tp,function(p)
		b1=Duel.GetLocationCount(p,LOCATION_MZONE)>0 and tc:IsCanBeSpecialSummoned(e,0,actor,false,false,POS_FACEUP,p)
	end)
	local op=Duel.SelectEffect(tp,{b1,aux.Stringid(id,1)},{tc:IsAbleToHand(),aux.Stringid(id,2)},{true,aux.Stringid(id,3)})
	e:SetLabel(op)
	local category=op==1 and CATEGORY_SPECIAL_SUMMON or op==2 and CATEGORY_TOHAND or CATEGORY_DESTROY
	e:SetCategory(category)
	Duel.SetOperationInfo(0,category,tc,1,0,0)
	if op==3 then Duel.SetPossibleOperationInfo(0,CATEGORY_DESTROY,nil,1,PLAYER_EITHER,LOCATION_MZONE) end
end
local mp_activate=s.activate
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local actor=(Duel.MPActionSeat and Duel.MPActionSeat() or tp)
	if e:GetLabel()~=1 then return mp_activate(e,tp,eg,ep,ev,re,r,rp) end
	local tc=Duel.GetFirstTarget()
	if not tc:IsRelateToEffect(e) then return end
	mp_owner(tc,tp,function(p) Duel.SpecialSummon(tc,0,actor,p,false,false,POS_FACEUP) end)
end
