/**
 * Entry point of the AsciiReq specification scripts.
 *
 * Placeholder for now:
 * the TypeScript project is being set up,
 * and the actual tooling will be added here.
 */

export function main(argv: string[]): number {
	console.log(`asciireq-specification scripts (${argv.length} argument(s))`);
	return 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
	process.exit(main(process.argv.slice(2)));
}
