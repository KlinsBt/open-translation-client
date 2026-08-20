import tsParser from "@typescript-eslint/parser";
import svelte from "eslint-plugin-svelte";

const correctnessRules = {
	"constructor-super": "error",
	"for-direction": "error",
	"getter-return": "error",
	"no-async-promise-executor": "error",
	"no-class-assign": "error",
	"no-const-assign": "error",
	"no-dupe-args": "error",
	"no-dupe-class-members": "error",
	"no-dupe-else-if": "error",
	"no-dupe-keys": "error",
	"no-duplicate-case": "error",
	"no-fallthrough": "error",
	"no-func-assign": "error",
	"no-import-assign": "error",
	"no-loss-of-precision": "error",
	"no-new-native-nonconstructor": "error",
	"no-obj-calls": "error",
	"no-promise-executor-return": "error",
	"no-self-assign": "error",
	"no-setter-return": "error",
	"no-sparse-arrays": "error",
	"no-unreachable": "error",
	"no-unreachable-loop": "error",
	"no-unsafe-finally": "error",
	"no-unsafe-negation": "error",
	"use-isnan": "error",
	"valid-typeof": "error",
};

export default [
	{
		ignores: [".svelte-kit/**", "build/**", "coverage/**", "node_modules/**"],
	},
	{
		files: ["**/*.{js,mjs,ts}"],
		languageOptions: {
			parser: tsParser,
			parserOptions: { sourceType: "module", ecmaVersion: "latest" },
		},
		rules: correctnessRules,
	},
	...svelte.configs["flat/base"],
	{
		files: ["**/*.svelte.{js,ts}"],
		languageOptions: {
			parserOptions: { parser: tsParser },
		},
		rules: correctnessRules,
	},
	{
		files: ["**/*.svelte"],
		languageOptions: {
			parserOptions: { parser: tsParser },
		},
		rules: correctnessRules,
	},
];
