import defaultThing from "./default";
import { foo, bar as localBar } from "./foo.js";
function caller() { defaultThing(); foo(); localBar(); }