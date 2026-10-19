import { it } from "vitest";
import { main } from "../helpers/preloadAnalysis.js";
it("keeps preload exposure and implementation contracts aligned", () => main());
