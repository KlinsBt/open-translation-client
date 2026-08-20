import type { UserData } from "$lib/types/types";
import { PROJECT_SCHEMA_VERSION } from "$lib/formats/persistenceMigrations";

export function makeUserData(
	overrides: Partial<UserData["translationData"]> = {},
): UserData {
	const sourceSegments = overrides.seg1 ?? ["Hello & welcome."];
	return {
		schemaVersion: PROJECT_SCHEMA_VERSION,
		id: 7,
		translationData: {
			name: "Example",
			sourceLang: "en",
			targetLang: "de",
			creationDate: "1720000000000",
			seg1: sourceSegments,
			seg2: ["Hallo & willkommen."],
			checked: [true],
			locked: sourceSegments.map(() => false),
			type: "text",
			typeRef: "Hello & welcome.",
			tm: { id: null, name: null, active: false },
			tb: { id: null, name: null, active: false },
			...overrides,
		},
	};
}
