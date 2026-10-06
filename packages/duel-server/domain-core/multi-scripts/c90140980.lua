if not Duel.MPBindSeat or not aux.MPForEachDuelist or not aux.MPKeyOfSeat then return end
-- Ojama King (script fix, #218): the stock operation counts and prompts the zones of "1-tp" with no bound opponent, so at 3 or 4 seats the
-- zones came from the next opponent in turn order and the others could never be chosen. Rulebook v1.4 (Frequently Asked Cards, Ojama King):
-- you need to target 3 zones from the same opponent. OD-OJAMA-KING: the controller picks one opponent once (an opponent with a free Main
-- Monster Zone); the 3 zones are all of that opponent; if that opponent leaves the duel it blocks nothing and nobody is picked again.
-- The core runs this operation once for each stay of the card on the field: the value 0x80 that it saves is not 0 again until the card
-- leaves the field or is set face-down, and then card::reset clears the value (and, with patch 0109, the recorded opponent). So there is
-- no pick to keep here: a new Ojama King, or the same card after it came back, picks a new opponent, and a saved opponent that left
-- blocks nothing (patch 0077, add_disabled_zones_n). Duel.MPBindSeat keeps the seat for the 3 zone prompts (core patch 0047 records it
-- for the disabled zones).
local function mp_free_opponents(tp)
	local me=aux.MPKey(tp)
	local seats={}
	aux.MPForEachDuelist(function(tp_i,seat_i)
		if aux.MPKeyOfSeat(seat_i)~=me then seats[#seats+1]=seat_i end
	end)
	table.sort(seats)
	local free={}
	for _,seat in ipairs(seats) do
		if Duel.MPBindSeat(seat) and Duel.GetLocationCount(1-tp,LOCATION_MZONE,PLAYER_NONE,0)>0 then free[#free+1]=seat end
	end
	Duel.MPBindSeat()
	return free
end
function s.disop(e,tp)
	local free=mp_free_opponents(tp)
	if #free==0 then return end
	local seat=free[1]
	if #free>1 then
		local options={}
		for i,opponent in ipairs(free) do options[i]=0xfffe0000+opponent end
		seat=free[Duel.SelectOption(tp,table.unpack(options))+1]
	end
	if not Duel.MPBindSeat(seat) then return end
	local c=Duel.GetLocationCount(1-tp,LOCATION_MZONE,PLAYER_NONE,0)
	if c==0 then Duel.MPBindSeat() return end
	local dis1=Duel.SelectDisableField(tp,1,0,LOCATION_MZONE,0)
	if c>1 and Duel.SelectYesNo(tp,aux.Stringid(id,0)) then
		local dis2=Duel.SelectDisableField(tp,1,0,LOCATION_MZONE,dis1)
		dis1=(dis1|dis2)
		if c>2 and Duel.SelectYesNo(tp,aux.Stringid(id,0)) then
			local dis3=Duel.SelectDisableField(tp,1,0,LOCATION_MZONE,dis1)
			dis1=(dis1|dis3)
		end
	end
	Duel.MPBindSeat()
	return dis1
end
