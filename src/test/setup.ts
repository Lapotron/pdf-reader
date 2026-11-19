import "fake-indexeddb/auto";
import { setMeasurer } from "../pdf/charBoxes";

// jsdom has no canvas text metrics: use the deterministic width heuristic.
setMeasurer(null);
