import type { UserData } from "$lib/types/types";

export function makeUserData(
	overrides: Partial<UserData["translationData"]> = {},
): UserData {
	return {
		id: 7,
		translationData: {
			name: "Example",
			sourceLang: "en",
			targetLang: "de",
			creationDate: "1720000000000",
			seg1: ["Hello & welcome."],
			seg2: ["Hallo & willkommen."],
			checked: [true],
			type: "text",
			typeRef: "Hello & welcome.",
			tm: { id: null, name: null, active: false },
			tb: { id: null, name: null, active: false },
			...overrides,
		},
	};
}
