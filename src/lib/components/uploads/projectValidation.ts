export function getProjectSetupError(
	name: string,
	sourceLanguage: string,
	targetLanguage: string,
): string | null {
	if (!name.trim()) return "Enter a project name to continue.";
	if (!sourceLanguage || !targetLanguage)
		return "Choose both a source and target language to continue.";
	if (sourceLanguage === targetLanguage)
		return "Choose different source and target languages.";
	return null;
}
