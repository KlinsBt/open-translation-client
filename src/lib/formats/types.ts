import type { SegmentMeta, TypeRef, UserData } from "$lib/types/types";
import type { FormatId } from "./formatIds";
import type { NeutralDocument } from "./documentModel";
import type { DocumentSkeleton } from "./skeleton";
import type { SafeInputContext, SafeInputErrorCode } from "./safeInput";

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
	description?: string;
	placeholder?: string;
}

export type FormatOptionValue = boolean | number | string;
export type FormatOptionValues = Record<string, FormatOptionValue>;

export interface FormatValidationResult {
	valid: boolean;
	reason?: string;
	errorCode?: SafeInputErrorCode;
}

export type FormatImportResult =
	| {
			kind: "text";
			text: string;
			document: NeutralDocument;
			skeleton: DocumentSkeleton;
			filterOptions: FormatOptionValues;
			typeRef?: TypeRef;
	  }
	| {
			kind: "segments";
			segments: string[];
			targetSegments?: string[];
			document: NeutralDocument;
			skeleton: DocumentSkeleton;
			filterOptions: FormatOptionValues;
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
	sniff(file: File, context?: SafeInputContext): Promise<boolean>;
	validate(
		file: File,
		context?: SafeInputContext,
	): Promise<FormatValidationResult>;
	importFile(
		file: File,
		options?: Readonly<FormatOptionValues>,
		context?: SafeInputContext,
	): Promise<FormatImportResult>;
	exportFile(translation: UserData): Promise<void>;
}
