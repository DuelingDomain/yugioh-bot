-- Public protection hints. CLIENT_HINT on a continuous protection itself reports
-- registration, not availability. Observe the core's applicable effect set instead
-- and keep inert hint flags in step with its conditions, targets, immunity and resets.
do
	local definitions={}
	local descriptions={}
	local description_set={}
	local previous={}
	local watching=false
	local codes={EFFECT_INDESTRUCTABLE_BATTLE,EFFECT_INDESTRUCTABLE_EFFECT,
		EFFECT_CANNOT_BE_EFFECT_TARGET,EFFECT_CANNOT_BE_BATTLE_TARGET,EFFECT_IMMUNE_EFFECT}
	local function flag_code(description)
		-- Keep bookkeeping separate from official card passcodes and stock flags.
		return 0x0e000000|(description&0x00ffffff)
	end
	local function update()
		local current={}
		local visited={}
		local function visit(c)
			if not c or visited[c] or not c:IsFaceup() then return end
			visited[c]=true
			current[#current+1]=c
			local active={}
			for _,code in ipairs(codes) do
				local by_owner=definitions[code]
				if by_owner then
					-- IsHasEffect filters the actual protection effects. GetCardEffect
					-- also returns a source's field effects that do not protect itself.
					for _,effect in ipairs({c:IsHasEffect(code)}) do
						local owner=effect:GetOwner()
						local description=owner and by_owner[owner:GetOriginalCode()]
						if description then active[description]=true end
					end
				end
			end
			for _,description in ipairs(descriptions) do
				local flag=flag_code(description)
				if active[description] then
					if c:GetFlagEffect(flag)==0 then
						c:RegisterFlagEffect(flag,RESET_EVENT|RESETS_STANDARD,EFFECT_FLAG_CLIENT_HINT,1,0,description)
					end
				elseif c:GetFlagEffect(flag)>0 then
					c:ResetFlagEffect(flag)
				end
			end
		end
		local function seat(_,player)
			for sequence=0,6 do visit(Duel.GetFieldCard(player,LOCATION_MZONE,sequence)) end
			for sequence=0,7 do visit(Duel.GetFieldCard(player,LOCATION_SZONE,sequence)) end
		end
		-- A global effect has no folded player scope. The existing multiplayer
		-- helper visits real seats, including the Tag partner; legacy needs 0/1.
		if aux.MPEachSeat then aux.MPEachSeat(seat) else seat(0,0) seat(1,1) end
		for _,c in ipairs(previous) do
			if not visited[c] then
				for _,description in ipairs(descriptions) do
					local flag=flag_code(description)
					if c:GetFlagEffect(flag)>0 then c:ResetFlagEffect(flag) end
				end
			end
		end
		previous=current
	end
	function aux.RegisterActiveProtectionHint(owner,code,description)
		definitions[code]=definitions[code] or {}
		definitions[code][owner]=description
		if not description_set[description] then
			description_set[description]=true
			descriptions[#descriptions+1]=description
			table.sort(descriptions)
		end
		if watching then return end
		watching=true
		local observer=Effect.GlobalEffect()
		observer:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
		observer:SetCode(EVENT_ADJUST)
		observer:SetOperation(update)
		Duel.RegisterEffect(observer,0)
	end
end
