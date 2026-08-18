import { describe, expect, it } from "vitest";
import { detectFormatWithConfidence, getFormatAcceptValue } from "./registry";

describe("browser local and constrained format routing", () => {
	it("advertises signed legacy Office input through the local adapter", async () => {
		const ole = new Uint8Array([
			0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0,
		]);
		const detection = await detectFormatWithConfidence(
			new File([ole], "confidential.doc", {
				type: "application/msword",
			}),
		);

		expect(detection).toMatchObject({
			formatId: "legacy-office",
			supported: true,
			confidence: "high",
		});
		expect(detection?.workflow).toBeUndefined();
		expect(getFormatAcceptValue().split(",")).toContain(".doc");
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
		"routes %s to on-device %s without a consent workflow",
		async (name, type, signature, modality) => {
			const detection = await detectFormatWithConfidence(
				new File([signature], name, { type }),
			);
			expect(detection).toMatchObject({
				formatId: modality === "ocr" ? "image-ocr" : "media-transcription",
				supported: true,
				confidence: "high",
			});
			expect(detection?.workflow).toBeUndefined();
			expect(getFormatAcceptValue().split(",")).toContain(
				`.${name.split(".").at(-1)}`,
			);
		},
	);
});
