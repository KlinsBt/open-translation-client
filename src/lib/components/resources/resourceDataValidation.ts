import type { TbData, TmData } from "$lib/types/types";

export function tmDataValidationError(data: TmData): string | undefined {
	for (const [unitIndex, unit] of data.terms.entries()) {
		if (!unit.source.lang.trim())
			return `Translation unit ${unitIndex + 1} needs a source language.`;
		if (!unit.source.segment.trim())
			return `Translation unit ${unitIndex + 1} needs source text.`;
		if (unit.target.length === 0)
			return `Translation unit ${unitIndex + 1} needs at least one target segment.`;
		for (const [targetIndex, target] of unit.target.entries()) {
			if (!target.lang.trim())
				return `Target ${targetIndex + 1} in translation unit ${unitIndex + 1} needs a language.`;
			if (!target.segment.trim())
				return `Target ${targetIndex + 1} in translation unit ${unitIndex + 1} needs translated text.`;
		}
	}
	return undefined;
}

export function tbDataValidationError(data: TbData): string | undefined {
	for (const [unitIndex, unit] of data.entries.entries()) {
		if (unit.terms.length === 0)
			return `Term unit ${unitIndex + 1} needs at least one term.`;
		for (const [termIndex, term] of unit.terms.entries()) {
			if (!term.lang.trim())
				return `Term ${termIndex + 1} in term unit ${unitIndex + 1} needs a language.`;
			if (!term.term.trim())
				return `Term ${termIndex + 1} in term unit ${unitIndex + 1} needs a value.`;
			for (const [noteIndex, note] of term.notes.entries()) {
				const hasContent =
					typeof note === "string"
						? Boolean(note.trim())
						: Boolean(note.type.trim() || note.text.trim());
				if (!hasContent)
					return `Note ${noteIndex + 1} for term ${termIndex + 1} in term unit ${unitIndex + 1} is empty. Add note text or remove the note.`;
			}
		}
	}
	return undefined;
}
