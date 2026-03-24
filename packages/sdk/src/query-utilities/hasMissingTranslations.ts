import type { NewBundleNested } from "../database/schema.js"

// Check if pattern is empty
export const hasEmptyPattern = (bundle: NewBundleNested, relevantLocales: string[]): boolean =>
	bundle.messages.some(
		(message) =>
			relevantLocales.includes(message.locale) &&
			message.variants.some(
				(variant) => variant.pattern === undefined || variant.pattern.length === 0
			)
	)

// Check if any relevant locale is missing from the bundle
export const hasMissingLocales = (bundle: NewBundleNested, relevantLocales: string[]): boolean =>
	relevantLocales.some(
		(locale) => !bundle.messages.some((message) => message.locale === locale)
	)

export const hasMissingTranslations = (
	bundle: NewBundleNested,
	relevantLocales: string[]
): boolean => {
	return hasMissingLocales(bundle, relevantLocales) || hasEmptyPattern(bundle, relevantLocales)
}
