#pragma once

namespace ArenaGame {

	// Visitor helper for std::visit over SkillVariant
	template<typename... Ts>
	struct overloaded : Ts... {
		using Ts::operator()...;
	};
	template<typename... Ts>
	overloaded(Ts...) -> overloaded<Ts...>;

}
