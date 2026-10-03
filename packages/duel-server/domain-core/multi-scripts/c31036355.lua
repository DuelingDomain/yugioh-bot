if not aux.MPForEachDuelist then return end
if not Duel.MPMode or Duel.MPMode()~=1 then return end
-- Creature Swap: each living FFA duelist chooses in turn order, then all chosen monsters rotate.
local stock_target=s.target
local stock_activate=s.activate
local function each_turn(fn)
	local order={}
	local first=1
	aux.MPForEachDuelist(function(tp_i,seat_i)
		order[#order+1]=#order+1
		if Duel.IsTurnPlayer(tp_i) then first=#order end
	end)
	for offset=0,#order-1 do
		local i=order[(first+offset-1)%#order+1]
		local ok,seat=Duel.MPNthDuelist(i)
		if not ok or fn(0,seat) then break end
	end
	Duel.MPNthDuelist(0)
end
local function all_have_monster()
	local legal=true
	each_turn(function(p)
		if not Duel.IsExistingMatchingCard(s.filter,p,LOCATION_MZONE,0,1,nil) then legal=false return true end
	end)
	return legal
end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if Duel.MPMode()~=1 then return stock_target(e,tp,eg,ep,ev,re,r,rp,chk) end
	if chk==0 then return all_have_monster() end
	Duel.SetOperationInfo(0,CATEGORY_CONTROL,nil,0,0,0)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	if Duel.MPMode()~=1 then return stock_activate(e,tp,eg,ep,ev,re,r,rp) end
	if not all_have_monster() then return end
	local chosen=Group.CreateGroup()
	each_turn(function(p)
		Duel.Hint(HINT_SELECTMSG,p,HINTMSG_CONTROL)
		local g=Duel.SelectMatchingCard(p,s.filter,p,LOCATION_MZONE,0,1,1,nil)
		Duel.HintSelection(g)
		chosen:Merge(g)
	end)
	-- An older core does not have the atomic operation. It must not make a partial pair swap.
	if not Duel.MPRotateControl or not Duel.MPRotateControl(chosen) then return end
	for c in aux.Next(chosen) do
		local e1=Effect.CreateEffect(e:GetHandler())
		e1:SetDescription(3313)
		e1:SetProperty(EFFECT_FLAG_CLIENT_HINT)
		e1:SetType(EFFECT_TYPE_SINGLE)
		e1:SetCode(EFFECT_CANNOT_CHANGE_POSITION)
		e1:SetReset(RESET_PHASE|PHASE_END)
		c:RegisterEffect(e1)
	end
end
