/**
 * Wires @testing-library/jest-dom's Vitest matcher augmentations into the
 * TypeScript program. The matchers themselves are registered at runtime by
 * vitest.setup.ts (which sits outside tsconfig's include); without this shim,
 * test files inside src/ fail `tsc --noEmit` on e.g. `toBeInTheDocument`.
 */
import "@testing-library/jest-dom/vitest";
