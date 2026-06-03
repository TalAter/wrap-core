// Plain-text / stderr "chrome" output layer — the human-narration channel,
// kept separate from the command's product on stdout. Leaf primitives only:
// no notification bus, no router, no config. Consumers layer their own
// interception plumbing on top and delegate byte writes here.

export { chromeRaw, writeChromeLine } from "./output.ts";
export {
  _resetExitTeardownRegistryForTests,
  registerExitTeardown,
  resetExitGuard,
  SPINNER_FRAMES,
  SPINNER_INTERVAL,
  SPINNER_TEXT,
  startChromeSpinner,
} from "./spinner.ts";
