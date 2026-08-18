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

	it.each([
		[
			"scan.png",
			"image/png",
			new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			"ocr",
		],
		[
			"interview.wav",
			"audio/wav",
			new Uint8Array([
				0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
			]),
			"transcription",
		],
	])(
		"keeps %s disabled and explains the consent-gated %s workflow",
		async (name, type, signature, modality) => {
			const detection = await detectFormatWithConfidence(
				new File([signature], name, { type }),
			);
			expect(detection).toMatchObject({
				supported: false,
				workflow: { kind: "external-service-required" },
			});
			expect(detection?.workflow?.privacyWarning).toMatch(
				/explicit per-file consent/i,
			);
			expect(detection?.workflow?.fidelityWarning).toMatch(
				modality === "ocr" ? /reading order/i : /speakers/i,
			);
			expect(getFormatAcceptValue().split(",")).not.toContain(
				`.${name.split(".").at(-1)}`,
			);
		},
	);
});
