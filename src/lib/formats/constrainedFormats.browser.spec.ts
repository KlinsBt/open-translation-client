import { describe, expect, it } from "vitest";
import { detectFormatWithConfidence, getFormatAcceptValue } from "./registry";

describe("browser constrained-format guidance", () => {
	it("keeps legacy Office input disabled while returning actionable local steps", async () => {
		const ole = new Uint8Array([
			0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0,
		]);
		const detection = await detectFormatWithConfidence(
			new File([ole], "confidential.doc", {
				type: "application/msword",
			}),
		);

		expect(detection).toMatchObject({
			supported: false,
			workflow: { kind: "convert-before-import" },
		});
		expect(detection?.workflow?.steps).toHaveLength(4);
		expect(detection?.workflow?.privacyWarning).toMatch(/does not upload/i);
		expect(detection?.workflow?.fidelityWarning).toMatch(
			/conversion can alter/i,
		);
		expect(getFormatAcceptValue().split(",")).not.toContain(".doc");
	});
});
