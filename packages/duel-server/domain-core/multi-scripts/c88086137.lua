-- FFA4: only the physical across field uses the high half.
s.condition=aux.MPGeometryChainFilter(s.condition)

-- R-FFA-THREE-COLUMNS: choose the column opponent before cards or zones.
if aux.MPColumnEffects then
	s.initial_effect=aux.MPColumnEffects(s.initial_effect,{s.activate})
end
