import type { SegmentMeta, TypeRef, UserData } from "$lib/types/types";
import type { FormatId } from "./formatIds";
import type { NeutralDocument } from "./documentModel";
import type { DocumentSkeleton } from "./skeleton";

export interface FormatCapabilities {
	import: boolean;
	export: boolean;
	roundTrip: boolean;
}

export interface FormatImportOption {
	id: string;
	label: string;
	type: "boolean" | "number" | "select" | "text";
	defaultValue: boolean | number | string;
	choices?: readonly string[];
}

export interface FormatValidationResult {
	valid: boolean;
	reason?: string;
}

export type FormatImportResult =
	| {
			kind: "text";
			text: string;
			document: NeutralDocument;
			skeleton: DocumentSkeleton;
			typeRef?: TypeRef;
	  }
	| {
			kind: "segments";
			segments: string[];
			document: NeutralDocument;
			skeleton: DocumentSkeleton;
			typeRef?: TypeRef;
			segmentsMeta?: SegmentMeta[];
	  };

export interface FormatAdapter {
	id: FormatId;
	label: string;
	extensions: readonly string[];
	mimeTypes: readonly string[];
	capabilities: FormatCapabilities;
	importOptions: readonly FormatImportOption[];
	sniff(file: File): Promise<boolean>;
	validate(file: File): Promise<FormatValidationResult>;
	importFile(file: File): Promise<FormatImportResult>;
	exportFile(translation: UserData): Promise<void>;
}
